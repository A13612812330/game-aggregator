/**
 * `/api/download` 的缓存时长策略 —— 单独成模块，只为一件事：**能被测**。
 *
 * 起因（v10.95，用户口径「机地有很多免费的下载本体链接，为什么只显示 XD 的」）：
 *   机地取 env 偶发拿不到 ⇒ 本体专区回 405、0 帖，而这份「0 帖」被当成
 *   正常结果缓存了 30 分钟。同一进程里 2 秒后现抓同一话题
 *   （tid 640827939 星砂岛）→ 本体 3 帖 / 5 条网盘链接。
 *   ⇒ 这不是「机地没有」，是**把一次失败缓存成了结论**。
 *
 * ★ v10.104 定性补正：那次「拿不到」不是挑战页/改版，是源站 SSR 偶发降级，
 *   返回 1188 字节的 SPA 骨架页（HTTP 200）。重试/换页面即可恢复 ——
 *   见 `fetchers/jidiSigned.js` 的 classifyPage + ENV_FALLBACK。
 *   （**本文件只管时长，不修抓取**：失败缓存得短，才给下一轮重取留机会。）
 *
 * 规则：只有**完整成功**的那一次才配吃满 30 分钟。
 *   · jidi 且有专区带 error（= 这次没取到） → 60 秒（下一个人打开就自愈）
 *   · jidi 走了 SSR 兜底（engine='ssr'，只有首屏约 10 帖） → 120 秒
 *   · 其它（XD 正常解出 / 机地三专区都干净） → 30 分钟
 *
 * ⚠️ 判据必须是「有没有 error」而不是「有没有链接」：
 *   机地确实存在「帖在、但帖里没写网盘」的正常空结果，那种要照常缓存，
 *   否则每次打开都重打一遍源站，反过来更快触发限流。
 */

const FULL = 30 * 60_000;
const FAILED = 60_000;      // 有专区报错：短缓存，让下一次打开自愈
const DEGRADED = 2 * 60_000; // SSR 兜底：能看但覆盖不全，别锁半小时

function dlCacheTtl(v) {
  if (!v || !v.source) return FAILED;
  if (v.source !== 'jidi') return FULL;
  if (v.engine === 'ssr') return DEGRADED;
  const bad = (v.sections || []).some((s) => s && s.error);
  return bad ? FAILED : FULL;
}

/** 这份载荷值不值得让用户点「重试」——前端与测试共用同一判据（只服务端判会两边漂移） */
function dlRetryable(v) {
  if (!v || v.source !== 'jidi') return false;
  if (v.engine === 'ssr') return true;
  return (v.sections || []).some((s) => s && s.error);
}

/* ---------------------------------------------------------------------------
 * `/api/search` 的缓存时长 —— **同一类问题的第二个落点**（v10.96）
 *
 * 起因（2026-10-21 全模块抽样发现）：`/api/search` 对整份结果统一缓存 5 分钟，
 * 而 XD 侧搜索有站点级限流（实测返回「管理员设定搜索时间间隔为3秒」提示页）。
 * ⇒ 任何人触发一次限流，**全站 5 分钟内搜同一个词都看到「XD 源失败」**；
 *   而 XD 的限流窗口其实是**几十秒级**的，锁 5 分钟纯属自己放大故障。
 *
 * 规则：
 *   · 任一源 `ok:false`（= 这次没取到）→ 45 秒，下一次就能自愈
 *   · 两源都 ok（哪怕都是 0 条）        → 5 分钟
 *     ⚠️ 「两源都成功但确实 0 条」是**真结论**，必须照常缓存 ——
 *        否则每次开搜索框都重打两个源站，反过来更快触发限流（同 dlCacheTtl 的判据）。
 */
const SEARCH_FULL = 5 * 60_000;
const SEARCH_FAILED = 45_000;

function searchCacheTtl(v) {
  if (!v || !v.sources) return SEARCH_FAILED;
  const bad = Object.values(v.sources).some((s) => s && s.ok === false);
  return bad ? SEARCH_FAILED : SEARCH_FULL;
}

module.exports = {
  dlCacheTtl, dlRetryable, searchCacheTtl,
  FULL, FAILED, DEGRADED, SEARCH_FULL, SEARCH_FAILED,
};
