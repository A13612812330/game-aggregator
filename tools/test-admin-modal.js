/* 后台「查看」弹窗的**渲染层**回归 —— /admin.html 的 rmv* 一族（v10.97）
 *
 * 用户口径：「管理页面点击后的弹窗我想要也这样的」（附一张帖子详情页截图：
 *   文档图标 + 标题 + 副标题 / 大封面 / 板块·作者·时间·浏览量 chip 行 / 原链 / 分节正文）。
 *
 * 为什么要单独一份：这段逻辑（正文分节 + 行内链接 + 数组字段）**全是纯函数**，
 *   jsdom 里可以直接调，不需要跑后台接口、不需要登录态。放到浏览器探针里验反而更脆。
 *
 * ★★ 本轮踩到并在这里钉住的三件事（每一条都是「不报错的错」）：
 *   ① **正文渲染顺序**：必须「先切 URL 再分别 esc」。反过来（先 esc 全文再正则替换）
 *      `&` 会变成 `&amp;` 再拼进 href，浏览器二次解码 —— URL 里出现 `&#39;` 这类序列就解错。
 *   ② **`String(对象)` 静默成 `[object Object]`**：存档 `paths` 的元素是
 *      `{raw, shown, notes, tags}`，老代码 `String(s)` 让弹窗里 44 行全是 `[object Object]`，
 *      **页面不报错、断言不写就永远发现不了**。
 *   ③ **小节标题判定必须保守**：正文里「分享文件：xxx」「链接：xxx」这类短行很多，
 *      把「短行即标题」当规则会把正文切碎 —— 比不识别更糟。
 *
 * 运行：node tools/test-admin-modal.js
 * 前置：服务已在 8123 端口运行（node server.js）—— 只用它取一份 admin.html 源码。
 */
const { JSDOM, VirtualConsole } = require('jsdom');

const BASE = process.env.BASE || 'http://127.0.0.1:8123';
const PAGE = '/admin.html';
const results = [];
const ok = (n, c, extra) => { results.push([c, n, extra || '']); return c; };

