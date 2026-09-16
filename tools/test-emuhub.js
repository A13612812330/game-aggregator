/* ⚠️ 已废弃 —— 保留仅为兼容旧命令，内部转调新测试。
 *
 * 历史：本脚本原本验证「首页内联的三个手机子页签」（#emuHub + #emulator/#phonecfg/#emuguide）。
 * 轮 15 后手机专区已拆成独立页 /emulator.html，首页只剩一张引导卡，
 * 三个分区以及它们的 DOM 全部搬走 —— 旧断言必然失败（找不到 #emuguide 等）。
 *
 * 新的回归脚本：tools/test-emulator-page.js
 *   - 首页：确认只剩 1 个 <main>、引导卡指向 /emulator.html、顶栏三个入口带 hash 深链
 *   - 独立页：三子页签互切、深链 #pc/#eg、封面渲染、点击分流、数字回填
 */

console.log('[已废弃] test-emuhub.js 的职责已迁移到 test-emulator-page.js，正在转调…\n');
require('./test-emulator-page.js');
