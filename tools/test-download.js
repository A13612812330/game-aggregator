/* 「下载链接」链路的常驻防线（v10.22 新增）
 *
 * 覆盖三块**新写、且都出过错**的东西：
 *   ① fetchers/download.js —— XD 的 302 解析 + 机地帖子链接（Location 头乱码、版本串正则）
 *   ② data/jiditopics.js  —— 机地全量话题库读取层（17,220 条）
 *   ③ 前端下载弹窗的**接线**（.dlpop 的层级、三页是否都带上、入口按钮是否存在）
 *
 * ★ 为什么必须有：这三块都是「静默出错」型 ——
 *   · host 键没归一 → 打到另一个站 → 只报一句 HTTP 404，看不出是键的问题
 *     （本版实测踩到：parseDetailUrl 给 `xdgame.com`，而 XD_HOSTS 的键是 `xdgame`，
 *      于是静默退到 xdgamer.com，那个站根本没有这个 id）
 *   · 弹窗 z-index 低于详情抽屉 → 从抽屉里点开会被整个盖住，
 *     而「元素存在 / 占版面 / 可点」全部成立 —— 最危险的那类假绿
 *   · 派生页没重建 → 首页有弹窗、手机专区与解包页没有，且两边都不报错
 *
 * 纯本地、无网络、无副作用（不请求任何接口）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const dl = require('../fetchers/download');
const jt = require('../data/jiditopics');
const match = require('../data/spec-match');

let pass = 0, fail = 0;
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else { fail++; console.log('  × FAIL  ' + name + (detail ? '  — ' + detail : '')); }
};
const eq = (got, want, name) => ok(got === want, name, '得到 ' + JSON.stringify(got) + '，期望 ' + JSON.stringify(want));

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ============================================================
 *  ① XD 主机名归一 —— 本版实测踩到的真 bug
 * ============================================================ */
console.log('=== ① XD 主机名归一（parseDetailUrl 给的是 hostname，XD_HOSTS 的键是短名）===');
eq(dl.normHost('xdgame'), 'xdgame', '短名 xdgame 原样通过');
eq(dl.normHost('xdgame.com'), 'xdgame', '★ hostname `xdgame.com` 归一成 xdgame（不归一会静默打到 xdgamer.com）');
eq(dl.normHost('www.xdgame.com'), 'xdgame', '带 www. 前缀也归一');
eq(dl.normHost('https://www.xdgame.com/game/1.html'), 'xdgame', '整条 URL 也能归一');
eq(dl.normHost('XDGAME.COM'), 'xdgame', '大小写不敏感');
eq(dl.normHost('xdgamer'), 'xdgamer', '短名 xdgamer 原样通过');
eq(dl.normHost('www.xdgamer.com'), 'xdgamer', 'xdgamer.com 归一成 xdgamer');
eq(dl.normHost(''), null, '空串返回 null（不瞎猜，由调用方兜底）');
eq(dl.normHost('evil.com'), null, '白名单外的域名返回 null');
eq(dl.normHost('xdgame.com.evil.com'), null, '★ 后缀伪装域名不许通过（不是 includes 判定）');
ok(Object.prototype.hasOwnProperty.call(dl.XD_HOSTS, 'xdgame') &&
  Object.prototype.hasOwnProperty.call(dl.XD_HOSTS, 'xdgamer'),
  'XD_HOSTS 同时有 xdgame 与 xdgamer 两个键（两套平行站，不能只留一个）');

/* ============================================================
 *  ② Location 头乱码修复
 * ============================================================ */
