/* 机地「话题资源专区」（本体 / mod / 修改器）链路的常驻防线 —— v10.26 新增
 *
 * 覆盖三块**新写、且都属于「静默出错」型**的东西：
 *   ① fetchers/jidiPosts.js  —— 三专区接口 + 归一化（标签/封面/游戏名三个字段都踩过空值坑）
 *   ② fetchers/jidiSigned.js —— 新增的 envPath（详情页 env 没有 host，取错页面会误导成「源站改版」）
 *   ③ 前端下载弹窗的**按专区分块**（dlJidiGroups / .dl-secs），以及服务端的 sections 透传
 *
 * ★ 为什么这套必须有（三条都是「不报错、但结果是错的」）：
 *   · `tagsOf` 读顶层 `p.resource_tag` —— 该字段在真实结构里**不存在**，
 *     于是徽标永远是空数组、界面上一行都不显示，且全链路零报错
 *   · `coverOf` 只认数组 —— 而上游 `imgs` 是 **JSON 字符串**，`Array.isArray` 恒为假，
 *     封面静默变 null（卡片退化成纯文字）
 *   · `envPath` 不拆 —— `getEnv('/topic/detail/<tid>')` 会抛「机地页面未内嵌 env（可能改版）」，
 *     把人往「源站改版」带，其实只是取错了页面
 *
 * ★ 本套**纯本地、无网络**（与 test-download.js 同一原则）。真去请求源站的那段
 *   用环境变量开关：`JIDI_LIVE=1 node tools/test-v1026-jidiposts.js`，默认跳过。
 *
 * ★ 反证（改坏必须变红，逐条已实跑）：
 *   · `tagsOf` 去掉 `|| gi.resource_tag` 那一支 → 「★ 标签取自 game_info…」变红
 *   · `coverOf` 去掉字符串分支             → 「★ imgs 是 JSON 字符串…」变红
 *   · `sortPosts` 去掉「有标题优先」        → 「★ 无标题帖压到最后」变红
 *   · `jidiPosts.SECTIONS` 的 resourceType 改成 4/5/6 → 「★ 三个专区的 resource_type」变红
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const jp = require('../fetchers/jidiPosts');
const dl = require('../fetchers/download');

let pass = 0, fail = 0;
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  — ' + detail : '')); }
  else { fail++; console.log('  × FAIL  ' + name + (detail ? '  — ' + detail : '')); }
};
const eq = (got, want, name) => ok(got === want, name, '得到 ' + JSON.stringify(got) + '，期望 ' + JSON.stringify(want));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ============================================================
 *  ① 专区定义 —— 与源站 folder_list 对标
 * ============================================================ */
console.log('=== ① 三专区定义（本体 / mod / 修改器）===');
eq(jp.SECTIONS.length, 3, 'SECTIONS 恰好三个专区');
eq(jp.SECTIONS.map((s) => s.key).join(','), 'body,mod,modifier', '分区键顺序稳定：body / mod / modifier');
eq(jp.SECTIONS.map((s) => s.name).join(','), '本体,mod,修改器', '专区名与源站 folder_list 一致（本体 / mod / 修改器）');
/* ★ 生效的是 resource_type；folder_id 只作对标文档（服务端实测忽略它） */
eq(jp.SECTIONS.map((s) => s.resourceType).join(','), '1,2,3',
  '★ 三个专区的 resource_type = 1/2/3（这是**唯一生效**的过滤键；改成别的值本行即红）');
eq(jp.SECTIONS.map((s) => s.folderId).join(','), '7,6,8',
  'folder_id 记为 7/6/8（与源站 folder_list 一致，但实测服务端忽略它——只作对标文档）');
