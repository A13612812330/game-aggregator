/**
 * tools/_archive-cleanup-20261014.js — 一次性：为「清理 1.1GB 归档/测试产物」做可追溯备份
 *
 * ★ 背景（2026-10-14，用户原话「清理并备份到github」）：
 *   项目目录 1880.6 MB，但**真正的业务数据只有 data/ 的 133 MB**。
 *   其余 1.1 GB 是归档 / 测试 / 预览产物，且 `.gitignore` 自己写了这些是
 *   「可重跑的中间产物、本地备份、验收截图」⇒ 一律不入库。
 *
 * ★★★ 本脚本存在的唯一理由：**GitHub 装不下 1.1GB。**
 *   `gh api repos/.../game-aggregator` 实测仓库 49140 KB；
 *   GitHub 单文件硬上限 100 MB、仓库 >1 GB 会警告。
 *   ⇒ 不能承诺「把 1.1GB 备份到 GitHub」。能做且必须做的是：
 *     ① **manifest**：全部待删文件的 路径 / 大小 / mtime / SHA256 —— 逐文件可核；
 *     ② **文本资产**：脚本、报告、md、日志、还原说明 —— 这些是「知识」，压缩后入 GitHub；
 *     ③ 大二进制（profile 缓存 / 截图 / .bin）**不入库**，依据是
 *        `_archived/cache-purge-20260920/README.md` 自己写的「全部可重建」+ `.gitignore` 的分类。
 *
 * ★ 删除边界（刻意保守）：`_archived/` 里**只清 cache-purge-20260920/**（451 MB 缓存归档），
 *   保留 v1 四页快照、v10.41 文档、launcher —— 因为 `CODEX-TASKS.md:421` 与
 *   `tools/_build-deploy-payload.js:6` 都写着「不要动 `_archived/`（用户资产）」，
 *   删掉整个 `_archived/` 会把这条约定连同历史快照一起抹了。
 *
 * 用法：
 *   node tools/_archive-cleanup-20261014.js --dry    # 只统计，不写文件
 *   node tools/_archive-cleanup-20261014.js          # 写 manifest + 复制文本资产
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'archive-cleanup-2026-10-14');
const TEXT_STAGE = path.join(OUT_DIR, '_text-stage');   // 打包前的文本暂存区
const DRY = process.argv.includes('--dry');

/* ---------- 待删范围（路径相对项目根；最后一项是目录前缀） ---------- */
const TARGETS = [
  { dir: '_archived/cache-purge-20260920', why: '2026-09-20 缓存归档：421MB 死掉的 Edge profile + 22MB 旧 chrome-probe profile；README 自己写「全部可重建」并给出删除命令' },
  { dir: '_test-out', why: '.gitignore:47 明列「临时工作目录，可重跑」' },
  { dir: '_preview', why: '.gitignore:41 明列「本地验收产物（浏览器实拍截图），体积大」' },
  { dir: '_bak', why: '.gitignore:19 明列「本地备份」，且内容已在 git 历史里' },
  { dir: '_verify', why: '.gitignore:56 明列「判版与改前改后对照的落点，纯排查产物、可随时重建」' },
  { dir: '_probe2', why: '.gitignore:93 明列「排查用探针的工作目录，纯排查产物，重跑的脚本都在里面」' },
];

/* ---------- 例外：这些要**保留**（不删、也不进 manifest 的删除清单） ---------- */
const KEEP = [
  /^_preview\/v1073-/,        // v10.73 本版验收截图（交付证据，5 张）
];

/* ---------- 文本类判据（可入 GitHub 的「知识」） ---------- */
const TEXT_EXT = /\.(md|txt|js|mjs|cjs|json|jsonl|log|csv|tsv|cmd|bat|vbs|ps1|sh|yml|yaml|html|htm)$/i;
const TEXT_MAX = 5 * 1024 * 1024;   // 单个 >5MB 的 HTML/JSON 按二进制处理（缓存样本，无智力价值）

function walk(dir, base, acc) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return acc; }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    const rel = path.relative(base, full).split(path.sep).join('/');
    if (e.isDirectory()) walk(full, base, acc);
    else if (e.isFile()) acc.push({ full, rel });
  }
  return acc;
}

function sha256(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch (e) { return null; }
}

function fmtMB(n) { return (n / 1048576).toFixed(2); }

