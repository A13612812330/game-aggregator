/** shared.js — 抓取公共工具 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const HOST_JIDI = 'https://jidiyouxi.com';
const HOST_XD = 'https://www.xdgamer.com';

function abs(base, u) {
  if (!u) return null;
  if (/^https?:/i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  return base + (u.startsWith('/') ? u : '/' + u);
}

async function getHtml(url, { timeoutMs = 20000, retries = 1 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9', Accept: 'text/html,*/*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status} @ ${url}`);
      const html = await r.text();
      if (!html || html.length < 500) throw new Error('empty body @ ' + url);
      return html;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/** ★★ 统一日期归一化 —— 全站唯一出口。
 *
 *  为什么必须有这一层：两个源站的日期格式不同（XD `2026-09-14` / 机地 `2026/9/9`），
 *  且机地列表页文本里「日期」后面紧跟着别的数字，旧正则 `(\d{4}\/\d{1,2}\/\d{1,2})`
 *  第二个 `\d{1,2}` 是**贪婪**的，会把紧跟的数字一并吞掉：
 *
 *      源站真值 `2026/9/8`  →  旧正则抓成 `2026/9/89`   （多吞一个 9）
 *      源站真值 `2025/3/4`  →  旧正则抓成 `2025/3/48`   （多吞一个 8）
 *
 *  后果不只是显示难看：`new Date('2026/9/89T00:00:00Z')` 是 Invalid Date，
 *  兜底算出的 updatedTs 变成 NaN → 该条在「最新更新」里被当成 0 排到最后，
 *  或（有值的那批）与日期标签互相矛盾地排在一起。
 *
 *  职责：解析（两种分隔符）→ 校验月/日范围 → 还原被吞的「日」→ 输出 ISO。
 *  返回 null 表示无法得到合法日期，由调用方自行兜底。
 *
 *  ⚠️ 取舍：`日 > 31` 时取**首位数字**（`89`→`8`）而非直接丢弃。
 *     已抓源站原文逐条核对 8 条样本，全部吻合（见 tools/test-date-norm.js）。
 */
function normDate(s) {
  const m = String(s == null ? '' : s).match(/(\d{4})[/-](\d{1,2})[/-](\d{1,3})/);
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  let d = +m[3];
  if (mo < 1 || mo > 12) return null;
  if (d > 31) d = +String(m[3])[0];            // 被后续数字污染的还原
  if (!(d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;   // 如 2/30 这种不存在的日子
  const p = (n) => String(n).padStart(2, '0');
  return `${y}-${p(mo)}-${p(d)}`;
}

/** 归一化日期 → 当日 00:00 UTC 毫秒（排序用）。无法解析返回 0。 */
function dateTs(s) {
  const n = normDate(s);
  if (!n) return 0;
  const t = Date.parse(n + 'T00:00:00Z');
  return Number.isFinite(t) ? t : 0;
}

function ts2label(tsMs, now = Date.now()) {
  if (!tsMs) return null;
  const diff = now - tsMs;
  if (diff < 60e3) return '刚刚';
  if (diff < 3600e3) return Math.floor(diff / 60e3) + ' 分钟前';
  if (diff < 86400e3) return Math.floor(diff / 3600e3) + ' 小时前';
  const d = new Date(tsMs);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function fmtDateTime(tsMs) {
  const d = new Date(tsMs);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ================= 网盘链接抽取（全项目唯一定义） =================
 * ★ 为什么放这里：机地的 MOD 帖正文与「游戏话题」帖正文是**同一件事**
 *   （从一大段人写文本里挖网盘直链），曾经在 `jidiModify.js` 与
 *   `jidiTopics.js` 各写了一份 —— 上限一个 12 一个 20、一个不过滤站内链接
 *   一个过滤。同一份正文在两个功能下抽出不同结果，正是本项目记录过的
 *   「同一语义的清洗规则只能有一份」那条坑。
 *   现统一到此处，两处都从这里取。
 */
const NETDISK = [
  [/pan\.quark\.cn/i, '夸克网盘'],
  [/pan\.baidu\.com/i, '百度网盘'],
  [/pan\.xunlei\.com/i, '迅雷网盘'],
  [/cloud\.189\.cn/i, '天翼云盘'],
  [/caiyun\.139\.com|yun\.139\.com/i, '移动云盘'],
  [/www\.aliyundrive\.com|alipan\.com/i, '阿里云盘'],
  [/123pan\.com/i, '123 网盘'],
  [/lanzou[a-z]?\.com/i, '蓝奏云'],
  [/mypikpak\.com/i, 'PikPak'],
  [/drive\.uc\.cn/i, 'UC 网盘'],
];

/** 站内链接**不是下载**：正文里常夹 `jidiyouxi.com/problemTutorial`（帮助中心）、
 *  `/post/detail/xxx`（另一篇帖）—— 实测它们会混进下载清单，
 *  让「6 个盘口」变成「7 条里有一条是废话」。默认只认站外链接。 */
const INTERNAL_HOST_RE = /(^|\.)(jidiyouxi\.com|52jidi\.com|xgamer?\.[a-z]+)$/i;

/**
 * 从一段自由文本里抽网盘链接。
 * @param {string} text
 * @param {object} [o]
 * @param {number} [o.max=20]      最多返回几条（防正文爆炸）
 * @param {boolean} [o.dropInternal=true] 是否丢掉站内链接
 * @returns {Array<{url:string, kind:string}>}
 */
function extractLinks(text, { max = 20, dropInternal = true } = {}) {
  const out = [];
  const seen = new Set();
  const re = /https?:\/\/[^\s"'<>）)】\]，,。；;]+/g;
  let m;
  while ((m = re.exec(String(text == null ? '' : text)))) {
    const u = m[0].replace(/[.,;。，、]+$/, '');
    if (seen.has(u)) continue;
    seen.add(u);
    if (dropInternal) {
      let host = '';
      try { host = new URL(u).hostname; } catch { continue; }
      if (INTERNAL_HOST_RE.test(host)) continue;
    }
    const hit = NETDISK.find(([re2]) => re2.test(u));
    out.push({ url: u, kind: hit ? hit[1] : '其他链接' });
    if (out.length >= max) break;
  }
  return out;
}

module.exports = {
  UA, HOST_JIDI, HOST_XD, abs, getHtml, ts2label, fmtDateTime, normDate, dateTs,
  NETDISK, INTERNAL_HOST_RE, extractLinks,
};