console.log('\n=== ② Location 头 latin1↔utf8 乱码 ===');
const REAL = 'https://cloud.189.cn/t/vuaiQfq2iMjq（访问码：2o8s）';
const MOJI = Buffer.from(REAL, 'utf8').toString('latin1');
eq(dl.fixMojibake(MOJI), REAL, '★ 把被按 latin1 解码的 Location 还原回原文（含中文访问码）');
ok(!/\uFFFD/.test(dl.fixMojibake(MOJI)), '还原结果里不许出现替换字符 U+FFFD');
eq(dl.fixMojibake(REAL), REAL, '★ 已经是合法 UTF-8 的串必须原样返回（去掉 U+FFFD 判据就会在这里二次损坏）');
eq(dl.fixMojibake('https://pan.baidu.com/s/1abc?pwd=b4s5'), 'https://pan.baidu.com/s/1abc?pwd=b4s5',
  '纯 ASCII URL 原样返回');
eq(dl.fixMojibake(null), '', 'null 安全降级为空串');
eq(dl.fixMojibake(undefined), '', 'undefined 安全降级为空串');

console.log('\n=== ②-b 访问码 / 提取码拆分 ===');
eq(dl.splitPwd('https://pan.baidu.com/s/1x?pwd=b4s5').pwd, null, 'URL 自带 ?pwd= 时不当成访问码（内嵌 query 不动）');
eq(dl.splitPwd(REAL).url, 'https://cloud.189.cn/t/vuaiQfq2iMjq', '中文括号里的访问码从 URL 上剥掉');
eq(dl.splitPwd(REAL).pwd, '访问码：2o8s', '访问码原样取出给前端展示');
eq(dl.splitPwd('https://pan.xunlei.com/s/abc').pwd, null, '无访问码时返回 null');

/* ============================================================
 *  ③ XD 详情页解析（纯函数，吃 HTML 字符串）
 * ============================================================ */
console.log('\n=== ③ XD 详情页 .article-down 解析 ===');
const XD_HTML = `<html><head><title>t</title></head><body>
<div class="article-tit"><h1>妈妈，我真的在学外语<small>SLG</small></h1></div>
<div class="article-down"><ul>
  <li><a class="downbtn normal" data-url="/plus/download.php?open=2&amp;id=15990&amp;uhash=aaa" data-server="百度网盘">百度网盘</a></li>
  <li><a class="downbtn normal" data-url="/plus/download.php?open=2&amp;id=15990&amp;uhash=bbb" data-server="天翼网盘">天翼网盘</a></li>
  <li><a class="downbtn normal" data-url="/plus/download.php?open=2&amp;id=15990&amp;uhash=ccc" data-server="迅雷网盘">迅雷网盘</a></li>
  <li><a class="downbtn normal" data-url="/plus/download.php?open=2&amp;id=15990&amp;uhash=ddd" data-server="夸克网盘">夸克网盘</a></li>
  <li><a class="downbtn normal" data-url="/plus/download.php?open=2&amp;id=15990&amp;uhash=eee" data-server="移动网盘">移动网盘</a></li>
  <li><a class="downbtn normal" data-url="/plus/download.php?open=2&amp;id=15990&amp;uhash=fff" data-server="正版购买">正版购买</a></li>
</ul></div>
<h4>版本介绍</h4><p>Build.25183906|容量1.6GB|官方简体中文|支持键盘.鼠标</p>
</body></html>`;
const p = dl.parseXdDown(XD_HTML, 'https://www.xdgame.com');
eq(p.items.length, 6, '★ 6 个盘口一个不漏');
eq(p.items[0].serverUrl, 'https://www.xdgame.com/plus/download.php?open=2&id=15990&uhash=aaa',
  '相对 data-url 拼成绝对地址，且 &amp; 已还原成 &');
eq(p.items[0].server, '百度网盘', 'data-server 透传为盘口名');
eq(p.version, 'Build.25183906|容量1.6GB|官方简体中文|支持键盘.鼠标',
  '★ 版本串按「<h4>版本介绍</h4><p>…</p>」定位（去找「版本：」这三个字在原文里根本不存在）');
eq(p.title, '妈妈，我真的在学外语', '标题取 .article-tit h1，并剥掉里面的 <small> 徽标');
ok(p.items.every((x) => x.real === null && x.kind === 'downbtn'),
  '解析阶段不带 real（真实地址要靠跟 302 拿），且标了来源 kind');

