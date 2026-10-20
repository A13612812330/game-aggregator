#!/usr/bin/env node
'use strict';
/* ═══ v10.88 静态防线：FitGirl 下载源解析器 + 真后台骨架 + 备注端点契约 ═══
 * 原则：不联网、不依赖 8124 —— 用**内联 fixture** 测解析器，用文本断言测接线。
 * 退出码格式（run-all 只认两形态）：if (fail) process.exitCode = 1;
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, n, d) => { if (c) { pass++; console.log('  PASS  ' + n + (d ? '  — ' + d : '')); } else { fail++; console.log('  × FAIL  ' + n + (d ? '  — ' + d : '')); } };
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const has = (p) => fs.existsSync(path.join(ROOT, p));

const parts = require(path.join(ROOT, 'data', 'fitgirl-parts.js'));

/* ═══ A. 解析器：三种形态的内联 fixture ═══ */
console.log('\n-- A. 解析器（内联 fixture，不联网）--');

/* A1 inline：两 host × 3 卷 + 1 个可选附件 + 1 个容器 */
const F_INLINE = `
<a href="magnet:?xt=urn:btih:AAAA1111&#038;dn=x">magnet</a>
<a href="https://datanodes.to/aaa/Demo_Game_--_fitgirl-repacks.site_--_.part1.rar">p1</a>
<a href="https://datanodes.to/bbb/Demo_Game_--_fitgirl-repacks.site_--_.part2.rar">p2</a>
<a href="https://datanodes.to/ccc/Demo_Game_--_fitgirl-repacks.site_--_.part3.rar">p3</a>
<a href="https://fuckingfast.co/111#Demo_Game_--_fitgirl-repacks.site_--_.part1.rar">p1</a>
<a href="https://fuckingfast.co/222#Demo_Game_--_fitgirl-repacks.site_--_.part2.rar">p2</a>
<a href="https://fuckingfast.co/333#Demo_Game_--_fitgirl-repacks.site_--_.part3.rar">p3</a>
<a href="https://datanodes.to/ddd/fg-optional-videos.part1.rar">o1</a>
<a href="https://datanodes.to/eee/fg-optional-videos.part2.rar">o2</a>
<a href="https://filecrypt.cc/Container/ABC123.html">container</a>
`;
const r1 = parts.parse(F_INLINE);
ok(r1.mode === 'inline', 'A1 inline 帖 mode=inline', 'mode=' + r1.mode);
ok(r1.sets.length === 2, 'A2 跨 host 同前缀归并成 1 组 + 可选 1 组', 'sets=' + r1.sets.length);
const main1 = r1.sets.find((s) => s.kind === 'main');
ok(!!main1 && main1.parts === 3, 'A3 主组 3 卷（两 host 各 3 条 → 归并后 3 卷）', 'parts=' + (main1 && main1.parts));
ok(!!main1 && main1.hosts.length === 2, 'A4 主组带两个镜像', main1 ? main1.hosts.join('/') : '');
ok(r1.sets.some((s) => s.optional && s.kind === 'optional'), 'A5 fg-optional-* 标为可选附件');
ok(r1.containers.length === 1 && /filecrypt/.test(r1.containers[0].host), 'A6 容器被单独收走');
ok(r1.magnet.count === 1 && /&dn=/.test(r1.magnet.list[0]), 'A7 磁力实体还原（&#038; → &）');
ok(r1.stats.mainParts === 3, 'A8 stats.mainParts 只算主组', 'mainParts=' + r1.stats.mainParts);

/* A2 去重：同一 URL 出现两次只算一份 */
const F_DUP = F_INLINE.replace('https://datanodes.to/ddd/fg-optional-videos.part1.rar">o1',
  'https://datanodes.to/ddd/fg-optional-videos.part1.rar">o1')
  + '<a href="https://datanodes.to/ddd/fg-optional-videos.part1.rar">dup</a>';
const r2 = parts.parse(F_DUP);
const opt2 = r2.sets.find((s) => s.prefix === 'fg-optional-videos');
ok(!!opt2 && opt2.parts === 2, 'A9 同 URL 重复出现不重复计数', 'parts=' + (opt2 && opt2.parts));

