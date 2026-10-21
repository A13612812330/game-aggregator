/* v10.96 全模块抽样后修的四处 —— 静态防线
 *
 * 起因（用户口径：「检查是否有其他问题，抽样检查全模块」）：
 *   抽样跑完后发现的**真问题**（不是推测，都是现测出来的）：
 *   ① XD 分类页选择器失效 —— `/sort/pcgame/` 返回 200 / 58KB，但 `a.soft-title`
 *      出现 **0 次** ⇒ `/api/category` 每个分类都返回空数组，且不报错。
 *      实测还发现站点**只改了一半**：pcgame/host/mobile 是新布局，
 *      dzmx/jsby/gj 等细分分类仍是旧布局 ⇒ 两套选择器都得认。
 *   ② XD 搜索被站点限流时返回一张「提示信息」页（1,755 字节，正文
 *      「管理员设定搜索时间间隔为3秒」），旧代码从里面解析出 0 条 ⇒
 *      **「被限流」和「真没这款游戏」返回值完全一样**。
 *   ③ `/api/search` 对整份结果统一缓存 5 分钟，任一源失败也被锁 5 分钟 ——
 *      与 v10.95 修的 `/api/download` 是同一类问题（把失败缓存成结论）。
 *   ④ `/favicon.ico` 恒 404，每个访问者控制台都挂一条红字，会掩盖真正的 JS 报错。
 *
 * ★ 本套件守的是「这些坑不会再回来」，不是「代码长得像某段字符串」——
 *   所以判据尽量落在**行为**上（能用纯函数跑的就不读源码），
 *   必须读源码的地方先剥注释，且注释里绝不复述断言用的原文。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0; const fails = [];
function ok(c, name, extra) {
  if (c) { pass++; console.log('  PASS  ' + name + (extra ? '  — ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  × FAIL  ' + name + (extra ? '  — ' + extra : '')); }
}

/** 剥掉 JS 注释 —— 注释里出现的字符串会让「源码里有没有 XX」类断言恒真 */
function stripJs(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}
/** 剥掉 HTML 注释（派生页里大段注释含示例代码） */
function stripHtml(src) {
  return src.replace(/<!--[\s\S]*?-->/g, '');
}

const XD = read('fetchers/xdgamer.js');
const XD_CODE = stripJs(XD);
const TTL = read('data/dl-cache-ttl.js');
const SRV = read('server.js');
const SRV_CODE = stripJs(SRV);
const SECT = read('tools/resource-sections.js');
const SECT_CODE = stripJs(SECT);
const BUILD = stripJs(read('tools/build-resource-page.js'));
const RES_HTML = stripHtml(read('public/resources.html'));

console.log('=== v10.96 抽样修复防线 ===\n');

/* ============================================================
 * A 段：XD 分类页 —— 两套布局都要认
 * ============================================================ */
console.log('── A XD 分类页双布局 ──');
ok(/li:has\(a\[href\*="\/game\/"\]\):has\(a\.tit\)/.test(XD_CODE),
  'A1 认新布局（a.tit）');
ok(/li:has\(a\.soft-title\):has\(a\[href\*="\/game\/"\]\)/.test(XD_CODE),
  'A2 认旧布局（a.soft-title）—— 细分分类仍是旧结构，两套必须并存');
ok(/const push = \(o\)/.test(XD_CODE) && /seen\.has\(o\.id\)/.test(XD_CODE),
  'A3 两套结果按 id 去重（同一页只会命中一套，但不能重复入账）');
ok(/span\.type/.test(XD_CODE), 'A4 新布局的分类徽标取 span\.type');
ok(/time\.news/.test(XD_CODE), 'A5 新布局的日期取 time\.news');
ok(/评分\[：:\]\\s\*\(\[\\d\.\]\+\)/.test(XD_CODE), 'A6 新布局评分从「评分：x 分」解析');
ok(/Number\(sm2\[1\]\) > 0/.test(XD_CODE),
  'A7 评分 0 视为「没有」（站点对无评分游戏给 0，照填会显示「0 分」）');
/* 旧布局的评分是星星宽度，反推要写明来源，不能凭空 */
ok(/#stars/.test(XD_CODE) && /width/.test(XD_CODE), 'A8 旧布局评分按星星宽度反推');
/* ★ 反向断言：新布局**没有体积字段**，不许从别处猜一个填进去 */
{
  const seg = XD_CODE.slice(XD_CODE.indexOf('布局 A（新）'), XD_CODE.indexOf('布局 B（旧'));
  ok(!/size:\s*(?!null)/.test(seg), 'A9 新布局的 size 只能是 null（该页没有体积字段，不许猜）');
}

/* ============================================================
 * B 段：XD 搜索限流 —— 必须抛错，不能返回空数组
 * ============================================================ */
console.log('\n── B XD 搜索限流 ──');
ok(/LIMITED_RE/.test(XD_CODE), 'B1 有独立的限流识别正则');
ok(/管理员设定搜索时间间隔/.test(XD_CODE), 'B2 认的是提示页正文（站点原文）');
ok(/setTimeout\(\(r\) => r, 3600\)|setTimeout\(r => r, 3600\)|, 3600\)/.test(XD_CODE),
  'B3 重试要等够 3.6 秒（站点点名要 3 秒，卡临界会二次触发）');