async function main() {
  const html = await fetch(BASE + PAGE).then((r) => r.text());

  /* 后台页初始化会自己去打 /api/admin/*（未登录必失败）—— 那些错误与本节无关，
     但要**收集并确认不影响 rmv\* 函数**：只放行「接口 401/网络」这类，其他照报。 */
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const m = String(e.message || e);
    if (!/Could not load|Not implemented: navigation/.test(m)) errs.push(m);
  });

  const dom = new JSDOM(html, {
    url: BASE + PAGE,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      const raw = w.fetch;
      w.fetch = function (u, o) {
        const real = raw || globalThis.fetch;
        return real.call(w, String(u).startsWith('http') ? String(u) : BASE + u, o);
      };
      w.scrollTo = () => {};
    },
  });
  const W = dom.window;
  await new Promise((r) => setTimeout(r, 1200));
  const $ = (s) => W.document.querySelector(s);

  /* ============================================================
   * 一、弹窗骨架与样式（改形的前置条件：壳都不对，内容无从谈起）
   * ============================================================ */
  ok('后台弹窗壳 #rmView / #rmvTitle / #rmvSub / #rmvBody 都在',
    !!$('#rmView') && !!$('#rmvTitle') && !!$('#rmvSub') && !!$('#rmvBody'));
  ok('★ 弹窗头有文档图标 .rmv-ico（参照页的视觉锚点，不是纯文字标题）',
    !!$('#rmView .rmv-ico svg'));
  ok('★ 正文区是独立滚动容器 .rmv-scroll（长帖不会把整个弹窗撑出屏幕）',
    !!$('#rmvBody') && $('#rmvBody').classList.contains('rmv-scroll'));
  ok('弹窗初始是关闭态（不带 .on）', !$('#rmView').classList.contains('on'));

  /* 样式：读**服务端实发的那份**源码里的规则体。
     ⚠️ 不能查「整页含某字符串」—— 注释里写个反例就假绿。 */
  {
    const need = [
      ['\\.rmv-hero\\{', '大封面容器'],
      ['\\.rmv-chips\\{', 'chip 行'],
      ['\\.rmv-doc h5\\{', '正文小节标题'],
      ['\\.rmv-doc \\.li\\{', '编号步骤'],
      ['\\.rmv-shots\\{', '截图墙'],
      ['\\.rmv-url\\{', '原链一行'],
    ];
    const miss = need.filter(([re]) => !new RegExp(re).test(html));
    ok('★ v10.97 弹窗六块样式都在（封面 / chip / 小节 / 步骤 / 截图 / 原链）',
      miss.length === 0, miss.map((x) => x[1]).join('、') || '全部命中');
  }

  /* ============================================================
   * 二、行内渲染 rmvInline —— 顺序坑与标点坑
   * ============================================================ */
  {
    const a = W.rmvInline('看这个 https://pan.xunlei.com/s/abc 提取码 1234');
    ok('★ rmvInline：裸链接变可点 <a>，且不吞掉后面的中文',
      /<a href="https:\/\/pan\.xunlei\.com\/s\/abc"[^>]*>/.test(a) && /提取码 1234/.test(a), a.slice(0, 90));

    /* ★ 顺序坑：URL 里的 `&` 只能转义一次。若「先 esc 全文再拼 href」，
       这里会出现 `&amp;amp;`（二次转义）——正文看起来正常，链接点开是错的。 */
    const b = W.rmvInline('a&b https://x.com/y?q=1&z=2 end');
    ok('★★ rmvInline：URL 里的 `&` 只转义一次（href 精确等于 &amp;，不是 &amp;amp;）',
      /href="https:\/\/x\.com\/y\?q=1&amp;z=2"/.test(b) && !/&amp;amp;/.test(b), b.slice(0, 100));
    ok('★★ 反向：正文里的 `&` 也照常转义（`a&b` → `a&amp;b`，不产生裸 &）',
      /^a&amp;b /.test(b), b.slice(0, 24));

    /* ★ 标点坑：正文里大量「链接：https://…。」 */
    const c = W.rmvInline('链接：https://x.com/y。');
    ok('★★ rmvInline：句末中文标点从 URL 尾部剥掉（不把「。」拼进 href）',
      /href="https:\/\/x\.com\/y"/.test(c) && /<\/a>。/.test(c), c);

    const d = W.rmvInline('看 https://x.com/y）。');
    ok('★ rmvInline：右括号 / 句号混在尾巴上时也只剥标点、不截正文',
      /href="https:\/\/x\.com\/y"/.test(d), d);

    const e = W.rmvInline('<img src=x onerror=alert(1)>');
    ok('★★ rmvInline：正文里的 HTML 被转义（不能把作者写的标签当标签渲染）',
      !/<img/.test(e) && /&lt;img/.test(e), e.slice(0, 60));

    const f = W.rmvInline('magnet:?xt=urn:btih:abc123 和 ed2k://|file|x|1|y|/');
    ok('★ rmvInline：magnet / ed2k 也识别成链接（网盘之外的取件方式）',
      /<a href="magnet:/.test(f) && /<a href="ed2k:/.test(f), f.slice(0, 90));
  }

  /* ============================================================
   * 三、小节标题判定 rmvIsHead —— 保守白名单
   * ============================================================ */
  {
    ok('★ rmvIsHead：`【xxx】` 整行包裹 ⇒ 是标题', W.rmvIsHead('【安装说明】') === true);
    ok('★ rmvIsHead：以常见小节词结尾的短行 ⇒ 是标题',
      ['注意事项', '内容详情', '下载链接', '使用说明'].every((t) => W.rmvIsHead(t) === true));
    /* ⚠️ 这三条是本轮「保守」二字的落点：正文里大量这种短行，识别成标题会把正文切碎 */
    ok('★★ 反向：`分享文件：xxx` / `链接：https://…` / 长句 都不算标题',
      W.rmvIsHead('分享文件：abc.zip') === false
      && W.rmvIsHead('链接：https://x.com/y') === false
      && W.rmvIsHead('这款修改器支持最新版本并且兼容所有DLC内容') === false,
      ['分享文件：abc.zip', '链接：https://x.com/y'].map((t) => t + '=' + W.rmvIsHead(t)).join(' ｜ '));
    ok('★ 反向：带句末标点的行不算标题（「注意：别覆盖原文件。」是句子不是标题）',
      W.rmvIsHead('注意：别覆盖原文件。') === false);
    ok('★ 反向：以 http/ed2k/magnet 开头的行不算标题（否则整条链接会变成 h5）',
      W.rmvIsHead('https://x.com/y') === false);
  }

  /* ============================================================
   * 四、正文渲染 rmvDoc —— 三段式结构 + 转义 + 粗体
   * ============================================================ */
  {
    const src = [
      '【内容详情】',
      '这是整合包的说明，包含若干 Mod。',
      '',
      '安装说明',
      '1. 解压到游戏目录',
      '2. 覆盖同名文件',
      '3. 进游戏按 F5 刷新',
      '',
      '下载链接：https://pan.xunlei.com/s/abc。',
      '**注意：只支持正版**',
    ].join('\n');
    const d = W.rmvDoc(src);
    const h5 = (d.match(/<h5>/g) || []).length;
    const li = (d.match(/class="li"/g) || []).length;
    const p = (d.match(/<p>/g) || []).length;
    ok('★★ rmvDoc：识别两个小节标题（【内容详情】/ 安装说明）', h5 === 2, `${h5} 个 h5`);
    ok('★★ rmvDoc：三条编号步骤渲染成 .li（不是混在段落里）', li === 3, `${li} 个 .li`);
    ok('★ rmvDoc：其余成段（空行分段，不是一堵墙）', p >= 2, `${p} 个 p`);
    ok('★★ rmvDoc：小节标题里的 `【】` 已剥掉（不能把括号原样显示成标题）',
      /<h5>内容详情<\/h5>/.test(d) && !/<h5>【/.test(d));
    ok('★ rmvDoc：正文里的裸链接成可点 <a>（与 rmvInline 同一套规则）',
      /<a href="https:\/\/pan\.xunlei\.com\/s\/abc"/.test(d));
    ok('★ rmvDoc：作者打的 `**粗体**` 换成 <b>，且标记本身不残留',
      /<b>注意：只支持正版<\/b>/.test(d) && !/\*\*/.test(d));
    ok('★★ rmvDoc：正文 HTML 全部转义（<script> 不会变真标签）',
      !/<script/i.test(W.rmvDoc('<script>alert(1)</script>\n普通一行')));
    ok('★ rmvDoc：空输入不炸，返回空串（没正文的源不该画出半个空壳）',
      W.rmvDoc('') === '' && W.rmvDoc(null) === '');
  }

  /* ============================================================
   * 五、rmvOpen 整条渲染 —— 参照页的九段
   * ============================================================ */
  {
    const fixture = {
      title: '赛博朋克2077 人物美化整合包 v3.2',
      gameTitle: '赛博朋克2077',
      gameId: 'xd-2077',
      raw: {
        cover: 'https://img.example.com/cover.jpg',
        author: '超级无敌暴龙战士',
        ut: 1757900000,
        pv: 7949,
        content: '【内容详情】\n整合包包含发型 / 面容 / 服装三类 Mod。\n\n注意事项\n1. 先装 ArchiveXL\n2. 再覆盖 Mods 目录',
        links: [{ url: 'https://pan.quark.cn/s/aaa', kind: '夸克' }, { url: 'https://pan.baidu.com/s/bbb', kind: '百度' }],
        size: '1.2GB',
        favors: 0,
        paths: [{ raw: '<base>/saves', shown: '<游戏安装目录>/saves', notes: [], tags: [] }],
        regs: ['HKEY_CURRENT_USER\\Software\\CDPR'],
      },
      links: [],
    };
    W.__rmItems = [fixture];
    let threw = '';
    try { W.rmvOpen(0); } catch (e) { threw = String(e && e.message); }
    ok('rmvOpen(0) 不抛异常', !threw, threw);

    const body = $('#rmvBody');
    const B = body ? body.innerHTML : '';
    ok('★ 弹窗打开（#rmView 带 .on）', $('#rmView').classList.contains('on'));
    ok('★ 标题回填到 #rmvTitle', ($('#rmvTitle').textContent || '').includes('人物美化'), $('#rmvTitle').textContent);
    ok('★ 副标题写明游戏名 + 主键（一眼能对回库）',
      /赛博朋克2077/.test($('#rmvSub').textContent || '') && /xd-2077/.test($('#rmvSub').textContent || ''),
      $('#rmvSub').textContent);
    ok('★ 大封面渲染成 .rmv-hero（有封面时不能只给个标题）', !!$('#rmvBody .rmv-hero img'));
    ok('★ chip 行按参照页顺序：板块 · 原作者 · 时间 · 浏览量',
      !!$('#rmvBody .rmv-chips') && /原作者/.test($('#rmvBody .rmv-chips').textContent)
      && /👁/.test($('#rmvBody .rmv-chips').textContent)
      && /\d{4}-\d{2}-\d{2}/.test($('#rmvBody .rmv-chips').textContent),
      ($('#rmvBody .rmv-chips') || {}).textContent || '(无)');
    ok('★ 原链一行 .rmv-url 是真外链（优先第一条下载链）',
      !!$('#rmvBody .rmv-url') && /^https:\/\/pan\.quark\.cn/.test($('#rmvBody .rmv-url').getAttribute('href') || ''),
      ($('#rmvBody .rmv-url') || {}).getAttribute ? $('#rmvBody .rmv-url').getAttribute('href') : '(无)');
    ok('★★ 正文按小节渲染（h5 两个：内容详情 / 注意事项）',
      body.querySelectorAll('.rmv-doc h5').length >= 2,
      body.querySelectorAll('.rmv-doc h5').length + ' 个');
    ok('★ 编号步骤渲染成 .li', body.querySelectorAll('.rmv-doc .li').length >= 2,
      body.querySelectorAll('.rmv-doc .li').length + ' 个');
    /* ★★ 本轮实拍抓到的「不报错的错」：`String(对象)` ⇒ [object Object] */
    ok('★★ 数组字段（存档路径）渲染成人话，**没有** [object Object]',
      !/\[object Object\]/.test(B) && /游戏安装目录/.test(B),
      (B.match(/[^<]*游戏安装目录[^<]*/) || ['(没渲染出来)'])[0].slice(0, 50));
    ok('★ 注册表数组也逐行铺开（不受 paths 修法影响 —— 两个字段同源同形）',
      /HKEY_CURRENT_USER/.test(B));
    /* ★ 0 值不占位：「收藏 0」不是信息，是噪声 */
    ok('★ 反向：`收藏 0` 不占位（0 值当空值处理）', !/收藏/.test(B),
      (B.match(/收藏[^<]*/) || ['(未出现)'])[0]);
    ok('★ 链接区列出全部盘口（夸克 + 百度），不是只有一条',
      body.querySelectorAll('.rmv-links .rmv-l').length >= 2,
      body.querySelectorAll('.rmv-links .rmv-l').length + ' 条');
    ok('★ 打开弹窗不抛异常、也无 rmv* 相关报错',
      errs.filter((m) => /rmv|rmvDoc/i.test(m)).length === 0,
      errs.slice(0, 2).join(' | ') || '干净');

    /* 无 cover / 无 content 的结构化来源：不能画出半个空壳 */
    W.__rmItems = [{ title: '纯链接条目', raw: { links: [{ url: 'https://x.com/a', kind: '源站' }] } }];
    W.rmvOpen(0);
    const B2 = $('#rmvBody').innerHTML;
    ok('★ 无封面条目：整块 .rmv-hero 不占位（不画一个空图框）', !/rmv-hero/.test(B2));
    ok('★ 无正文条目：不画空 .rmv-doc 容器（留白比空壳干净）', !/rmv-doc/.test(B2));
    ok('★ 无时间 / 无浏览量：chip 行照样渲染但不多出空 chip',
      !!$('#rmvBody .rmv-chips') && !/👁/.test($('#rmvBody .rmv-chips').textContent || ''),
      ($('#rmvBody .rmv-chips') || {}).textContent || '(无)');

    W.rmvClose();
    ok('★ rmvClose() 收起弹窗（去掉 .on）', !$('#rmView').classList.contains('on'));
  }

  W.close();

  /* ---- 汇总 ---- */
  const fail = results.filter((r) => !r[0]);
  console.log('\n' + '='.repeat(68));
  for (const [c, n, e] of results) console.log(`${c ? '  PASS' : '× FAIL'}  ${n}${e ? '   [' + e + ']' : ''}`);
  console.log('='.repeat(68));
  console.log(`结果：${results.length - fail.length} / ${results.length} 通过`);
  process.exit(fail.length ? 1 : 0);
}

main().catch((e) => { console.error('测试脚本异常：', e); process.exit(1); });