eq(jp.C_TYPES.join(','), '1,2', '★ c_types 固定 [1,2]（还原自 app chunk 的 SUPPORT_POSTS_CTYPE，省了会把空标题评论帖排上来）');
ok(jp.SORTS.indexOf('hot') >= 0 && jp.SORTS.indexOf('new') >= 0 && jp.SORTS.indexOf('reply') >= 0,
  'sort 枚举齐（hot / new / reply，与站点 TOPIC_SORT 一致）');
eq(jp.PAGE_LIMIT, 100, '★ 单页上限记 100（实测传 200 仍只回 100，写错会让翻页死循环或漏数据）');

/* ============================================================
 *  ② 归一化：三个字段都是「取错位置就静默为空」
 * ============================================================ */
console.log('\n=== ② 归一化（标签 / 封面 / 游戏名）===');

/* 真实样本（照抄源站接口返回的形态，含那三个坑）：
   · 标签只在 game_info.resource_tag，顶层没有
   · imgs 是 **JSON 字符串**
   · topic 是 **JSON 字符串** */
const POST = {
  id: 2735899517,
  title: '【亲测可用】虚拟化版|剑星|官方中文|支持DLSS4+FSR3|键盘鼠标手柄',
  content: '"https://pan.baidu.com/s/1col-sSt-R1KBUYauSvVy4A?pwd=ba53\n'
    + 'https://pan.xunlei.com/s/VP-Ele3lc_3eNT_vJGh-PG7sA1?pwd=lqtz\n'
    + 'https://pan.quark.cn/s/0b9299f694a7?pwd=jidi\n'
    + '❗️使用说明：\na.下载到"非中文"的文件夹内。\n'
    + 'd.如仍有问题，请看：https://jidiyouxi.com/problemTutorial\n',
  imgs: '[{"id":995325,"urls":{"360":{"urls":["http://img2.52jidi.com/img/view/id/995325/sz/360"]},'
    + '"540":{"urls":["http://img2.52jidi.com/img/view/id/995325/sz/540"]}}}]',
  topic: '{"id":171085167,"mid":0,"topic":"剑星","cover":649608}',
  member: { name: '游戏领域大神' },
  game_info: {
    installation: '虚拟化版',
    version_desc: 'Build.24463856',
    resource_tag: [{ tag: '已测试', hover: '…' }, { tag: '迅雷网盘免费高速', hover: '…' }],
  },
  ct: 1786974735, ut: 1789894044, dpv: 12180, pv: 6252, favors: 2, reviews: 1,
};
const SEC = jp.SECTIONS[0];
const S = jp.shapePost(POST, SEC);

eq(S.id, '2735899517', 'id 转字符串（前端 data-* 与 Map 键都用字符串）');
eq(S.title, '【亲测可用】虚拟化版|剑星|官方中文|支持DLSS4+FSR3|键盘鼠标手柄', '标题原样');
eq(S.game, '剑星', '★ 游戏名从 `topic` 解析（它是 **JSON 字符串**，不 parse 会是整串 JSON）');
ok(S.links.length === 3, '抽出 3 条网盘链接', S.links.map((l) => l.kind).join(' / '));
ok(S.links.every((l) => !/jidiyouxi\.com/.test(l.url)),
  '★ 站内的 problemTutorial 帮助链接被丢掉（否则下载清单里混进一条废话）');
eq(S.links.map((l) => l.kind).join(','), '百度网盘,迅雷网盘,夸克网盘', '盘口识别按 NETDISK 表');
eq(S.tags.length, 2, '★ 标签取自 game_info.resource_tag（读顶层的 p.resource_tag 会得到 []，本行即红）');
eq(S.tags[0], '已测试', '标签内容正确');
eq(S.installation, '虚拟化版', '玩法标记（虚拟化版 / 解压即撸）取 game_info.installation');
eq(S.version, 'Build.24463856', '版本串取 game_info.version_desc');
ok(!!S.cover && /img2\.52jidi\.com/.test(S.cover),
  '★ imgs 是 JSON 字符串也能取到封面（只判 Array.isArray 会静默变 null，本行即红）', String(S.cover));
