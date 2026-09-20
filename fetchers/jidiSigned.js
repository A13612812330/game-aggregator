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

/* env 缓存：**按路径分别缓存**（h_did 可能不同），同一轮抓取复用 */
const envCache = new Map(); // path -> { env, at }

/**
 * 取某个页面的 env。
 * @param {string} path 取 env 的页面路径，如 '/modify/list'、'/topic/list'
 */
async function getEnv(path = '/modify/list', { force = false, host = 'https://jidiyouxi.com' } = {}) {
  const hit = envCache.get(path);
  if (!force && hit && Date.now() - hit.at < ENV_TTL) return hit.env;

  const r = await fetch(host + path, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQ_TIMEOUT),
  });
  if (!r.ok) throw new Error('取 env 失败 HTTP ' + r.status + ' @ ' + path);
  const env = extractEnv(await r.text());
  if (!env || !env.host) throw new Error('机地页面未内嵌 env（可能改版）: ' + path);
  envCache.set(path, { env, at: Date.now() });
  return env;
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
 */
async function signedPost({ api, referer, envPath, body = {}, host = 'https://jidiyouxi.com', timeout = REQ_TIMEOUT }) {
  const env = await getEnv(envPath || referer, { host });
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
}

module.exports = { BODY_SALT, REQ_TIMEOUT, ENV_TTL, md5, websign, extractEnv, getEnv, signedPost };
