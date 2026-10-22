/**
 * fetchers/jidiSigned.js — 机地「带签名 POST 接口」的**唯一**底座
 *
 * ─────────────────────────────────────────────────────────────
 * ★ 为什么要有这个文件
 *
 * 机地所有列表/详情接口都是同一种形态：
 *     POST /api/<...>?websign=<sign>       body 为 text/plain
 * 直接 POST 无论是空 body、还是只带业务参数，都只回
 *     {"ret":-1,"errcode":-1,"msg":"请求参数错误"}
 * 且**签名对错返回的是同一句话**（不会告诉你「签名错」），所以很能误导人。
 *
 * 还原自 `app.<hash>.js` 模块 1484/67052：
 *     sign = websign = "v2-" + md5( String(h_m || 0) + md5( JSON.stringify(body) + "YhD6TCs9VpAl" ) )
 *
 * ★★ 真正的关键在 body —— 不是「业务参数」而是 **整份 env 的展开**：
 *     body = { ...env, ...业务参数, h_ts: Date.now(), h_ch }
 *     env 嵌在任意页面 HTML 的 <script id="appState"> 里（含服务端下发的 h_did UUID）。
 *     实测：只发业务参数 → 「请求参数错误」；带上 env 全量 → ret:1 正常返回。
 *     也就是说服务端在拿 env 里的字段做校验（h_did / host / app 等），
 *     而不是单纯核对我们自己算的签名。
 *
 * ★ 本文件是**算法与 env 缓存的单一出处** —— v10.22 从 jidiModify.js 抽出，
 *   任何新接口（如 /api/topic/get_topics）都必须走这里，不要再抄一份。
 *   （历史教训：同一语义的清洗/签名规则写两份，就会出现「同一次抓取两种行为」。）
 *
 * ⚠️ 各页面的 env 可能带**不同的 h_did**，所以 env 缓存按「取 env 的页面路径」分别存，
 *    不要全局共用一份 —— 否则 A 页面的 h_did 配 B 页面算的签名，服务端可能判非法。
 */
const { UA } = require('../shared');
const crypto = require('crypto');

/** 签名盐（还原自站点 app chunk） */
const BODY_SALT = 'YhD6TCs9VpAl';
const REQ_TIMEOUT = 25000;
/** env 缓存有效期 */
const ENV_TTL = 10 * 60 * 1000;

const md5 = (s) => crypto.createHash('md5').update(String(s), 'utf8').digest('hex');

/** websign 算法（还原自站点 app chunk；h_m 缺失时为 0） */
function websign(body) {
  const h = body && body.h_m ? body.h_m : 0;
  const inner = md5(JSON.stringify(body) + BODY_SALT);
  return 'v2-' + md5(String(h) + inner);
}

