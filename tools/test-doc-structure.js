/* test-doc-structure.js —— 文档结构闸（静态防线，登记在 run-all.js 的 SUITES）
 *
 * ★ 为什么需要它（v10.39 实测事故）：
 *   v10.36 提交把**整份 `WORKFLOW.md`** 插进了「已完成」表那条 v10.36 长行的**中间** ——
 *   752 行里 336 行是整份副本、表行被劈成两半、**连文档标题都被挤进了表行末尾**。
 *   这个状态**在仓库里活了 3 个版本**（v10.36 / v10.37 / v10.38）没人发现，因为：
 *     · Markdown 渲染正常（重复段落只是重复显示，不报错）
 *     · 所有断言套件都不看 `.md`
 *     · `git diff` 看起来只是"改了一行"
 *   ⇒ 静态断言套件只能守住**它已知的**东西；文档从没被守过，所以它怎么坏都没人知道。
 *
 * 本闸守三件事（都是「坏了不报错」的形态）：
 *   ① **一级标题唯一** —— 整份被复制 ⇒ 标题出现 2 次
 *   ② **任意偏移下不存在大段重复**（偏移比对）—— 这是抓「整份被插入」的通法，
 *      不依赖标题：副本可能被插在**任何一行中间**，连标题都被吞掉
 *   ③ **章节标题唯一** —— 局部重复（某个小节被复制两遍）
 *
 * ⚠️ 判据是「重复的**行内容**占比」，不是「文件变大了」——
 *    文档本来就允许出现重复的表格分隔行（`|---|---|`），所以只统计**非平凡行**（trim 后长度 ≥ 12）。
 *
 * 用法：node tools/test-doc-structure.js
 * 退出码：0 = 全通过与；1 = 有失败
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* ---------- 断言助手（只数条数、打印，run-all 取末行「通过 n/m」） ---------- */
let pass = 0, fail = 0;
const okList = [], badList = [];
function ok(cond, name) {
  if (cond) { pass++; okList.push('  PASS  ' + name); }
  else { fail++; badList.push('  FAIL  ' + name); }
}

/* ---------- 门槛（实测标定，见文件末「标定依据」） ---------- */
const MIN_LINE = 12;       // 非平凡行的最小长度
const MAX_COPY_RATIO = 0.6; // 偏移比对：重复占比 ≥ 此值即判「整段副本」
const MIN_OVERLAP = 60;    // 偏移后至少要重叠这么多行才参与判定（避免尾部短重叠误报）

/* 待守的文档：根目录全部 .md —— ★ 用「枚举实际文件」而不是手写清单，
 * 因为新增文档时必须自动被覆盖（这正是本闸要防的「新增了没人守」）。 */
const docs = fs.readdirSync(ROOT).filter((f) => /\.md$/i.test(f)).sort();

console.log('=== 文档结构闸（v10.39 新增）===');
console.log('扫描根目录 .md：' + docs.length + ' 个');
console.log('门槛：非平凡行 ≥ ' + MIN_LINE + ' 字 · 偏移重复占比 ≥ ' + (MAX_COPY_RATIO * 100) + '% 判为副本 · 最小重叠 ' + MIN_OVERLAP + ' 行');
console.log('');

/* ---------- 标题抽取：★ 必须跳过围栏代码块 ----------
 * 实测假红（2026-09-24，首次运行时 9 条 FAIL 全是这一类）：
 *   代码块里的 `# 或手动：kill 掉 8123 → node server.js`（bash 注释）、
 *   ``` 块里的提交信息 `# 返回体新增 bothOnly 字段` —— 都被当成了 Markdown 一级标题。
 *   WORKFLOW.md 因此被算成「24 个一级标题」、README.md 被算成 2 个。
 * ⇒ 只统计**围栏之外**的 `#` 行。 */