ok(/throw new Error\([^)]*限流/.test(XD_CODE), 'B4 仍限流就抛错（让上层能如实显示原因）');
/* ★ 反向断言：识别段之后不能再出现「解析为空就 return []」这种兜底 */
{
  const seg = XD_CODE.slice(XD_CODE.indexOf('async function search'), XD_CODE.indexOf('const CATEGORIES'));
  ok(!/catch[\s\S]*?return items;\s*\}/.test(seg) && /throw new Error/.test(seg),
    'B5 搜索里没有「吞异常返回空数组」的兜底');
}

/* ============================================================
 * C 段：缓存 TTL 按结果决定（含 search）
 * ============================================================ */
console.log('\n── C 缓存 TTL ──');
const { searchCacheTtl, dlCacheTtl, SEARCH_FULL, SEARCH_FAILED } = require(path.join(ROOT, 'data/dl-cache-ttl.js'));
ok(typeof searchCacheTtl === 'function', 'C1 searchCacheTtl 已导出');
ok(searchCacheTtl({ sources: { xdgamer: { ok: false }, jidi: { ok: true, count: 2 } } }) === SEARCH_FAILED,
  'C2 任一源失败 → 短缓存（45 秒）', String(searchCacheTtl({ sources: { xdgamer: { ok: false }, jidi: { ok: true } } })));
ok(searchCacheTtl({ sources: { xdgamer: { ok: true, count: 0 }, jidi: { ok: true, count: 0 } } }) === SEARCH_FULL,
  'C3 两源都成功但都是 0 条 → 照常长缓存（这是真结论）');
ok(searchCacheTtl({ sources: { xdgamer: { ok: true, count: 3 }, jidi: { ok: true, count: 1 } } }) === SEARCH_FULL,
  'C4 有结果 → 长缓存');
ok(searchCacheTtl(null) === SEARCH_FAILED && searchCacheTtl({}) === SEARCH_FAILED,
  'C5 拿不到载荷 → 短缓存（宁可多抓一次，别锁死）');
ok(SEARCH_FAILED < SEARCH_FULL, 'C6 失败窗口确实比成功窗口短');
ok(/dlCacheTtl/.test(SRV_CODE) && /searchCacheTtl/.test(SRV_CODE),
  'C7 server 两处 TTL 都是函数形态（不是写死数字）');
