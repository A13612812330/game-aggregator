#!/usr/bin/env node
/**
 * tools/fill-covers.js — 给本地库里 `cover` 为空的条目补封面（幂等 · 只填空不覆写）
 *
 * ★ 为什么会有「有条目但没封面」：
 *   XD 列表页/详情页的封面是懒加载图，索引期偶尔取不到就留了空。实测 2026-09-20：
 *   18,961 条里 7 条为空（0.04%），全都是 xdgamer 源的老条目。
 *
 * ★ 取图路线（三级，逐级降级，**只在验证 HTTP 200 后才写回**）：
 *   ① 抓 XD 详情页 → 从页内图片 URL 反推 Steam appid
 *      （形如 …/store_item_assets/steam/apps/<appid>/… 或 …/images/apps/<appid>/…）
 *   ② 调 Steam 官方 `appdetails?appids=<id>&filters=basic` 拿 `header_image`
 *      —— 官方给的是**带 hash 的完整路径**，自己硬拼 `apps/<id>/header.jpg` 会 404
 *      （实测「欺世欢悦 4001800」就是这种：直接拼 404，官方路径 200 且是 460×215）
 *   ③ 把返回 URL 的域名映射到 XD 用的镜像 `shared.cdn.queniuqe.com`
 *      —— 与库内其余 1.8 万条保持同一域名，镜像实测与 akamai 同源可达
 *
 * ★ 顺带回填 `appid`：只有「该 appid 真的取到了封面」才写，
 *   这等于用「能取到图」当成了 appid 正确性的证明。
 *
 * 用法：
 *   node tools/fill-covers.js           # 实际写入 data/games.json
 *   node tools/fill-covers.js --dry     # 只报告，不落盘
 */
const fs = require('fs');
const path = require('path');
const { getHtml } = require('../shared');

const GAMES = path.join(__dirname, '..', 'data', 'games.json');
const DRY = process.argv.includes('--dry');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
/** akamai 原站 → 库内统一使用的镜像域名（同源，实测 206 + 460×215） */
const MIRROR_FROM = 'shared.akamai.steamstatic.com';
const MIRROR_TO = 'shared.cdn.queniuqe.com';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 带超时的 GET，返回 { code, type, len }；只读前几 KB 用于验证可达性 */
function probe(url, timeout = 15000) {
  const https = require('https');
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Range: 'bytes=0-1023' } }, (res) => {
      let n = 0;
      res.on('data', (d) => {
        n += d.length;
        if (n > 4096) res.destroy();
      });
      const done = () => resolve({ code: res.statusCode, type: res.headers['content-type'] || '', len: res.headers['content-length'] || n });
      res.on('end', done);
      res.on('close', done);
    });
    req.on('error', (e) => resolve({ code: 0, err: e.code }));
    req.setTimeout(timeout, () => {
      req.destroy();
      resolve({ code: 0, err: 'TIMEOUT' });
    });
  });
}

/** 从详情页 HTML 里按**出现顺序**抠出候选 Steam appid（去重） */
function appidsOf(html) {
  const out = [];
  const seen = new Set();
  for (const m of String(html || '').matchAll(/\/apps\/(\d{3,9})\//g)) {
    const id = m[1];
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** 调 Steam 官方接口拿 header_image（filters=basic 是必须的，否则返回巨大） */
async function steamHeader(appid) {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic&l=schinese`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  const d = j && j[appid];
  if (!d || !d.success || !d.data) return null;
  return { name: d.data.name || '', header: d.data.header_image || '' };
}

async function main() {
  const raw = fs.readFileSync(GAMES, 'utf8');
  const arr = JSON.parse(raw);
  const targets = arr.filter((x) => !(x.cover && /^https?:/i.test(x.cover)));
  console.log(`本地库 ${arr.length} 条，封面为空的 ${targets.length} 条${DRY ? '（--dry 不落盘）' : ''}`);
  if (!targets.length) {
    console.log('无需处理。');
    return;
  }
  console.log();

  let filled = 0;
  let failed = 0;
  for (const it of targets) {
    const gid = String(it.id || '').replace(/^xd-/, '');
    const page = 'https://www.xdgame.com/game/' + gid + '.html';
    let html = '';
    try {
      html = await getHtml(page);
    } catch (e) {
      console.log(`❌ ${it.id} 详情页抓取失败：${String(e && e.message).slice(0, 80)}`);
      failed++;
      continue;
    }
    const cands = appidsOf(html);
    if (!cands.length) {
      console.log(`❌ ${it.id} ${String(it.title).slice(0, 30)} 详情页里找不到 appid`);
      failed++;
      continue;
    }
    let done = false;
    for (const ap of cands.slice(0, 4)) {
      let info = null;
      try {
        info = await steamHeader(ap);
      } catch (e) {
        /* 官方接口偶发 403/超时，换下一个候选 */
      }
      await sleep(400);
      if (!info || !info.header) continue;
      /* 域名映射到库内统一的镜像；映射后必须复验，不通过就退回官方原始 URL */
      const mirrored = info.header.split(MIRROR_FROM).join(MIRROR_TO);
      let use = '';
      const p1 = await probe(mirrored);
      if (p1.code >= 200 && p1.code < 300 && /^image\//.test(p1.type)) use = mirrored;
      else {
        const p2 = await probe(info.header);
        if (p2.code >= 200 && p2.code < 300 && /^image\//.test(p2.type)) use = info.header;
      }
      if (!use) continue;
      console.log(`✅ ${it.id}  ${String(it.title).slice(0, 34)}`);
      console.log(`     appid ${ap} · steam名「${info.name}」`);
      console.log(`     ${use.slice(0, 118)}`);
      if (!DRY) {
        it.cover = use;
        if (!it.appid) it.appid = ap;
      }
      done = true;
      filled++;
      break;
    }
    if (!done) {
      console.log(`❌ ${it.id} ${String(it.title).slice(0, 30)} 候选 appid ${cands.length} 个都没取到图`);
      failed++;
    }
  }

  console.log();
  console.log(`补上 ${filled} 条，失败 ${failed} 条`);
  if (DRY) {
    console.log('（--dry：未写入）');
    return;
  }
  const out = JSON.stringify(arr);
  if (out === raw) {
    console.log('内容无变化，未写盘。');
    return;
  }
  fs.writeFileSync(GAMES, out);
  const after = JSON.parse(fs.readFileSync(GAMES, 'utf8'));
  const still = after.filter((x) => !(x.cover && /^https?:/i.test(x.cover))).length;
  console.log(`已写入 data/games.json —— 剩余无封面 ${still} 条`);
}
main().catch((e) => {
  console.error('ERROR', e);
  process.exit(1);
});
