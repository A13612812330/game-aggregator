#!/usr/bin/env node
'use strict';
/**
 * 部署前磁盘体检（v10.109）
 *
 * 【为什么需要】
 *   2026-10-23 部署报 `ENOSPC`：C 盘 0 字节可用。原因是系统 Temp 里堆着
 *   `site-bundle.tar.gz`（上一次失败部署的载荷副本，190MB）与 `.net`（1.05GB）。
 *   发布工具把打包产物写到 `%TEMP%`，这一层不在本项目控制范围内 ——
 *   但「发之前先看一眼还剩多少、顺便清掉上一次的残留包」是可以固化的。
 *
 * 【默认只报告，不删】
 *   `node tools/prep-deploy.js`         → 只打印各盘剩余 + 可回收清单
 *   `node tools/prep-deploy.js --clean` → 额外删掉清单里那两项（`site-bundle.tar.gz` / `.net`）
 *
 * ★ 为什么删这两项是安全的：
 *   · `site-bundle.tar.gz` 是**上传载荷的临时压缩包**，发完即无用，下次部署会重新生成
 *   · `%TEMP%\.net` 是 dotnet 的临时解包缓存，删掉只影响下一次 dotnet 首次启动慢一点
 *   ★ 除这两项以外**什么都不删** —— 不扫、不动用户的 Temp 其它内容（个人文件红线）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLEAN = process.argv.includes('--clean');

/* 已知可回收的两个固定项。名字写死，不做通配 —— 通配 `*.tar.gz` 会误伤别人的包。 */
const RECLAIMABLE = [
  { name: 'site-bundle.tar.gz', rel: 'site-bundle.tar.gz', dir: false },
  { name: '.net 临时解包缓存', rel: '.net', dir: true },
];

function dirBytes(p, depth) {
  let total = 0;
  const stack = [[p, 0]];
  while (stack.length) {
    const [cur, d] = stack.pop();
    let ents = [];
    try { ents = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (d + 1 <= (depth || 99)) stack.push([full, d + 1]);
      } else {
        try { total += fs.statSync(full).size; } catch { /* 权限/占用，跳过 */ }
      }
    }
  }
  return total;
}

function freeGb(root) {
  try {
    /* fs.statfs 在 Node 18.15+ 可用，Windows 也支持 */
    const s = fs.statfsSync(root);
    return (s.bavail * s.bsize) / 1e9;
  } catch (e) { return null; }
}

const gb = (n) => (n / 1e9).toFixed(2) + ' GB';

console.log('=== 部署前磁盘体检 ===');
console.log('时间', new Date().toISOString().replace('T', ' ').slice(0, 19), '\n');

for (const [label, root] of [['C:', 'C:\\'], ['E:', 'E:\\']]) {
  const f = freeGb(root);
  console.log(label.padEnd(4) + ' 可用 ' + (f == null ? '未知' : f.toFixed(2) + ' GB'));
}

const tempDir = os.tmpdir();
console.log('\n系统 Temp：' + tempDir);

let reclaim = 0;
const found = [];
for (const it of RECLAIMABLE) {
  const p = path.join(tempDir, it.rel);
  let exists = false;
  try { fs.statSync(p); exists = true; } catch { exists = false; }
  if (!exists) { console.log('  · ' + it.name + '：不在（无需处理）'); continue; }
  const bytes = it.dir ? dirBytes(p, 99) : fs.statSync(p).size;
  reclaim += bytes;
  found.push({ ...it, p, bytes });
  console.log('  · ' + it.name + '：' + gb(bytes) + '  ← 可回收');
}

if (!found.length) {
  console.log('\n没有可回收项。');
} else {
  console.log('\n合计可回收 ' + gb(reclaim));
  if (CLEAN) {
    for (const it of found) {
      try {
        if (it.dir) fs.rmSync(it.p, { recursive: true, force: true });
        else fs.unlinkSync(it.p);
        console.log('  ✔ 已删 ' + it.p);
      } catch (e) {
        console.log('  ✘ 删不掉 ' + it.p + '：' + e.code);
      }
    }
    const f = freeGb('C:\\');
    console.log('清理后 C: 可用 ' + (f == null ? '未知' : f.toFixed(2) + ' GB'));
  } else {
    console.log('（只报告未删除；确认后加 --clean 执行）');
  }
}

/* 低空间预警：发布工具还要往 Temp 写约 1/4 载荷大小的压缩包 */
const cf = freeGb('C:\\');
if (cf != null && cf < 2) {
  console.log('\n⚠ C 盘可用 < 2GB —— 发布工具打包时会报 ENOSPC。先清或换盘再发。');
}