/* 反向：不许再把 search 的 TTL 写死成数字 */
ok(!/cached\('search:' \+ q, \d+/.test(SRV_CODE) && !/cached\(key, 600_000, async \(\) => \{\s*const jidiHd/.test(SRV_CODE),
  'C8 search 的 cached 调用没有退回写死的毫秒数');

/* ============================================================
 * D 段：端游资源「本体」分区
 * ============================================================ */
console.log('\n── D 本体分区 ──');
ok(/id="resBody"/.test(RES_HTML), 'D1 派生页有 #resBody 容器');
ok(/data-et="body"/.test(RES_HTML), 'D2 容器带 data-et="body"（切换靠它收起）');
ok(/data-et="bd"[^>]*><b id="tabNumBd"/.test(RES_HTML), 'D3 页签条第 1 个是「本体」');
ok(/const ET_MAP = \{ bd: '#resBody'/.test(BUILD), 'D4 ET_MAP 已接入 bd');
ok(/let etCur = 'bd'/.test(BUILD), 'D5 默认页签是 bd');
ok(/switchResTab\(ET_MAP\[t\] \? t : 'bd'/.test(BUILD), 'D6 陌生 hash 落回 bd');
ok(/if \(t === 'bd'\) return initBd\(\)/.test(BUILD), 'D7 etInit 有 bd 分支');
ok(/BODY_HTML,\s*\n\s*MODS_HTML,/.test(BUILD), 'D8 组装时本体排在 MOD 之前');
ok(/<main class="wrap et-hide" id="mods"/.test(BUILD), 'D9 MOD 分区默认收起（默认已换成本体）');
/* 本体三个关键 id 都在产物里 */
for (const id of ['bdGrid', 'bdSearch', 'bdSorts', 'bdMore', 'bdCount', 'bdStats']) {
  ok(new RegExp('id="' + id + '"').test(RES_HTML), 'D10 #' + id + ' 在产物里');
}
/* 行为：按需抓取，不进页面就抓 */
ok(/data-bd-tid/.test(SECT_CODE), 'D11 卡片上有「查本体下载」按钮');
ok(/async function bdFetchOne/.test(SECT_CODE), 'D12 抓取函数存在');
ok(/\/api\/download\?url=/.test(SECT_CODE), 'D13 抓取走 /api/download（复用同一个解析器）');
ok(/section === 'body'/.test(SECT_CODE), 'D14 只取 body 专区的条目（不把 Mod 混进本体）');
ok(/localStorage/.test(SECT_CODE) && /gh\.bd\.links/.test(SECT_CODE),
  'D15 结果按 tid 存本机（复访不重抓）');
ok(/BD_LS_MAX/.test(SECT_CODE), 'D16 本机缓存有上限（配额满了不能把 localStorage 写爆）');
/* 盘口映射：必须覆盖主力盘口 */
for (const k of ['quark', 'baidu', 'xunlei', 'ali', '123', 'lanzou', 'uc', '139', '189']) {
  ok(new RegExp("bd-" + k).test(RES_HTML) || new RegExp("'" + k + "'").test(SECT_CODE),
    'D17 盘口样式 bd-' + k + ' 可用');
}
ok(/function bdGroupByPost/.test(SECT_CODE), 'D18 按帖子聚合（一条 item 一个盘口，同帖要收进一行）');
/* ★★ v10.97：卡形改了 —— 卡面**不再铺前 3 帖**（用户口径「只需要游戏名称+游戏原名+大小热度」），
   帖子全收进 `#dlPop` 弹窗。原来那条 `slice(0, 3)` 判据随之失效（不是红，是**找不到依据**）。
   ⇒ 换成两条守同一件事：① 卡面渲染器里**不出现** `bdPostRow`（不铺行）；
      ② 正向锚点：`bdPostRow` 仍然存在且被 `bdAllPop` 用着（帖子没丢，只是搬进弹窗）。
   ⚠️ 只删不加 ⇒ 「卡面干脆不渲染任何帖子」也会绿，而那正是本轮要避免的另一半。 */
{
  const iCard = SECT_CODE.indexOf('function bdCard');
  const iFetch = SECT_CODE.indexOf('async function bdFetchOne');
  const cardSeg = (iCard >= 0 && iFetch > iCard) ? SECT_CODE.slice(iCard, iFetch) : '';
  ok(cardSeg.length > 0 && !/bdPostRow\(/.test(cardSeg),
    'D19 卡面不铺帖子行（v10.97 卡形：只留名称/原名/大小/热度 + 卡底按钮）',
    cardSeg ? `${cardSeg.length} 字符片段` : '切片失败(选择器/detect 不对)');
  ok(/function bdPostRow/.test(SECT_CODE) && /function bdAllPop/.test(SECT_CODE)
    && /bdPostRow\(/.test(SECT_CODE.slice(SECT_CODE.indexOf('function bdAllPop'))),
    'D19b 正向锚点：帖子行渲染仍在，且被弹窗用着（帖子是搬家不是删除）');
}
ok(/data-bd-more/.test(SECT_CODE) && /function bdAllPop/.test(SECT_CODE),
  'D20 超出部分进弹窗看全量');
/* 反向：不许在 init 里**批量**抓。
   ⚠️ 判据不能是「initBd 里出现过 bdFetchOne」—— 它当然会出现，在点击回调里（那才是对的）。
      要守的是「有没有一个循环/并发把所有卡一起抓」：那样的后果是一次进页面打 24 次机地。
      ★ 行为侧的权威判据在实拍探针 _probe-v1096-bd.js 的 A5（进页面下载请求 0 次）。 */
{
  const seg = SECT_CODE.slice(SECT_CODE.indexOf('async function initBd'));
  ok(!/(forEach|\.map\(|for\s*\(|Promise\.all)[\s\S]{0,220}bdFetchOne\(/.test(seg),
    'D21 initBd **不**批量自动抓取（24 张卡全抓必然触发限流）');
  ok(/addEventListener\('click'/.test(seg), 'D22 抓取由点击触发（不是进页面就发）');
}

/* ============================================================
 * E 段：favicon
 * ============================================================ */
console.log('\n── E favicon ──');
ok(/app\.get\('\/favicon\.ico'/.test(SRV_CODE), 'E1 服务端有 /favicon.ico 路由');
ok(/status\(204\)/.test(SRV_CODE), 'E2 回 204（不是 404 —— 这不是缺陷，但会污染控制台）');
ok(/rel="icon"/.test(stripHtml(read('public/index.html'))), 'E3 head 里仍有内联图标声明');

/* ============================================================
 * F 段：跨模块一致性
 * ============================================================ */
console.log('\n── F 一致性 ──');
ok(/jiditopics/.test(SECT_CODE) && /\/api\/jiditopics\/list/.test(SECT_CODE),
  'F1 本体列表用的是机地话题库接口（17,220 款，不是自己另建一份）');
ok(!/17220/.test(SECT_CODE), 'F2 本体区的数字没有写死（17,220 会随同步变）');
ok(/tabNumBd/.test(BUILD), 'F3 本体页签数字由接口回填');
/* 三个老分区不能被第四区挤掉 */
for (const id of ['mods', 'resSaves', 'resTrainers']) {
  ok(new RegExp('id="' + id + '"').test(RES_HTML), 'F4 老分区 #' + id + ' 仍在');
}

console.log('\n' + '='.repeat(64));
console.log('结果：' + pass + ' / ' + (pass + fail) + (fail ? '  · 失败 ' + fail : ''));
if (fail) { console.log('失败项：'); fails.forEach((x) => console.log('  - ' + x)); }
process.exit(fail ? 1 : 0);