/* ============================================================ */
const manifest = {
  generatedAt: new Date().toISOString(),
  reason: '清理 1.1GB 归档/测试产物前的可追溯备份（GitHub 仓库装不下大二进制）',
  projectRoot: ROOT,
  scope: [],
  summary: { files: 0, bytes: 0, textFiles: 0, textBytes: 0, binaryFiles: 0, binaryBytes: 0, keptFiles: 0, keptBytes: 0 },
  files: [],
  kept: [],
};

fs.mkdirSync(OUT_DIR, { recursive: true });
if (!DRY) fs.mkdirSync(TEXT_STAGE, { recursive: true });

for (const t of TARGETS) {
  const abs = path.join(ROOT, t.dir);
  if (!fs.existsSync(abs)) { console.log('  -- 跳过（不存在）: ' + t.dir); continue; }
  const all = walk(abs, ROOT, []);
  const scopeRow = { dir: t.dir, why: t.why, files: 0, bytes: 0, textFiles: 0, textBytes: 0 };
  let nText = 0, bText = 0;
  for (const f of all) {
    if (KEEP.some((re) => re.test(f.rel))) {
      const sz = fs.statSync(f.full).size;
      manifest.kept.push({ path: f.rel, size: sz });
      manifest.summary.keptFiles++; manifest.summary.keptBytes += sz;
      continue;
    }
    const st = fs.statSync(f.full);
    const isText = TEXT_EXT.test(f.rel) && st.size <= TEXT_MAX;
    const rec = { path: f.rel, size: st.size, mtime: st.mtime.toISOString(), sha256: sha256(f.full) };
    if (isText) { rec.text = true; nText++; bText += st.size; }
    manifest.files.push(rec);
    scopeRow.files++; scopeRow.bytes += st.size;
    if (isText) { scopeRow.textFiles++; scopeRow.textBytes += st.size; }
  }
  manifest.summary.files += scopeRow.files;
  manifest.summary.bytes += scopeRow.bytes;
  manifest.summary.textFiles += scopeRow.textFiles;
  manifest.summary.textBytes += scopeRow.textBytes;
  manifest.summary.binaryFiles += scopeRow.files - scopeRow.textFiles;
  manifest.summary.binaryBytes += scopeRow.bytes - scopeRow.textBytes;
  manifest.scope.push(scopeRow);
  console.log('  ' + t.dir.padEnd(34) + scopeRow.files + ' 文件 / ' + fmtMB(scopeRow.bytes) + ' MB  (文本 ' + scopeRow.textFiles + ' / ' + fmtMB(scopeRow.textBytes) + ' MB)');
}

manifest.summary.files = manifest.files.length;
manifest.summary.bytes = manifest.files.reduce((s, x) => s + x.size, 0);
manifest.summary.textFiles = manifest.files.filter((x) => x.text).length;
manifest.summary.textBytes = manifest.files.filter((x) => x.text).reduce((s, x) => s + x.size, 0);
manifest.summary.binaryFiles = manifest.summary.files - manifest.summary.textFiles;
manifest.summary.binaryBytes = manifest.summary.bytes - manifest.summary.textBytes;

console.log('\n  合计：' + manifest.summary.files + ' 文件 / ' + fmtMB(manifest.summary.bytes) + ' MB');
console.log('    文本(入 GitHub)：' + manifest.summary.textFiles + ' / ' + fmtMB(manifest.summary.textBytes) + ' MB');
console.log('    二进制(删  )   ：' + manifest.summary.binaryFiles + ' / ' + fmtMB(manifest.summary.binaryBytes) + ' MB');
console.log('    保留(例外)     ：' + manifest.summary.keptFiles + ' / ' + fmtMB(manifest.summary.keptBytes) + ' MB');

if (DRY) { console.log('\n  --dry：未写任何文件。'); process.exit(0); }

/* ---------- 复制文本资产到暂存区（保持相对路径） ---------- */
let copied = 0, copyBytes = 0, failed = 0;
for (const rec of manifest.files) {
  if (!rec.text) continue;
  const src = path.join(ROOT, rec.path);
  const dst = path.join(TEXT_STAGE, rec.path);
  try {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    copied++; copyBytes += rec.size;
  } catch (e) { failed++; console.log('  ⚠ 复制失败: ' + rec.path + ' —— ' + e.message); }
}

fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log('\n  已写 manifest.json（' + fmtMB(fs.statSync(path.join(OUT_DIR, 'manifest.json')).size) + ' MB）');
console.log('  已复制文本资产 ' + copied + ' 个 / ' + fmtMB(copyBytes) + ' MB' + (failed ? '，失败 ' + failed : ''));
