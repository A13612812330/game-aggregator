#!/usr/bin/env node
/**
 * tools/refresh-bannerhub.js
 * 重新拉取 BannerHub 社区配置仓库并重建本地索引（纯 Node，可被服务端直接调用）。
 *
 * 为什么不用 git clone：本机 github.com 主站常被拦截（clone 超时），
 * 而 codeload.github.com（压缩包）可通 —— 所以走 tar.gz 快照。
 *
 * 用法：
 *   node tools/refresh-bannerhub.js            # 完整刷新
 *   node tools/refresh-bannerhub.js --json     # 输出机器可读结果（供接口调用）
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'bannerhub');
const REPO = 'The412Banner/bannerhub-game-configs';
const BRANCH = 'main';
const URL = `https://codeload.github.com/${REPO}/tar.gz/refs/heads/${BRANCH}`;
const JSON_OUT = process.argv.includes('--json');

function log(...a) { if (!JSON_OUT) console.log(...a); }

/** 调用系统 tar（Windows 10+ 自带 bsdtar；Git Bash 亦有 GNU tar）
 *  注意：GNU tar 会把 `C:\...` 当成远程主机（rsh 语法）而报 "Cannot connect to C"，
 *  所以一律用「cwd + 相对文件名」，不传绝对路径。 */
function tar(args, opts = {}) {
  return execFileSync('tar', args, { maxBuffer: 256 * 1024 * 1024, ...opts });
}

async function main() {
  const t0 = Date.now();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-'));
  const TGZ = 'bh.tar.gz';   // 相对 tmp 的文件名（见上方说明）
  fs.mkdirSync(path.join(DATA, 'raw'), { recursive: true });

  try {
    // ① 下载快照
    log('① 下载仓库快照（codeload）…');
    const r = await fetch(URL, { redirect: 'follow' });
    if (!r.ok) throw new Error(`下载失败 HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(path.join(tmp, TGZ), buf);
    log(`   ${(buf.length / 1048576).toFixed(1)} MB`);

    // ② 提取顶层数据文件
    log('② 提取顶层数据文件…');
    const prefix = `bannerhub-game-configs-${BRANCH}`;
    tar(['-xzf', TGZ, `${prefix}/games.json`, `${prefix}/devices.json`, `${prefix}/recent.json`], { cwd: tmp });
    for (const f of ['games.json', 'devices.json', 'recent.json']) {
      fs.copyFileSync(path.join(tmp, prefix, f), path.join(DATA, 'raw', f));
    }

    // ③ 导出配置清单（不落地 1.4 万个文件）
    log('③ 导出配置清单…');
    const listing = tar(['-tzf', TGZ], { cwd: tmp, encoding: 'utf8' });
    const files = listing.split(/\r?\n/)
      .filter((l) => l.startsWith(`${prefix}/configs/`) && l.endsWith('.json'))
      .map((l) => l.slice(prefix.length + 1));
    if (!files.length) throw new Error('清单为空，仓库结构可能已变更');
    fs.writeFileSync(path.join(DATA, 'filelist.txt'), files.join('\n') + '\n', 'utf8');
    log(`   ${files.length} 条配置`);

    // ④ 重建索引
    log('④ 重建索引…');
    const out = execFileSync(process.execPath, [path.join(__dirname, 'build-bannerhub.js')], { encoding: 'utf8' });
    if (!JSON_OUT) process.stdout.write(out);

    const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'bannerhub.json'), 'utf8'));
    const result = {
      ok: true, ms: Date.now() - t0, files: files.length,
      games: idx.stats.games, configs: idx.stats.configs,
      phones: idx.stats.phones, gpus: idx.stats.gpus,
      matchedLibGames: idx.stats.matchedLibGames,
    };
    if (JSON_OUT) console.log(JSON.stringify(result));
    else log(`✅ 完成（${(result.ms / 1000).toFixed(1)}s）`);
    return result;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
}

main().then((r) => process.exit(r.ok ? 0 : 1))
  .catch((e) => {
    if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
    else console.error('❌ 刷新失败：', (e && e.message) || e);
    process.exit(1);
  });