/** 从任意页面 SSR HTML 里取 <script id="appState"> → env */
function extractEnv(html) {
  const m = String(html || '').match(/<script id="appState"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  const raw = m[1].replace(/^window\.[A-Za-z_$]+=/, '').trim().replace(/;?\s*$/, '');
  try {
    const j = JSON.parse(raw);
    return (j && j.env) || null;
  } catch {
    return null;
  }
}

/* ============================================================
 * ★★ v10.104：env 页面的**空壳识别** —— 这是「本体 0 条」的真正根因
 *
 * 现场（2026-10-22，渔力全开 tid=2117239899，用户报「本体很多下载源但抓不到」）：
 *   弹窗显示「本体 0」+「机地页签名未取 env（可能改版）：/topic/list」。
 *   实测同一时刻直连接口：`resource_type=1 → count=35 / 35 条全取回 / 78 条网盘链接`。
 *   ⇒ 接口是好的，**坏在取 env 那一次请求**。
 *
 * 空壳页长什么样（实测抓到的正文，HTTP **200**）：
 *     <div id="app"></div>
 *     <script>window.APP_INITIAL_STATE={}</script>
 *     <script src="//static2.52jidi.com/game-community-web-outland_test/app.<hash>.js"></script>
 *   长度 **1188 字节**、没有 `<script id="appState">`。是源站的 **SPA 骨架兜底页**
 *   —— 服务端 SSR 这一次没渲染出来（排队超时就直出骨架），**不是改版**。
 *
 * 稳定复现顺序（决定性证据）：
 *     GET /topic/list（23KB，正常） → POST /api/misc/post_list → 立刻 GET /modify/list → **空壳**
 *   而单纯连打 12 次列表页（间隔 500ms，带不带 cookie 都一样）→ **12/12 正常**。
 *   ⇒ 触发条件是「页面 + 紧接着的接口请求」这个组合下的 SSR 降级，与频率、cookie 都无关。
 *     所以「加 cookie / 放慢」都不是解，**只有「认出来并换一次」是解**。
 *
 * 三条实测结论（决定了下面的实现）：
 *   ① 空壳重试**基本立刻就好**（实测第 2 次即拿到 718KB 完整页）；
 *   ② **env 跨页面通用**：用 `/modify/list` 的 env 打 `post_list`（tid 同上，rt=1）
 *      → `ret:1, count:35`，与 `/topic/list` 的 env 结果**完全一致**。
 *      所以主路径空了可以换别的页面取，不必死磕同一个 URL；
 *   ③ `/modify/list` 是实测最稳的 env 来源（718KB 完整 SSR，12/12 成功）。
 *      `/` 首页**不能**当兜底：实测它要么 1188 空壳、要么 appState 里只有 7 个键且**没有 host**。
 *
 * ⚠️ 别再把它报成「可能改版」：那句错误文案把三拨人带偏过。真改版的形态是
 *    12 次全失败且**连 business 接口也一起挂**；只在「页面→接口」交替时偶发 = 降级。
 * ============================================================ */

/** 页面分类：ok（有 appState）/ shell（SPA 骨架空壳）/ no-appstate（结构变了） */
function classifyPage(html) {
  const s = String(html || '');
  if (!s) return { kind: 'empty', len: 0 };
  if (/<script id="appState"/.test(s)) return { kind: 'ok', len: s.length };
  if (/APP_INITIAL_STATE/.test(s)) return { kind: 'shell', len: s.length };
  return { kind: 'no-appstate', len: s.length };
}

/**
 * env 相关失败 —— 带 `kind` 让上层能区分「值得重试」与「结构真变了」。
 * `fatal=true` ⇒ 重试只会多打源站请求（把它放大成真限流），调用方应立即放弃。
 */
class EnvError extends Error {
  constructor(msg, { kind = 'unknown', path = '', len = 0, fatal = false } = {}) {
    super(msg);
    this.name = 'EnvError';
    this.kind = kind;
    this.path = path;
    this.len = len;
    this.fatal = fatal;
  }
}

/* env 缓存：**按路径分别缓存**（h_did 可能不同），同一轮抓取复用 */
const envCache = new Map(); // path -> { env, at, from, got }
/* ★ v10.104 单飞：同路径并发只发一个请求。
 *   三专区是并行的，若各自去取 env，同一时刻就打同一个页面 3 次 ——
 *   而这正是上面实测的降级触发组合，等于自己把自己推向空壳。 */
const envInflight = new Map(); // host|path -> Promise<env>

/** 兜底取 env 的页面顺序（主路径不在其中时排在最前，见 loadEnv） */
const ENV_FALLBACK = ['/modify/list', '/topic/list'];
/** 单次 getEnv 最多请求几个页面（含同路径重试）——机地按请求数限流，别试探 */
const ENV_MAX_TRIES = 3;
/** 空壳重试前的退避（避开同一个降级窗口） */
const ENV_RETRY_DELAY = 400;

/** 取一次页面并解析 env；失败抛 EnvError（带分类） */
async function fetchEnvOnce(path, host) {
  const r = await fetch(host + path, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQ_TIMEOUT),
  });
  if (!r.ok) {
    throw new EnvError('取 env 页面 HTTP ' + r.status + ' @ ' + path, { kind: 'http', path, fatal: false });
  }
  const html = await r.text();
  const c = classifyPage(html);
  if (c.kind === 'shell') {
    throw new EnvError('机地返回 SPA 骨架空壳页（' + c.len + 'B）@ ' + path, { kind: 'shell', path, len: c.len });
  }
  if (c.kind !== 'ok') {
    throw new EnvError('页面里没有 appState（' + c.kind + ' / ' + c.len + 'B）@ ' + path, { kind: c.kind, path, len: c.len, fatal: true });
  }
  const env = extractEnv(html);
  if (!env || !env.host) {
    throw new EnvError('appState 里没有 env.host @ ' + path + ' (' + c.len + 'B)', { kind: 'no-host', path, len: c.len, fatal: true });
  }
  return env;
}