function headingsOf(lines) {
  const out = [];
  let fence = null; // null=不在块内；否则记下起始标记（``` 或 ~~~）
  lines.forEach((raw, i) => {
    const t = raw.trim();
    const f = /^(`{3,}|~{3,})/.exec(t);
    if (f) {
      const mark = f[1][0];
      if (fence === null) fence = mark;
      else if (fence === mark) fence = null;
      return;
    }
    if (fence !== null) return;
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(t);
    if (m) out.push({ lv: m[1].length, t: m[2], ln: i + 1 });
  });
  return out;
}

/* ---------- 标题路径：`## A` 下的 `### X` 与 `## B` 下的 `### X` 不算重复 ----------
 * 实测假红：CODEX-DONE-v10.5.md 有 `### 修法` ×3、v10.32.md 有 `### 改法` ×2、
 * README.md 有 `### 验证/修法/防线` 各 ×2 —— 它们各自的父节不同，**是合法结构**。
 * 真正该报的是「同一父节下出现两个同名子节」（那才是复制粘贴事故的形态）。 */
function headingPaths(heads) {
  const paths = [];
  const stack = []; // 索引 = 层级-1
  for (const h of heads) {
    stack.length = h.lv - 1;
    for (let i = 0; i < h.lv - 1; i++) if (stack[i] == null) stack[i] = '(未命名)';
    stack[h.lv - 1] = h.t;
    paths.push({ p: stack.slice(0, h.lv).join(' > '), ln: h.ln, lv: h.lv, t: h.t });
  }
  return paths;
}


const findings = [];

/* 显式例外：允许出现 >1 个一级标题的文件 + 理由。
 * ★ 与 check-card-rules.js 的例外表同思路，并**自检陈旧**：
 *   登记了但实际已不超标的，也报错 —— 避免例外表退化成「静默跳过」。 */
const H1_EXCEPTIONS = [
  { file: 'HANDOFF.md', reason: '已归档（停 v10.10）：按项目约定在原文之上**加了一个归档头** ⇒ 2 个 H1' },
  { file: 'CODEX-HANDOFF.md', reason: '已归档（停 v10.1）：同上，归档头 + 原标题 = 2 个 H1' },
];
const staleExceptions = [];

for (const f of docs) {
  const raw = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const lines = raw.split(/\r?\n/);
  const n = lines.length;
  const label = f + '（' + n + ' 行）';

  const heads = headingsOf(lines);
  const h1Max = H1_EXCEPTIONS.some((e) => e.file === f) ? 2 : 1;

  /* ① 一级标题恰好 1 个（归档文档放宽到 2；0 个也算不合格：文档没有标题） */
  const h1 = heads.filter((h) => h.lv === 1);
  ok(h1.length === 1 || (h1.length === h1Max && h1Max === 2),
    '[' + f + '] 一级标题 ' + (h1Max === 2 ? '≤2（归档例外）' : '恰好 1') + ' 个（实测 ' + h1.length +
    (h1.length !== 1 && h1Max === 1 ? '：' + h1.map((h) => 'L' + h.ln + ' ' + h.t.slice(0, 40)).join(' / ') : '') + '）');

  /* ② 偏移比对：抓「整段副本被插进任意位置」——
   * 这是本闸的主力判据：它**不依赖标题**，所以连「标题被吞进行尾」那种事故也能抓到。 */
  const nt = (i) => lines[i].trim().length >= MIN_LINE;
  let worst = { s: 0, ratio: 0, overlap: 0, tot: 0, hit: 0 };
  for (let s = 1; s < n; s++) {
    const overlap = n - s;
    if (overlap < MIN_OVERLAP) break;
    let tot = 0, hit = 0;
    for (let i = 0; i < overlap; i++) {
      if (nt(i) || nt(s + i)) { tot++; if (lines[i].trim() === lines[s + i].trim()) hit++; }
    }
    if (tot < MIN_OVERLAP) continue;
    const ratio = hit / tot;
    if (ratio > worst.ratio) worst = { s, ratio, overlap, tot, hit };
  }
  const isDup = worst.ratio >= MAX_COPY_RATIO;
  ok(!isDup, '[' + f + '] 无「整段副本」（最高偏移重复 ' + (worst.ratio * 100).toFixed(1) +
    '% @ 偏移 ' + worst.s + ' 行' + (isDup ? ' ⇒ ★ 疑似整份/大段被复制到此偏移处' : '') + '）');
  if (isDup) {
    findings.push('  · ' + label + '：偏移 ' + worst.s + ' 行处重复占比 ' + (worst.ratio * 100).toFixed(1) +
      '%（' + worst.hit + '/' + worst.tot + ' 个非平凡行）⇒ 疑似整份文档被插入此处');
  }

  /* ③ 标题路径唯一（不是「标题文本唯一」—— 同名子节挂在不同父节下是合法的） */
  const paths = headingPaths(heads);
  const byPath = {};
  for (const p of paths) (byPath[p.p] = byPath[p.p] || []).push(p.ln);
  const dupPaths = Object.entries(byPath).filter(([, arr]) => arr.length > 1);
  ok(dupPaths.length === 0, '[' + f + '] 标题路径无重复（共 ' + heads.length + ' 个标题 / ' + paths.length + ' 条路径' +
    (dupPaths.length ? '，重复：' + dupPaths.map(([k, arr]) => k + ' ×' + arr.length + '（L' + arr.join('/L') + '）').join('；') : '') + '）');
  for (const [k, arr] of dupPaths) findings.push('  · ' + label + '：同一父节下重复 ' + arr.length + ' 次 —— ' + k + '（L' + arr.join(' / L') + '）');
}

/* 例外表自检：登记了但实际已不超标 ⇒ 报错（防止例外表退化成静默跳过） */
for (const e of H1_EXCEPTIONS) {
  const p = path.join(ROOT, e.file);
  if (!fs.existsSync(p)) { staleExceptions.push('  · ' + e.file + ' 不存在 ⇒ 请从 H1_EXCEPTIONS 删掉'); continue; }
  const h1n = headingsOf(fs.readFileSync(p, 'utf8').split(/\r?\n/)).filter((h) => h.lv === 1).length;
  if (h1n <= 1) staleExceptions.push('  · ' + e.file + ' 现在只有 ' + h1n + ' 个一级标题 ⇒ 例外已无必要，请从 H1_EXCEPTIONS 删掉');
}
ok(staleExceptions.length === 0, '例外表无陈旧项（登记 ' + H1_EXCEPTIONS.length + ' 条）');

/* ---------- 汇总 ---------- */
console.log('--- 逐项 ---');
for (const l of okList) console.log(l);
for (const l of badList) console.log(l);
if (findings.length) {
  console.log('');
  console.log('--- 结构问题明细 ---');
  for (const l of findings) console.log(l);
}
if (staleExceptions.length) {
  console.log('');
  console.log('--- 陈旧例外 ---');
  for (const l of staleExceptions) console.log(l);
}
console.log('');
console.log('====');
console.log('通过 ' + pass + '/' + (pass + fail) + '（失败 ' + fail + '）');
process.exit(fail ? 1 : 0);

/* ---------- 标定依据（2026-09-24 实测） ----------
 * · 健康态：47 个根目录 .md 全部通过；最高偏移重复 1.8%（CODEX-TASKS.md @ 偏移 334 行）——
 *   来源是文档里本来就允许的重复表格分隔行、重复的命令行注释。
 *   ⇒ 只统计**非平凡行**（trim 后 ≥ 12 字）+ 门槛 60%，与健康态拉开 30 倍以上余量。
 * · 事故态：WORKFLOW.md 752 行版本，偏移 336 行处重复占比 ≈ 99%（同一份文档被整份插入）。
 * · 门槛取 60% 而非 100%：副本可能被**编辑过**（事故里那条表行就被劈成两半、
 *   标题被挤进行尾），所以不能要求逐字全同 ⇒ 留余量。
 * · 首版判据的两处假红（已修，留作教训）：
 *   ① 「一级标题恰好 1 个」把**围栏代码块里的 `#` 注释**当标题 ⇒ WORKFLOW.md 被算成 24 个、
 *      README.md 被算成 2 个 ⇒ 必须先跳过 ``` / ~~~ 块。
 *   ② 「标题文本唯一」太严 ⇒ CODEX-DONE-v10.5.md 的 `### 修法` ×3、README.md 的 `### 验证` ×2
 *      都是**不同父节下的同名子节**，完全合法 ⇒ 改成「标题**路径**唯一」。
 */
