'use strict';
/**
 * data/download-guard.js — 云下载的准入判据（v10.93）
 *
 * 为什么单独成文件、且全是纯函数：
 *   云下载是本项目**第一个会让服务器替陌生访客消耗资源**的功能
 *   （带宽 + 磁盘 + 长时间进程）。这类判据一旦写成「夹在路由里的 if」，
 *   就没法在静态套件里逐个用例验，只能靠人工点。
 *   ⇒ 全部抽成 `(输入) => {ok, code, reason}`，路由只负责调用与回话。
 *
 * 用户拍板的三条口径（2026-10-21）：
 *   ① 开放范围：**所有人，但限流**（每 IP 同时 1 个、每日 3 个）
 *   ② 单任务体积：**≤ 30 GB**（超限不排队，直接回「建议用本机客户端」）
 *   ③ 磁盘水位：剩余低于阈值就停止接新任务（不删旧任务换空间）
 *
 * ★ 为什么体积上限一定要卡在「元数据解析之后」而不是提交时：
 *   磁力链接本身**不含体积信息**。提交瞬间能拿到的只有 BTIH 和名字，
 *   真正的大小要等 aria2 拉完元数据才知道（实测 4.3s–8.5s）。
 *   ⇒ 「30 GB」这道闸只能在 preview 之后、batches 之前判；
 *     提交阶段只能判「配额」，判不了「体积」。
 *   这个顺序错了就会出现「先占了配额、再报体积超限」，配额被白白消耗。
 */

/* ── 常量：全部集中，路由与文档只引用这里，不写字面量 ── */
const MAX_TASK_BYTES = 30 * 1024 ** 3; // 30 GB
const MAX_ACTIVE_PER_IP = 1; // 同时进行的任务数
const MAX_DAILY_PER_IP = 3; // 24 小时内新建任务数
const MIN_FREE_BYTES = 40 * 1024 ** 3; // 磁盘剩余低于此值不再接单
const TASK_TTL_MS = 24 * 3600 * 1000; // 完成/失败后保留 24h，过期删文件
const PREVIEW_TTL_MS = 30 * 60 * 1000; // 元数据预览 30 分钟内有效
const MAX_FILES = 2000; // 磁力内文件数上限（防超大合集打爆 UI 与 RPC）

/* 活跃态：占用「同时 1 个」的名额。ready 不占（文件已在盘上，只是等用户来取）。 */
const ACTIVE_STATES = new Set(['resolving', 'queued', 'downloading', 'paused']);

/**
 * 磁力链接严格判据。
 * ★ 为什么不用 `s.startsWith('magnet:')`：那样 `magnet:?dn=xx`（没有任何 xt）
 *   也会通过，然后 aria2 报一个含糊的错，用户看到的是「下载失败」而不是「链接不对」。
 * ★ 40 位 hex 与 32 位 base32 都是合法 BTIH（v1 与 Base32 编码），两种都要收。
 */
function parseMagnet(raw) {
  const s = String(raw || '').trim();
  if (!s || s.length > 4096) return { ok: false, code: 'bad-magnet', reason: '磁力链接为空或过长' };
  if (!/^magnet:\?/i.test(s)) return { ok: false, code: 'bad-magnet', reason: '不是磁力链接' };
  const q = s.slice(s.indexOf('?') + 1);
  let btih = '';
  for (const seg of q.split('&')) {
    const eq = seg.indexOf('=');
    if (eq < 0) continue;
    if (decodeURIComponent(seg.slice(0, eq)).toLowerCase() !== 'xt') continue;
    const v = decodeURIComponent(seg.slice(eq + 1));
    const m = /^urn:btih:([a-fA-F0-9]{40}|[A-Za-z2-7]{32})$/.exec(v);
    if (m) { btih = m[1].toUpperCase(); break; }
  }
  if (!btih) return { ok: false, code: 'bad-magnet', reason: '磁力链接里没有有效的 BTIH' };
  /* dn（display name）只用于展示；真实文件名一律以元数据为准，绝不拿来拼路径。 */
  let dn = '';
  for (const seg of q.split('&')) {
    const eq = seg.indexOf('=');
    if (eq < 0) continue;
    if (decodeURIComponent(seg.slice(0, eq)).toLowerCase() !== 'dn') continue;
    try { dn = decodeURIComponent(seg.slice(eq + 1)); } catch (e) { dn = ''; }
    break;
  }
  return { ok: true, btih, name: dn.slice(0, 200) };
}