/**
 * 真正的取 env：主路径 → 同路径重试 → 换页面兜底。
 * 成功后**按调用方的主路径**写缓存（调用方语义不变），另记 `from` 便于排查这次借了谁的 env。
 */
async function loadEnv(path, host) {
  const chain = [path, path];
  for (const p of ENV_FALLBACK) if (p !== path) chain.push(p);

  const tried = [];
  let last = null;
  const tries = Math.min(chain.length, ENV_MAX_TRIES);

  for (let i = 0; i < tries; i++) {
    if (i) await sleep(ENV_RETRY_DELAY);
    const p = chain[i];
    try {
      const env = await fetchEnvOnce(p, host);
      envCache.set(path, { env, at: Date.now(), from: p, got: env.host });
      return env;
    } catch (e) {
      last = e;
      tried.push(p + '=' + (e.kind || 'err'));
    }
  }

  /* ★ 文案要能直接指导下一步：说清「试了哪几次、每次什么形态」，而不是一句「可能改版」 */
  const detail = tried.join(' → ');
  const allFatal = last && last.fatal;
  throw new EnvError(
    '机地 env 页面取不到（已试 ' + tries + ' 次：' + detail + '）'
      + '。这是源站 SSR 偶发降级，不是改版 —— 稍后重试即可。',
    { kind: (last && last.kind) || 'unknown', path, len: (last && last.len) || 0, fatal: !!allFatal }
  );
}

/**
 * 取某个页面的 env（带缓存 + 单飞 + 空壳兜底）。
 * @param {string} path 取 env 的页面路径，如 '/modify/list'、'/topic/list'
 */
function getEnv(path = '/modify/list', { force = false, host = 'https://jidiyouxi.com' } = {}) {
  const hit = envCache.get(path);
  if (!force && hit && Date.now() - hit.at < ENV_TTL) return Promise.resolve(hit.env);

  const key = host + '|' + path;
  const flying = envInflight.get(key);
  if (flying) return flying;

  const p = loadEnv(path, host).finally(() => envInflight.delete(key));
  envInflight.set(key, p);
  return p;
}

