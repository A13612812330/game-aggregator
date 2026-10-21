/**
 * `/api/download` 的缓存时长策略 —— 单独成模块，只为一件事：**能被测**。
 *
 * 起因（v10.95，用户口径「机地有很多免费的下载本体链接，为什么只显示 XD 的」）：
 *   机地取 env 偶发拿到挑战页 ⇒ 本体专区回 405、0 帖，而这份「0 帖」被当成
 *   正常结果缓存了 30 分钟。同一进程里 2 秒后现抓同一话题
 *   （tid 640827939 星砂岛）→ 本体 3 帖 / 5 条网盘链接。
 *   ⇒ 这不是「机地没有」，是**把一次失败缓存成了结论**。
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

module.exports = { dlCacheTtl, dlRetryable, FULL, FAILED, DEGRADED };
