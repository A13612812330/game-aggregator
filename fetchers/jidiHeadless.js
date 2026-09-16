/**
 * fetchers/jidiHeadless.js — 机地「真站内搜索」(可选重模式)
 * 机地搜索为 React 客户端调用 + websign 签名,服务端无法直调。
 * 方案:puppeteer-core 驱动本机 Edge,**直接导航**到机地搜索结果路由
 *   /search/{route}/{kw}  (detail=游戏 / mod=MOD / tool=修改器),
 *   React 识别路由后自动搜索并渲染,逐路由采集结果并标注类型。
 * 单次约 8~25s,仅供低频使用(600s 缓存 + hdBusy 串行互斥)。
 */
const puppeteer = require('puppeteer-core');
const { UA, normDate } = require('../shared');

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];
function findBrowser() {
  return EDGE_CANDIDATES.find((p) => require('fs').existsSync(p));
}

let browserP = null;
function getBrowser() {
  if (browserP) return browserP;
  const exe = findBrowser();
  if (!exe) throw new Error('未找到本机 Edge/Chrome，无头搜索不可用');
  browserP = puppeteer
    .launch({
      executablePath: exe,
      headless: 'new',
      args: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--window-size=1280,1000', '--hide-scrollbars'],
    })
    .catch((e) => { browserP = null; throw e; });
  return browserP;
}
async function disposeBrowser() {
  if (browserP) { try { (await browserP).close(); } catch {} browserP = null; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CLICK_PLAN = [
  { type: 'mod', label: 'MOD', wait: 4000 },
  { type: 'tool', label: '修改器', wait: 4000 },
];

async function searchJidi(q) {
  const exe = findBrowser();
  if (!exe) throw new Error('未找到本机 Edge/Chrome,无法执行机地真搜索');
  const dbg = (m) => { if (process.env.JIDI_HL_DEBUG) console.error('[hd]', m); };
  const t0 = Date.now();
  const browser = await getBrowser();
  const page = await browser.newPage();
  const collected = []; // {id,url,type,title,score,tokens,txt}

  const collect = () => page.evaluate(() => {
    const out = [];
    const seen = new Set();
    const grab = (sel) => {
      document.querySelectorAll(sel).forEach((a) => {
        const href = a.href || '';
        const m = href.match(/(?:topic|post)\/detail\/(\d+)/);
        if (!m || seen.has(m[1])) return;
        seen.add(m[1]);
        const txt = (a.textContent || '').replace(/\s+/g, ' ').trim();
        const titleEl = a.querySelector('span[style*="font-weight:bold"], span.truncate') || a.querySelector('img');
        const title = titleEl ? (titleEl.alt || titleEl.textContent || '').trim() : '';
        if (!title) return;
        const scoreEl = a.querySelector('span.score');
        const tokens = [];
        a.querySelectorAll('span').forEach((s) => {
          const t = (s.textContent || '').trim();
          if (t && t !== title && !/^\d+(\.\d+)?$/.test(t) && tokens.length < 14) tokens.push(t);
        });
        out.push({
          id: m[1], url: href, kind: /\/post\/detail\//.test(href) ? 'post' : 'topic',
          title, score: scoreEl ? parseFloat((scoreEl.textContent || '').trim()) : null,
          tokens, txt,
        });
      });
    };
    grab('a[href*="/topic/detail/"]');
    grab('a[href*="/post/detail/"]');
    return out;
  });

  // 点击分类 tab(文本前缀匹配,DIV 状态切换)
  const clickTab = (label) => page.evaluate((lab) => {
    const cands = [...document.querySelectorAll('div,span,a,li,button')];
    for (const el of cands) {
      const t = (el.textContent || '').replace(/\s+/g, '').trim();
      if (t.startsWith(lab) && t.length <= lab.length + 8 && el.offsetParent !== null) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.width < 300 && el.children.length <= 2) {
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return lab;
        }
      }
    }
    return null;
  }, label);

  let anyOk = false;
  let gameOk = false;
  try {
    await page.setUserAgent(UA);
    const kw = encodeURIComponent(q);
    // 1) 游戏专区:直达结果路由,React 自动搜索渲染
    await page.goto(`https://jidiyouxi.com/search/detail/${kw}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForFunction(
      () => /\/search\/(detail|game)\//.test(location.pathname) && document.querySelectorAll('a[href*="/topic/detail/"]').length > 0,
      { timeout: 12000 }
    ).catch(() => {});
    await sleep(2600);
    const gameCards = (await collect()).map((x) => ({ ...x, type: 'game' }));
    dbg('game cards=' + gameCards.length + ' @' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
    if (gameCards.length) {
      anyOk = true;
      gameOk = true;
      collected.push(...gameCards);
    }
    // 2) MOD / 修改器:点击 tab 切换采集
    for (const plan of CLICK_PLAN) {
      if (!gameOk) break; // 游戏未搜成功,后续 tab 依赖结果页上下文,跳过
      const clicked = await clickTab(plan.label);
      if (!clicked) continue;
      await sleep(plan.wait);
      const cards = (await collect()).map((x) => ({ ...x, type: plan.type }));
      dbg(plan.type + ' cards=' + cards.length + ' @' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
      if (cards.length) { anyOk = true; collected.push(...cards); }
    }
  } catch (e) {
    // 保留已收集部分
  } finally {
    await page.close().catch(() => {});
  }
  if (!anyOk || !gameOk) return [];

  // 清洗输出: 每类限量, 提取 size/genres/badge/日期
  const CAPS = { game: 12, mod: 8, tool: 8 };
  const GENRE_SET = new Set(['动作','冒险','角色扮演','射击','竞速','模拟','策略','休闲','体育','独立','恐怖','格斗','即时战略','卡牌','解谜','生存','多人','开放世界','RPG','FPS','SLG']);
  const items = [];
  const seenId = new Set();
  const cnt = {};
  for (const r of collected) {
    const cap = CAPS[r.type] || 8;
    if (!r.id || seenId.has(r.id) || !r.title) continue;
    if ((cnt[r.type] || 0) >= cap) continue;
    seenId.add(r.id);
    cnt[r.type] = (cnt[r.type] || 0) + 1;
    let size = null;
    const genres = [];
    let badge = null;
    for (const t of r.tokens || []) {
      const sm = t.match(/^(\d+(?:\.\d+)?)(GB|MB|TB)$/i);
      if (sm && !size) { size = sm[1] + sm[2].toUpperCase(); continue; }
      if (/^\d+(?:\.\d+)?W?$/.test(t)) continue;
      if (GENRE_SET.has(t) && genres.length < 4) { genres.push(t); continue; }
      if (t.includes('发行日期') && !badge) { badge = t; }
    }
    /* ★ 贪婪陷阱同 jidi.js：`\d{1,2}` 会把日期后紧跟的数字一起吞掉（`2026/9/8`→`2026/9/89`）。
     *   放宽取片段 + normDate 校验还原，输出 ISO 供入库统一使用。 */
    const rel = normDate((((r.txt || '').match(/发行日期[:：]\s*(\d{4}\/\d{1,3}\/\d{1,3})/) || [])[1]));
    const updTok = (r.tokens || []).find((t) => /更新/.test(t) && !/发行日期/.test(t));
    const upd = updTok ? updTok.replace(/\s*更新\s*/, '').trim() || null : null;
    items.push({
      id: 'hd-' + r.id, source: 'jidi', kind: 'rank', rank: null, type: r.type || 'game',
      title: r.title, cover: null, score: r.score, size, genres,
      badge: upd || (rel ? '发行 ' + rel.slice(5) : null),
      releaseDate: rel || null, dateLabel: rel || null, updatedLabel: upd || null,
      url: r.url, real: true,
    });
  }
  dbg('items ' + items.length + ' in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  return items;
}

module.exports = { searchJidi, disposeBrowser };