/* A3 container 形态：只有容器 + 磁力 */
const F_CONT = `
<a href="magnet:?xt=urn:btih:BBBB2222">m</a>
<a href="https://pastefg.hermietkreeft.site/?abc#xyz">paste</a>
`;
const r3 = parts.parse(F_CONT);
ok(r3.mode === 'container' && r3.sets.length === 0, 'A10 只给 paste 清单 ⇒ mode=container（不是 none）', 'mode=' + r3.mode);
ok(r3.containers.length === 1 && /pastefg/.test(r3.containers[0].host), 'A11 pastefg 域名被识别为容器');

/* A4 none 形态 */
const r4 = parts.parse('<p>nothing here</p>');
ok(r4.mode === 'none' && r4.sets.length === 0 && r4.containers.length === 0, 'A12 无下载区 ⇒ mode=none');

/* A5 白名单：外域链接不被当作下载源（防注入） */
const F_EVIL = '<a href="https://evil.example.com/x/Demo.part1.rar">x</a>';
const r5 = parts.parse(F_EVIL);
ok(r5.sets.length === 0, 'A13 白名单外域名不进 sets（防把外域渲染成下载源）');

/* A6 变体：两个非 optional 前缀 → main + variant */
const F_VAR = `
<a href="https://datanodes.to/v1/Game_UNCENSORED_--_fitgirl-repacks.site_--_.part1.rar">a</a>
<a href="https://datanodes.to/v2/Game_UNCENSORED_--_fitgirl-repacks.site_--_.part2.rar">b</a>
<a href="https://datanodes.to/v3/Game_--_fitgirl-repacks.site_--_.part1.rar">c</a>
`;
const r6 = parts.parse(F_VAR);
ok(r6.sets.filter((s) => s.kind === 'main').length === 1 && r6.sets.some((s) => s.kind === 'variant'),
  'A14 两个完整版本 ⇒ main + variant（不混成一堆）', r6.sets.map((s) => s.kind).join(','));

/* ═══ B. 服务端接线 ═══ */
console.log('\n-- B. 服务端接线 --');
const srv = read('server.js');
ok(/app\.get\('\/api\/fitgirl\/parts'/.test(srv), 'B1 /api/fitgirl/parts 端点在位');
ok(/FG_PARTS_VER/.test(srv) && /j\.v === FG_PARTS_VER/.test(srv),
  'B2 缓存带版本号（解析器升级后旧缓存自动失效）');
ok(/if \(parsed\.mode === 'none'\)/.test(srv), 'B3 只有 mode=none 才 404（container 必须 200）');
ok(/function adminGuard/.test(srv) && /hostLocal/.test(srv), 'B4 管理鉴权三条件仍在（v10.87.1 未回退）');
ok(/app\.post\('\/api\/admin\/note'/.test(srv), 'B5 /api/admin/note 端点在位');
const noteIdx = srv.indexOf("app.post('/api/admin/note'");
const noteBody = srv.slice(noteIdx, noteIdx + 900);
ok(/adminGuard\(req, res\)/.test(noteBody), 'B6 note 写端点走 adminGuard（不裸奔）');
ok(/500/.test(noteBody), 'B7 note 长度上限校验在位');
ok(/note: gameNotes\.get\(g\.id\)/.test(srv), 'B8 详情 state 带 note');
ok(/it\.note = gameNotes\.get\(x\.id\)/.test(srv), 'B9 browse 行回填 note');
ok(/conds\.every\(\(f\) => f\(g\)\)/.test(srv) && /o\.filter = \(g\) => conds\.every/.test(srv),
  'B10 管理筛选用条件数组（多条件不互相覆盖）');
ok(/req\.query\.asrc/.test(srv), 'B11 asrc 来源筛选参数在位（不复用 src 避免语义冲突）');

/* ── v10.88.1 鉴权回补：加了 note 字段的三处必须各自设防 ──
 * 起因：v10.88 发布后线上实测 `GET /api/admin/game?id=xd-1` 无令牌 **200** 且
 * `state.note` 明文返回；`/api/library/browse?admin=1` 同理能读到全库备注。
 * 根因不是 guard 写错了，而是**加字段时没复查该端点的可见性等级**（铁律 161）。*/
const gIdx = srv.indexOf("app.get('/api/admin/game'");
const gBody = srv.slice(gIdx, gIdx + 500);
ok(/if \(!adminGuard\(req, res\)\) return;/.test(gBody),
  'B12 /api/admin/game 走 adminGuard（state.note 不再公网可读）');
ok(/isAdminView && !adminGuard\(req, res\)/.test(srv),
  'B13 browse 的 admin=1 分支自带鉴权（改变数据可见性的参数必须自己验）');
/* 阳性对照：overview 只回聚合计数、不含任何备注正文 ⇒ 保持公开，
 * 否则线上管理页未填令牌时首屏 12 张卡会全空（把安全修成不可用也是 bug）。*/
const oIdx = srv.indexOf("app.get('/api/admin/overview'");
/* 切片必须止于下一个端点 —— 用固定长度窗口会把 `/api/admin/log` 的 adminGuard
 * 切进来，判据就恒假（自己踩过一次：B14 假红）。 */
const oEnd = srv.indexOf("app.get('/api/admin/log'", oIdx);
const oBody = srv.slice(oIdx, oEnd > oIdx ? oEnd : oIdx + 600);
ok(oIdx > 0 && !/adminGuard/.test(oBody),
  'B14 overview 保持公开读（仅计数，不含备注正文）');

/* ═══ C. 备注模块 ═══ */
console.log('\n-- C. 备注模块 --');
ok(has('data/game-notes.js'), 'C1 data/game-notes.js 存在');
const notes = require(path.join(ROOT, 'data', 'game-notes.js'));
const tmpId = '__probe_note__';
notes.set(tmpId, 'abc');
ok(notes.get(tmpId) === 'abc', 'C2 set/get 往返一致');
notes.set(tmpId, 'x'.repeat(900));
ok(notes.get(tmpId).length === 500, 'C3 超长截断到 500（防写爆文件）', 'len=' + notes.get(tmpId).length);
notes.set(tmpId, '');
ok(notes.get(tmpId) === '', 'C4 空串 = 删除');
const notesRaw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'game-notes.json'), 'utf8'));
ok(!(tmpId in notesRaw), 'C5 删除后文件里不留键（不留垃圾）');

