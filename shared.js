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

module.exports = { UA, HOST_JIDI, HOST_XD, abs, getHtml, ts2label, fmtDateTime, normDate, dateTs };