ok(/sz\/540/.test(S.cover), '封面优先取 540 宽度（比 360 清晰，又不是原图那么重）');
eq(S.section, 'body', '专区归属写进条目（前端据此分区）');
eq(S.sectionName, '本体', '专区名写进条目');
eq(S.resourceType, 1, '专区编号写进条目');
eq(S.ut, 1789894044000, 'ut 秒 → 毫秒（前端 new Date 直接用）');
ok(/^https:\/\/jidiyouxi\.com\/post\/detail\/2735899517$/.test(S.url), '帖子 URL 拼对');
ok(typeof S.note === 'string' && S.note.length > 0, 'note 带正文摘要（截断到 300 字以内）');
ok(S.note.length <= jp.NOTE_MAX, '★ note 长度不超过 NOTE_MAX（截断上限要真的生效）', String(S.note.length));

/* 兼容分支：标签出现在顶层（旧结构）也要认 */
const S2 = jp.shapePost({ id: 1, title: 'A', resource_tag: [{ tag: '顶层标签' }], content: '' }, SEC);
eq(S2.tags[0], '顶层标签', '★ 顶层 resource_tag 也认（两处都读，上游换位置不会又变空）');

/* 兜底分支：字段缺失不许抛异常 */
const S3 = jp.shapePost({ id: 2 }, SEC);
eq(S3.title, null, '无标题 → null（不是空串，前端才好判「无标题」）');
eq(S3.tags.length, 0, '无标签 → 空数组');
eq(S3.cover, null, '无 imgs → null');
eq(S3.game, null, '无 topic → null');
eq(S3.links.length, 0, '无正文 → 0 条链接');
eq(jp.shapePost(null, SEC), null, '★ null 入参返回 null 而不是抛异常（一条脏数据不该让整批取不回来）');
eq(jp.shapePost({ title: '无 id' }, SEC), null, '无 id 的条目返回 null（由调用方过滤）');

/* imgs 已经是数组时同样要能取 —— 上游两种形态都出现过 */
const S4 = jp.shapePost({
  id: 3, title: 'B', content: '',
  imgs: [{ urls: { origin: { urls: ['http://img2.52jidi.com/img/view/id/1/sz/src'] } } }],
}, SEC);
ok(!!S4.cover && /sz\/src/.test(S4.cover), '★ imgs 已经是数组时也走通（只有 540/360 都没有才退到 origin）');

/* ============================================================
 *  ③ 排序：有标题优先
 * ============================================================ */
console.log('\n=== ③ 专区排序（无标题帖必须压到最后）===');
/* ★ sort=new 会把 resource_type=0 的评论帖排上来（实测首条标题是空字符串）——
   直接铺到界面上就是「一行没有名字的资源」。这里不删它们，只压后。 */
const sorted = jp.sortPosts([
  { id: 'x', title: null, dpv: 9999, ct: 9999, reviews: 9999 },
  { id: 'a', title: '有名字', dpv: 1, ct: 1, reviews: 1 },
  { id: 'b', title: '也有名字', dpv: 5, ct: 5, reviews: 5 },
], 'hot');
eq(sorted[2].id, 'x', '★ 无标题帖沉底 —— 即使它热度 9999（比第二名高 2000 倍），本行即红');
eq(sorted[0].id, 'b', '两条都有标题时，按 dpv 降序（b=5 在 a=1 前面）');
eq(sorted[1].id, 'a', '热度低的后置');

const byNew = jp.sortPosts([
  { id: 'old', title: 'A', ct: 100 },
  { id: 'new', title: 'B', ct: 900 },
], 'new');
eq(byNew[0].id, 'new', 'sort=new 时按发布时间降序（不是仍按热度）');
const byReply = jp.sortPosts([
  { id: 'r1', title: 'A', reviews: 1 },
  { id: 'r2', title: 'B', reviews: 9 },
], 'reply');
eq(byReply[0].id, 'r2', 'sort=reply 时按回复数降序');