/**
 * 通用带签名 POST。
 * @param {object} o
 * @param {string} o.api     接口路径，如 '/api/topic/get_topics'
 * @param {string} o.referer 取 env 的页面路径（默认同时用作 Referer），如 '/topic/list'
 * @param {string} [o.envPath] 只用于取 env 的页面路径；给了它就以它为准，Referer 头仍用 referer
 * @param {object} o.body    业务参数（env 会自动合并进来）
 * @param {string} [o.host]
 *
 * ★ v10.26 为什么要拆出 `envPath`：**详情页的 env 结构与列表页不同**。
 *   实测 `/topic/detail/<tid>` 的 appState.env 只有
 *   `{h_m, h_ts, h_dt, h_did, token, h_app, enable_etag}` —— **没有 `host`**，
 *   而 `getEnv()` 的健全性校验正是 `if (!env || !env.host) throw`，
 *   于是「拿详情页当 env 来源」会直接抛「机地页面未内嵌 env（可能改版）」，
 *   把人往「源站改版了」的方向带 —— 实际只是取错了页面。
 *   而 `post_list`（话题资源列表）需要的是**列表页那份带 host 的 env**，
 *   Referer 用详情页更贴切。两者本可以不同，所以分开传。
 *   （实测：env 取 `/topic/list` + Referer 用 `/topic/detail/<tid>` → ret:1 正常返回。）
 *   ⚠️ v10.104 补正：env 的**来源页面**其实可以互换（`/modify/list` 的 env 打 `post_list`
 *   实测 `ret:1/count:35`，与 `/topic/list` 完全一致），所以「必须取某个页面」只对**详情页**成立
 *   （详情页确实没有 host）。列表页之间可以互相兜底，见 getEnv 的 ENV_FALLBACK。
 *
 * ★ v10.95：**失败必须重试一次，且重试前强制换 env**。
 *   实测（2026-10-21，tid=640827939 星砂岛）：同一个进程里
 *     · 第一次 topicPosts → 本体专区 `HTTP 405`、0 帖；
 *     · 2 秒后同一话题再抓 → 本体 3 帖 / 5 条网盘链接。
 *   说明 405 不是「这块没资源」，而是**取 env 那一步拿到了空壳页**
 *   （envCache 里存的 env 一旦带病，10 分钟内每次签名都 405）。
 *   ⇒ 只要失败就 `envCache.delete(path)` + 强制重取一次，仍是失败才向上抛。
 *   ⚠️ 只重试 **1 次**：机地的限流是按请求数算的，多重重试会把偶发失败放大成真限流。
 *
 * ★★ v10.104：**env 层自己已经重试过了，这里不能再叠一层**。
 *   getEnv 现在会「同路径重试 → 换页面兜底」最多 3 次，若三次都失败说明这一轮就是不行；
 *   此时 `EnvError.fatal` 或次数用尽 ⇒ **立即抛**，不要再 force 重取（3×2=6 次页面请求，
 *   在机地身上足以把偶发故障放大成真限流）。只有「env 拿到了、POST 却失败」才值得重试。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function signedPost(o) {
  const { api, referer, envPath, body = {}, host = 'https://jidiyouxi.com', timeout = REQ_TIMEOUT, retry = 1 } = o;
  const envP = envPath || referer;
  let lastErr = null;

  for (let attempt = 0; attempt <= retry; attempt++) {
    const force = attempt > 0;
    try {
      if (force) envCache.delete(envP);         // 带病的 env 必须先扔掉
      const env = await getEnv(envP, { host, force });
      const full = Object.assign({}, env, body, { h_ts: Date.now(), h_ch: body.h_ch || 'other' });
      full.h_did = full.h_did || '';
      const sign = websign(full);

      const r = await fetch(host + api + '?websign=' + encodeURIComponent(sign), {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'content-type': 'text/plain',
          Referer: host + referer,
        },
        body: JSON.stringify(full),
        signal: AbortSignal.timeout(timeout),
      });
      if (!r.ok) throw new Error(api + ' HTTP ' + r.status);
      let j;
      try { j = await r.json(); } catch {
        throw new Error(api + ' 返回非 JSON');
      }
      if (!j || j.ret !== 1) {
        throw new Error(api + ' 返回异常: ' + JSON.stringify(j).slice(0, 200));
      }
      return j.data || {};
    } catch (e) {
      lastErr = e;
      /* env 结构性问题（页面里根本没有 appState / 没有 host）= 重试只会多打请求 */
      if (e && e.fatal) break;
      if (attempt < retry) await sleep(600);    // 600ms：实测 250ms 仍落在同一个降级窗口里
    }
  }
  throw lastErr || new Error(api + ' 未知失败');
}

module.exports = {
  BODY_SALT, REQ_TIMEOUT, ENV_TTL, ENV_FALLBACK, ENV_MAX_TRIES,
  md5, websign, extractEnv, classifyPage, EnvError, getEnv, signedPost,
};