/** 单任务体积闸。bytes <= 0 表示「元数据没给出长度」—— 这种情况按拒绝处理（宁可让人来问）。 */
function checkSize(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return { ok: false, code: 'size-unknown', reason: '无法确定任务体积，拒绝入队' };
  if (n > MAX_TASK_BYTES) {
    return {
      ok: false,
      code: 'too-large',
      reason: '任务体积 ' + gb(n) + ' GB，超过本站单任务上限 ' + gb(MAX_TASK_BYTES) + ' GB',
    };
  }
  return { ok: true };
}

/** 磁盘水位闸。freeBytes 由调用方现测（statfs），不缓存 —— 缓存必然滞后。 */
function checkDisk(freeBytes) {
  const n = Number(freeBytes) || 0;
  if (n < MIN_FREE_BYTES) {
    return {
      ok: false,
      code: 'disk-low',
      reason: '服务器磁盘剩余 ' + gb(n) + ' GB，低于安全水位 ' + gb(MIN_FREE_BYTES) + ' GB，暂停接新任务',
    };
  }
  return { ok: true };
}

/**
 * IP 配额闸。
 * @param {string} ip
 * @param {Array} tasks  当前全部任务（含 state / ip / createdAt）
 * @param {number} now
 * ★ 每日额度按 createdAt 滚动 24h 算，不按自然日 —— 自然日会让「23:59 建 3 个 + 00:01 再建 3 个」
 *   在 2 分钟内用掉 6 个，等于限流形同虚设。
 */
function checkQuota(ip, tasks, now) {
  const mine = (tasks || []).filter((t) => t && t.ip === ip);
  const active = mine.filter((t) => ACTIVE_STATES.has(t.state));
  if (active.length >= MAX_ACTIVE_PER_IP) {
    return {
      ok: false,
      code: 'busy',
      reason: '你已有 ' + active.length + ' 个任务在进行中，本站每 IP 同时只允许 ' + MAX_ACTIVE_PER_IP + ' 个',
    };
  }
  const dayAgo = (now || Date.now()) - 24 * 3600 * 1000;
  const recent = mine.filter((t) => Number(t.createdAt) > dayAgo);
  if (recent.length >= MAX_DAILY_PER_IP) {
    return {
      ok: false,
      code: 'daily-limit',
      reason: '24 小时内已提交 ' + recent.length + ' 个任务，达到本站每 IP 上限 ' + MAX_DAILY_PER_IP + ' 个',
    };
  }
  return { ok: true };
}

/**
 * 文件清单净化：aria2 的 `path` 是**服务器上的绝对路径**，
 * 直接回给前端等于泄露服务器目录结构（`/workspace/...`）。
 * ⇒ 对外只给 basename，`index` 才是真标识。
 * ★ 同时过滤掉 aria2 为 BT 任务自动加的占位条目（length=0 且 path 为空）。
 */
function sanitizeFiles(list) {
  const out = [];
  for (const f of list || []) {
    if (out.length >= MAX_FILES) break;
    const idx = Number(f.index);
    const len = Number(f.length) || 0;
    const abs = String(f.path || '');
    if (!Number.isFinite(idx) || idx < 1) continue;
    const base = abs.split(/[\\/]/).filter(Boolean).pop() || '';
    if (!base) continue;
    out.push({
      index: idx,
      name: base,
      length: len,
      selected: f.selected === 'true' || f.selected === true,
    });
  }
  return out;
}

function gb(bytes) {
  return (Number(bytes) / 1024 ** 3).toFixed(1);
}

module.exports = {
  MAX_TASK_BYTES,
  MAX_ACTIVE_PER_IP,
  MAX_DAILY_PER_IP,
  MIN_FREE_BYTES,
  TASK_TTL_MS,
  PREVIEW_TTL_MS,
  MAX_FILES,
  ACTIVE_STATES,
  parseMagnet,
  checkSize,
  checkDisk,
  checkQuota,
  sanitizeFiles,
  gb,
};