/* ============================================================
 *  ④ 签名底座：envPath 必须是独立入口
 * ============================================================ */
console.log('\n=== ④ jidiSigned 的 envPath ===');
const signed = read('fetchers/jidiSigned.js');
ok(/async function signedPost\(\{ api, referer, envPath/.test(signed),
  '★ signedPost 拆出 envPath 参数（详情页 env 无 host，用详情页取 env 会抛「未内嵌 env」）');
ok(/getEnv\(envPath \|\| referer/.test(signed),
  '★ 取 env 用 envPath，缺省退回 referer（老调用点行为不变）');
const jposts = read('fetchers/jidiPosts.js');
ok(/envPath:\s*'\/topic\/list'/.test(jposts),
  '★ 三专区接口的 env 固定取列表页（Referer 仍是详情页——两者本可以不同）');

/* ============================================================
 *  ⑤ download.jidi 的接线与降级
 * ============================================================ */
console.log('\n=== ⑤ /api/download 的机地分支 ===');
const dlsrc = read('fetchers/download.js');
ok(/const jp = require\('\.\/jidiPosts'\)/.test(dlsrc), 'download.js 引入 jidiPosts');
ok(/await jp\.topicPosts\(\{ tid, sort, perSection \}\)/.test(dlsrc),
  '★ jidi() 优先走三专区接口（不是仍读 SSR 首屏 10 条）');
ok(/engine: 'api'/.test(dlsrc) && /engine: 'ssr'/.test(dlsrc),
  '★ 两条路各自标 engine（静默降级会让人以为一直在用接口）');
ok(/fallbackReason/.test(dlsrc), '退到 SSR 时带上原因（不静默吞）');
ok(/jt\.postsOf\(tid\)/.test(dlsrc), '★ 保留 SSR 兜底（接口依赖签名 env，坏法与 SSR 不同）');
ok(/function flatFrom\(/.test(dlsrc), '两种形态统一成同一份扁平条目（前端只认一套字段）');
ok(/section: g\.key/.test(dlsrc) && /sectionName: g\.name/.test(dlsrc),
  '扁平条目带上专区（前端分区的唯一依据）');

/* sections 汇总字段：count 与 returned 必须分开 */
ok(/returned: g\.returned/.test(dlsrc) && /count: g\.count/.test(dlsrc),
  '★ sections 同时给「源站总数 count」与「本次取回 returned」（只给一个会让界面数字对不上）');

const srv = read('server.js');
ok(/sections: data\.sections \|\| null/.test(srv), '★ server.js 透传 sections');
ok(/engine: data\.engine \|\| null/.test(srv), '★ server.js 透传 engine');

/* ============================================================
 *  ⑥ 前端：按专区分块
 * ============================================================ */
console.log('\n=== ⑥ 前端下载弹窗的专区展示 ===');
const idx = read('public/index.html');
ok(/function dlBlock\(o\)/.test(idx), '★ 有 dlBlock() 画一个可折叠专区（本体 / mod / 修改器共用同一骨架）');
ok(/const secs = jiSecs\.length \? jiSecs/.test(idx),
  '★ 专区清单以服务端 sections 为权威口径（拿不到才把条目当成「本体」一块）');
ok(/ji\.d\.sections\.filter\(\(s\) => s && s\.key\)/.test(idx), 'openDownload 从 sections 分区');
ok(/\.dl-secs\{[^}]*display:flex/.test(idx), '★ .dl-secs 有样式（只加 JS 不加 CSS 会挤成一行）');
ok(/\.dl-sec>\.sh\{/.test(idx), '.dl-sec 的小标题行有样式');
ok(/\.dl-sec>\.sh>\.c\{/.test(idx), '专区条数徽标 .c 有样式');
ok(/\.dl-sec>\.sh>\.go\{/.test(idx), '去源站专区的出口 .go 有样式');
ok(/' 帖'/.test(idx) && /个地址/.test(idx),
  '★ 徽标写「N 帖」，元信息另写「M 个地址」—— 帖 ≠ 网盘地址，混用会让数字自相矛盾');
/* ★ v10.27 起前端**确实**自己排一份序（用户要即时切「最热 / 最近发布」，等一次网络往返会卡）。
   v10.26 那条「前端不许实现排序」的禁令随之作废，但不能就这么放开 ——
   改成「必须有一份跨实现对照护着」，否则两份实现迟早漂移。 */
ok(/function dlSorted\(/.test(idx), '★ 前端有 dlSorted（即时切换排序用）');
ok(/function sortPosts/.test(read('fetchers/jidiPosts.js')),
  '后端 sortPosts 仍在（前端那份是它的镜像，不是替代）');
ok(fs.existsSync(path.join(ROOT, 'tools/test-v1027-dlpop.js'))
  && /前端 dlSorted 与后端 sortPosts 顺序一致/.test(read('tools/test-v1027-dlpop.js')),
  '★★ 前端那份排序**必须**有跨实现对照护着（同一个输入喂两份实现，顺序不一致即红）');

/* 三页共享：派生页必须重建 */
for (const page of ['public/emulator.html', 'public/unpack.html']) {
  let t = '';
  try { t = read(page); } catch (e) { t = ''; }
  ok(/function dlBlock\(o\)/.test(t) && /\.dl-secs\{/.test(t),
    '★ ' + page + ' 已重建并带上分块逻辑（改了主源不重建派生页，那边就没有且不报错）');
}

/* ============================================================
 *  ⑦ 在线冒烟（默认跳过；JIDI_LIVE=1 才真请求源站）
 * ============================================================ */
(async () => {
  if (process.env.JIDI_LIVE !== '1') {
    console.log('\n=== ⑦ 在线冒烟：已跳过（JIDI_LIVE=1 才跑）===');
  } else {
    console.log('\n=== ⑦ 在线冒烟：真请求机地接口（剑星 tid=171085167）===');
    try {
      const r = await jp.topicPosts({ tid: 171085167, sort: 'hot', perSection: 20 });
      ok(r.sections.length === 3, '返回三个专区');
      const body = r.sections.find((s) => s.key === 'body');
      const mod = r.sections.find((s) => s.key === 'mod');
      ok(body && body.count > 0, '本体专区有资源', String(body && body.count));
      ok(mod && mod.count > 0, '★ mod 专区有资源（老 SSR 链路这里是 0）', String(mod && mod.count));
      /* ★ v10.27 起 perSection 只约束**基础排序**那一路，没取满的专区会再并入一页 sort=new。
         所以上限是 perSection + PAGE_LIMIT，不是 perSection。 */
      ok(mod.returned <= 20 + jp.PAGE_LIMIT,
        '★ perSection 的截断仍生效（补抓那页最多再加一页 100 条）', String(mod.returned));
      ok(body.merged === false, '★ 本体取满 22 帖 → 不补抓 sort=new（省一次请求；实测这两类 hot/new 结果完全相同）',
        'returned=' + body.returned + ' count=' + body.count);
      ok(mod.merged === true && mod.mergedAdded > 0,
        '★ mod（190 帖，取不满）确实补抓并合并了 sort=new —— 「最近发布」那个开关才不是假开关',
        JSON.stringify({ returned: mod.returned, added: mod.mergedAdded }));
      ok(!r.sections.some((s) => s.error), '三个专区都没有 error');
    } catch (e) {
      ok(false, '在线冒烟失败', e.message);
    }
  }

  console.log('\n============================');
  console.log('  通过 ' + pass + '/' + (pass + fail) + '（失败 ' + fail + '）');
  console.log('============================');
  process.exit(fail ? 1 : 0);
})();