/* ═══ D. 后台页面骨架 ═══ */
console.log('\n-- D. 真后台骨架 --');
const adm = read('public/admin.html');
ok(/class="side"/.test(adm) && /class="main"/.test(adm), 'D1 侧栏 + 主区双栏骨架');
ok((adm.match(/data-v="/g) || []).length >= 5, 'D2 至少 5 个导航视图',
  'n=' + (adm.match(/data-v="/g) || []).length);
ok(/id="view-dash"/.test(adm) && /id="view-games"/.test(adm) && /id="view-res"/.test(adm)
  && /id="view-log"/.test(adm) && /id="view-set"/.test(adm), 'D3 五个 view 容器齐全');
ok(/id="mask"/.test(adm) && /id="mNote"/.test(adm) && /id="mSeg"/.test(adm) && /id="mRes"/.test(adm),
  'D4 编辑弹窗：遮罩 + 备注 + 状态分段 + 资源区');
ok(/function saveAll/.test(adm) && /api\/admin\/note/.test(adm) && /api\/admin\/hide-overrides/.test(adm),
  'D5 保存同时走备注与豁免两个端点');
/* ★ v10.90 契约变更：游戏库列表不再挂资源角标（列改成 封面/游戏名/ID/平台/资料/状态/备注/操作），
 *   资源计数改到四个模块页按类查看。这里改为守「资料完整度」这个新列 —— 别让 D6 变成僵尸断言。 */
ok(/comp \+ '\/7/.test(adm), 'D6 游戏库列表用「资料 7 项完整度」替代旧资源角标');
ok(/function esc\(/.test(adm), 'D7 输出有转义函数（防标题注入）');
/* 反回归：所有插入标题/备注的地方必须过 esc —— 粗筛「直接拼 g.title」 */
ok(!/\+\s*g\.title\s*\+/.test(adm) && !/\+\s*x\.note\s*\+/.test(adm),
  'D8 标题/备注不裸拼进 innerHTML（必须 esc）');
ok(/needAuth/.test(adm) && /token=/.test(adm), 'D9 令牌降级通道仍在（403 → query 重试）');

console.log('\n=== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 ===');
if (fail) process.exitCode = 1;
