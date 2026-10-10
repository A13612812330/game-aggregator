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
 * ★ v10.45：**广告 / 帮助站**链接也不是下载。
 *
 * 实测反例（用户口径「游戏下载本体中 有个其他……实际是一个广告链接」）：
 * 机地资源帖正文结尾常带一句「如仍有问题，请看：https://52leiqu.com/problemTutorial」
 * —— 这是**迅雷「雷区」问题教程页**（源站的引导/推广页，页面上就是那个
 * `icon_from_xunlei_helper` 小图标）。
 *
 * 它为什么能混进来：
 *   · 不是站内域名 ⇒ `INTERNAL_HOST_RE` 管不到（it's a 姐妹站，不是 `52jidi.com` 本身）
 *   · 不是任何网盘 ⇒ `NETDISK` 匹配不到 ⇒ `kind` 退成 `'其他链接'`
 *   ⇒ 前端拿 `kind` 当盘口名渲染，于是列表里凭空多出一个名叫**「其他」的下载按钮**，
 *     点开是广告页。实测全库命中 **34 处**。
 *
 * 与 `INTERNAL_HOST_RE` 分开写而不是并进去：两者的**语义不同**
 * （一个是「本站内链」，一个是「第三方引导页」），合并后注释会说不清；
 * 而且广告域名会随源站运营变化，单独一张表才好替换。
 */
const JUNK_HOST_RE = /(^|\.)(52leiqu\.com|leiqu\.[a-z]+)$/i;

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
      /* 站内链接与广告 / 帮助站链接都不是下载 —— 两条规则分开判，各自有各自的理由 */
      if (INTERNAL_HOST_RE.test(host) || JUNK_HOST_RE.test(host)) continue;
    }
    const hit = NETDISK.find(([re2]) => re2.test(u));
    out.push({ url: u, kind: hit ? hit[1] : '其他链接' });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * 清掉一段正文里的**广告 / 帮助站内容**（按行删）。
 *
 * 为什么要有这一步（v10.50）：机地资源帖的正文结尾常带一句固定引导，例如
 *   `更多问题请访问 https://52leiqu.com/problemTutorial`
 * （`52leiqu.com` = 迅雷「雷区」问题教程页，姐妹站的推广位）。
 * `extractLinks` 早就把它从**链接表**里滤掉了（⇒ 下载清单不会再出现名叫「其他」的按钮），
 * 但**正文原文**里还留着 —— v10.45 时正文无人渲染，所以用户看不见；
 * **v10.50 起原贴弹窗会整段渲染 `content`**，再不处理就等于把广告摆到用户眼前。
 * ★ 这就是 `tools/test-download.js` 那条「content 目前无人渲染」断言**事先写下的条件**：
 *   前提变了就必须连带把 content 一起清 —— 那条断言变红是**设计如此**，不是误报。
 *
 * 判据：行内出现的**域名**命中 `JUNK_HOST_RE` ⇒ **整行删**（只删 URL 会留下一句断句）。
 *   · 用 host 判、**不用**「含 leiqu 字样」判 —— `leiqupan.com` 是**真网盘**，会被误伤；
 *   · **不含广告时原样返回**（逐字不动）⇒ 对全库 99.8% 的正文零改动，且可反复调用（幂等）。
 *
 * @param {string} text
 * @returns {string}
 */
function cleanPostText(text) {
  const s = String(text == null ? '' : text);
  if (!s) return '';
  /* 每次新建正则：模块级带 `g` 的正则会在多次调用间共享 lastIndex（一个经典静默坑） */
  const re = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}/gi;
  let changed = false;
  const kept = s.split('\n').filter((ln) => {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(ln))) {
      const host = m[0].replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
      if (JUNK_HOST_RE.test(host)) { changed = true; return false; }
    }
    return true;
  });
  if (!changed) return s;
  /* 只在**真删了行**时才收拾首尾/连续空行 —— 无广告的正文一个字都不许动 */
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
}

module.exports = {
  UA, HOST_JIDI, HOST_XD, abs, getHtml, ts2label, fmtDateTime, normDate, dateTs,
  NETDISK, INTERNAL_HOST_RE, JUNK_HOST_RE, extractLinks, cleanPostText,
};