/* 兜底：页面结构改名时从全文捞 Build.xxx|… */
const p2 = dl.parseXdDown('<body><p>Build.26100000|容量2GB|官方中文</p></body>', 'https://www.xdgame.com');
eq(p2.version, 'Build.26100000|容量2GB|官方中文', '结构变化时退到全文捞 `Build.<数字>|` 那一串');

console.log('\n=== ③-b 网盘识别与入口 ===');
eq(dl.serverOf('https://pan.quark.cn/s/3faa'), '夸克网盘', '夸克链接识别');
eq(dl.serverOf('https://store.steampowered.com/app/1/'), '其他链接',
  'Steam 商店不在网盘表里 —— 盘口名由 data-server 给，不靠 URL 猜');
(async () => {
  let threw = null;
  try { await dl.resolve({ source: 'bogus', id: '1' }); } catch (e) { threw = e.message; }
  ok(threw && /不支持的来源/.test(threw), 'resolve 遇到未知 source 明确报错，不静默返回空');

  /* ============================================================
   *  ③-c 源站权限门（XD 对部分游戏返回 200 +「你没有权限下载」）
   *
   *  ★ 这一段全部**离线**：线上验它需要恰好挑中一款被锁的游戏，数据一更新就验不到了。
   *    但它恰恰是「弹窗里 0 条链接」时唯一的解释来源 —— 解释没了，用户只能以为本站坏了。
   * ============================================================ */
  console.log('\n=== ③-c 源站权限门（200 +「你没有权限下载」）===');
  const AUTH_HTML = '<html><head><title>你没有权限下载：钢铁雄心4/Hearts of Iron IV！</title></head>'
    + '<body><div class="err">你没有权限下载：钢铁雄心4/Hearts of Iron IV！</div></body></html>';
  ok(dl.NEED_AUTH_RE.test(AUTH_HTML), '★ 能识别权限页（按标题/正文的「你没有权限下载」）');
  ok(dl.NEED_AUTH_RE.test('<div>请先登录后再下载</div>'), '识别变体：请先登录');
  ok(!dl.NEED_AUTH_RE.test(XD_HTML), '★ 正常详情页不能被误判为权限页（否则好游戏也提示去登录）');
  ok(!dl.NEED_AUTH_RE.test('下载失败，请稍后重试'), '「稍后重试」类提示不能当成权限门（两者出口不同）');

  /* 整组判定：三个条件缺一不可 */
  ok(dl.needAuthOf([{ real: null, needAuth: true }, { real: null, needAuth: true }]) === true,
    '★ 全部盘口都报权限 → needAuth 成立');
  ok(dl.needAuthOf([{ real: 'https://pan.baidu.com/s/1' }, { real: null, needAuth: true }]) === false,
    '★ 只要有一条解得出来，就不能弹「要登录」（否则把能给的结果也藏了）');
  ok(dl.needAuthOf([{ real: null, error: 'HTTP 502' }, { real: null, error: 'HTTP 502' }]) === false,
    '★ 全是网络错误 ≠ 权限门 —— 应引导「稍后重试」而不是「去登录」');
  ok(dl.needAuthOf([]) === false, '空列表不是权限问题（是根本没解析出盘口）');
  ok(dl.needAuthOf(null) === false, '非数组入参不炸');

  /* ============================================================
   *  ④ 机地全量话题库读取层
   * ============================================================ */
  console.log('\n=== ④ 机地全量话题库（data/jiditopics.js）===');
  const st = jt.stats();
  ok(st.ok === true, 'stats() 可读', st.error || '');
  ok(st.total > 17000, '★ 全量话题数 > 17,000（老实现只有人工精选的 66 条）', '实测 ' + st.total);
  ok(st.hasCover === st.total, '封面覆盖等于总数（封面是卡片版式的前提）', st.hasCover + '/' + st.total);
  ok(st.hasAppid / st.total > 0.95, '★ appid 覆盖 > 95%（它是与 XD 精确对齐的唯一键）',
    (st.hasAppid / st.total * 100).toFixed(1) + '%');
  ok(st.hasMin > 16000, '最低配置覆盖 > 16,000（解包匹配的数据基座）', String(st.hasMin));
  ok(st.hasDx > 7000, '★ DX 覆盖 > 7,000（曾经只有 2%，两个 bug 叠加的结果）', String(st.hasDx));
  ok(st.downloadable > 300, '有可下载资源帖的话题 > 300', String(st.downloadable));

  const hot = jt.list({ limit: 10 });      // 刻意**不传 sort**：验的就是默认值
  ok(hot.ok === true && hot.items.length === 10, 'list() 返回 10 条');
  eq(hot.sort, 'hot', '未指定 sort 时默认 hot（「可适配游戏优先推热门」的另一条出口）');
  let desc = true;
  for (let i = 1; i < hot.items.length; i++) if ((hot.items[i].dpv || 0) > (hot.items[i - 1].dpv || 0)) desc = false;
  ok(desc, '★ 热度榜严格按 dpv 降序（排序键写错会静默给出一串乱序）',
    hot.items.slice(0, 3).map((x) => x.title + ':' + x.dpv).join(' | '));
  ok(hot.items[0].dpv > 100000, '热度榜首 dpv > 10 万（说明读的是真实浏览量而非占位 0）',
    String(hot.items[0].dpv));

  const dlOnly = jt.list({ dl: true, limit: 200 });
  ok(dlOnly.ok && dlOnly.items.length > 0, 'dl=1 能筛出「有资源帖」的话题', String(dlOnly.items.length));
  ok(dlOnly.items.every((x) => Number(x.modCnt) > 0), '★ dl=1 的结果里**每一条** modCnt 都 > 0（过滤器不许漏）');

  const kw = jt.list({ q: '剑星', limit: 5 });
  ok(kw.ok && kw.total >= 1, '关键词检索可用', '剑星 命中 ' + kw.total + ' 条');

  /* ============================================================
   *  ⑤ 解包匹配：热门优先 + 真实字段（对应「不要推断」「优先推热门」）
   * ============================================================ */
  console.log('\n=== ⑤ 解包匹配（data/spec-match.js）===');
  const profile = {
    arch: { raw: 'arm64-v8a' }, ram: { gb: 12 }, storage: { gb: 256 },
    layer: { dxvk: '2.4', box64: '0.3.4' }, api: [],
  };
  const an = match.analyze(profile, { limit: 30 });
  ok(an.ok === true, 'analyze 可跑', an.error || '');
  eq(an.stats.sort, 'hot', '★ 不传 sort 时默认 hot（用户口径：可适配游戏优先推热门）');
  ok(an.stats.scanned > 16000, '扫描 > 16,000 款（不再是 653 款的 Steam 单一源）', String(an.stats.scanned));
  ok(/机地/.test(an.stats.source) && /Steam/.test(an.stats.source),
    '★ 口径如实写明「机地 + Steam 官方，按 appid 合并」', an.stats.source);
  const it0 = an.items[0];
  ok(!!it0.cover, '★ 结果条目带封面（卡片版式的前提，没有就退化成纯文字列表）', String(it0.cover).slice(0, 52));
  ok(it0.hot > 0, '结果条目带热度 hot', String(it0.hot));
  ok(['jidi', 'steam', 'jidi+steam'].indexOf(it0.reqFrom) >= 0,
    '★ 条目带 reqFrom（要求来自哪个源），前端才能如实标注而不是写「推断」', String(it0.reqFrom));
  ok(it0.jidiTid || it0.libUrl, '条目至少带一个可取下载的入口（jidiTid / libUrl）',
    'jidiTid=' + it0.jidiTid + ' libUrl=' + it0.libUrl);

  const items = an.items.slice(0, 20);
  let hotDesc = true;
  for (let i = 1; i < items.length; i++) {
    const a = items[i - 1], b = items[i];
    if (match.ORDER[a.verdict] !== match.ORDER[b.verdict]) continue;   // 先按判定分组，组内才看热度
    if ((b.hot || 0) > (a.hot || 0)) hotDesc = false;
  }
  ok(hotDesc, '★ 同判定组内按热度降序（组间按「流畅→可跑→…」排序，两者都不许乱）',
    items.slice(0, 3).map((x) => x.name + ':' + x.hot).join(' | '));

  /* 「流畅」只由内存余量决定：存储余量不许单独把游戏刷成流畅。
     ★ 这一条是**反证过**的：把规则改回 `ramM >= 2 || stM >= 3`，本行立刻变红
       （4GB 内存 ÷ 4GB 要求 = 1 倍，但 16GB 空间 ÷ 1GB = 16 倍，旧规则会判「流畅」）。 */
  const tiny = match.judge(
    { arch: { raw: 'x86_64' }, ram: { gb: 4 }, storage: { gb: 16 }, layer: {}, api: [] },
    { ramGb: 4, storageGb: 1, dx: 9 });
  eq(tiny.verdict, 'ok',
    '★ 4GB 内存打 4GB 要求 → 「可跑」而不是「流畅」（存储余量大不叫跑得顺）');

  /* ============================================================
   *  ⑥ 前端接线：弹窗层级 / 三页齐备 / 入口按钮
   * ============================================================ */
  console.log('\n=== ⑥ 前端下载弹窗接线 ===');
  const idx = read('public/index.html');
  ok(/id="dlPop"/.test(idx), '主源有弹窗节点 #dlPop');
  ok(/function openDownload/.test(idx) && /function closeDownload/.test(idx), '主源有 open/closeDownload');
  ok(/data-dl-open/.test(idx), '主源有唤起入口 data-dl-open');
  ok(/\.dlpop\{[^}]*z-index\s*:\s*(\d+)/.test(idx), '弹窗有 z-index 声明');

  const zOf = (css, sel) => {
    const m = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{[^}]*z-index\\s*:\\s*(\\d+)').exec(css);
    return m ? Number(m[1]) : null;
  };
  const zPop = zOf(idx, '.dlpop');
  const zDrawer = zOf(idx, '.drawer');
  const zMask = zOf(idx, '.mask');
  ok(zPop != null && zDrawer != null, '能取到弹窗与详情抽屉的 z-index',
    'pop=' + zPop + ' drawer=' + zDrawer);
  ok(zPop > zDrawer, '★★ 弹窗层级必须**高于详情抽屉**（否则从抽屉里点开会被整个盖住，而所有「存在性」断言照样绿）',
    zPop + ' > ' + zDrawer);
  ok(zPop > zMask, '弹窗层级高于遮罩 #mask', zPop + ' > ' + zMask);

  /* 详情页必须把「跳转链接」升级成下载入口，且带双源参数 */
  ok(/class="go dl"[^>]*data-dl-open/.test(idx), '★ 详情页底部有「⬇ 网盘下载」主按钮');
  ok(/data-dl-url="\$\{esc\(d\.url/.test(idx), '下载按钮把当前源详情页 URL 传给弹窗');
  ok(/data-dl-jidi="\$\{esc\(fb\.jidiUrl/.test(idx), '下载按钮把机地详情页 URL 也带上（双源一次取全）');
  /* ★ v10.23：跨源那处的取值口径改了 —— 目标是机地时就是 hit.url；
     目标是 XD 时机地详情页是**当前这一页**（d.url）。原先写死 hit.jidiUrl 只会取到空串。 */
  ok(/jidiUrl: it\.jidiUrl/.test(idx)
    && /jidiUrl: hitSource === 'jidi' \? hit\.url : \(d\.source === 'jidi' \? d\.url : ''\)/.test(idx),
    '★ 三处 fb 兜底都补了 jidiUrl（列表行 / 热榜 / 搜索跨源），漏一处那条链路就取不到机地侧');

  for (const page of ['public/emulator.html', 'public/unpack.html']) {
    const t = read(page);
    ok(/id="dlPop"/.test(t) && /function openDownload/.test(t),
      '★ ' + page + ' 已重建并带上弹窗（改了主源不重建派生页，那边就没有弹窗且不报错）');
  }

  /* ★ 权限受限时的「说明 + 出口」必须真的接上去：
     只改 JS 不加 CSS，块会渲染成一行没有边框的裸文字（存在性断言照样绿）。 */
  ok(/function dlBlocked/.test(idx), '主源有 dlBlocked()（整组取不到时的说明块）');
  ok(/\.dl-blocked\{/.test(idx), '★ .dl-blocked 有样式（否则说明块长得像加载失败的空壳）');
  ok(/\.dl-blocked\{[^}]*background/.test(idx), '.dl-blocked 有底色（与正常行区分开）');
  ok(/\.dl-go\{/.test(idx), '★ .dl-go 有样式（去源站的出口按钮）');
  ok(/dlBlocked\('XDGAME 官方盘口'/.test(idx), '★ XD 组取不到时会走 dlBlocked，而不是整组消失');
  ok(/needAuth/.test(idx) && /登录\s*\/\s*权限/.test(idx),
    '★ 文案区分「源站要求登录 / 权限」与「解析失败」（前者重试一万次也没用）');
  ok(/needAuth:\s*!!data\.needAuth/.test(read('server.js')),
    '服务端把 needAuth 透传给前端（只看 items 里有没有 real，前端分不清「被锁」和「超时」）');

  /* 解包页：结果卡片要跟手机专区同版式 */
  const up = read('public/unpack.html');
  ok(/class="emu-grid up-list"/.test(up), '★ 解包结果容器复用手机专区的 .emu-grid 网格');
  ok(/class="emu-card[^"]*up-mc/.test(up), '★ 结果卡片复用手机专区的 .emu-card 版式（不是另写一套）');
  ok(/btn\('hot', '🔥 热门优先'/.test(up), '解包页有「🔥 热门优先」排序按钮');
  ok(/sort: 'hot'/.test(up), '★ 解包页默认排序是 hot（不是规模优先）');
  ok(/data-dl-open/.test(up), '★ 解包页卡片能直接唤起下载弹窗');
  ok(/\.up-mc-btns/.test(up) && /\.up-mc-src/.test(up), '解包页补了「要求来源」与按钮行样式');
  ok(!/对照库：Steam 官方配置要求/.test(up), '★ 判定依据面板不再写死「Steam 官方配置要求 N 款」这种过期口径');

  /* ============================================================
   *  ⑦ 服务端路由存在性
   * ============================================================ */
  console.log('\n=== ⑦ 服务端路由 ===');
  const srv = read('server.js');
  ok(/app\.get\('\/api\/download'/.test(srv), '/api/download 路由存在');
  ok(/app\.get\('\/api\/jiditopics\/stats'/.test(srv), '/api/jiditopics/stats 路由存在');
  ok(/app\.get\('\/api\/jiditopics\/list'/.test(srv), '/api/jiditopics/list 路由存在');
  ok(/require\('\.\/data\/jiditopics'\)/.test(srv), 'server.js 已引入机地话题库读取层');
  ok(/parseDetailUrl\(rawUrl\)/.test(srv), '★ /api/download 优先用 url 解析（两套平行站同 id ≠ 同游戏）');

  console.log('\n============================');
  console.log('  通过 ' + pass + '/' + (pass + fail) + '（失败 ' + fail + '）');
  console.log('============================');
  process.exit(fail ? 1 : 0);
})();
