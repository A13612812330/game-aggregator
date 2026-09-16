#!/usr/bin/env node
/**
 * tools/build-bannerhub.js
 * 把 BannerHub 社区配置仓库（The412Banner/bannerhub-game-configs）聚合成本地索引。
 *
 * 输入：
 *   data/bannerhub/raw/games.json    仓库顶层游戏表 [{name,count}]
 *   data/bannerhub/raw/devices.json  仓库顶层设备表 {game:[{m,d,s}]}
 *   data/bannerhub/raw/recent.json   最近上传 20 条
 *   data/bannerhub/filelist.txt      配置文件名清单（tar -tzf 导出，每行 configs/<游戏>/<文件名>）
 * 输出：
 *   data/bannerhub.json
 *
 * 用法： node tools/build-bannerhub.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RAW = path.join(ROOT, 'data', 'bannerhub', 'raw');
const OUT = path.join(ROOT, 'data', 'bannerhub.json');
const FILELIST = path.join(ROOT, 'data', 'bannerhub', 'filelist.txt');
const LIB = path.join(ROOT, 'data', 'games.json');

/* ---------- 归一化：BannerHub 名 / 库内中英文名 → 同一把钥匙 ---------- */
function normKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')   // 去掉一切非字母数字
    .trim();
}
/* 库内标题形如「中文名/English Name/支持网络联机」或「中文名-English Name-后缀」 */
function libKeys(title) {
  const out = new Set();
  const t = String(title || '');
  const parts = t.split('/').map((x) => x.trim()).filter(Boolean);
  for (const p of parts) {
    out.add(normKey(p));
    out.add(normKey(p.replace(/[-–—].*$/, ''))); // 去掉 -虚拟机版 / -CRACKFIX 之类后缀
  }
  out.add(normKey(t));
  out.add(normKey(t.replace(/[-–—].*$/, '')));
  out.delete('');
  return [...out].filter((k) => k.length >= 4);
}

/* ---------- 解析配置文件名 ----------
 * 仓库里的命名并不统一，实测有这些形态：
 *   <游戏>-<品牌>-<型号>-<GPU>-<ts>          Cyberpunk_2077-samsung-SM-S911B-Adreno__TM__740-1743710400
 *   <游戏>-<品牌>-<型号>-<GPU前半>-<GPU后半>-<ts>   ...-samsung-SM-A307FN-Mali-G71-1787822409
 *   <游戏>-<品牌>-<型号>-<ts>                （无 GPU）Cuphead-Xiaomi-23043RP34G-1775264270
 *   <游戏>-<品牌>-<型号>-<GPU>-<ts>-<品牌>-<型号>-<GPU>-<ts>（两条粘一起，取最后一条）
 * 游戏名 / 型号 / GPU 里都可能含 `-`，所以不能按固定段数切。
 * 策略：先剥掉末尾时间戳，再从右往左找第一个「GPU 厂商词头」作为 GPU 起点。
 */
const GPU_PREFIX = /^(adreno|mali|powervr|immortalis|xclipse|rogue|angle|apple|vivante|tegra|geforce|radeon|imagination|intel)/i;
function prettyGpu(s) {
  return String(s || '')
    .replace(/_*TM_*/gi, ' ')        // Adreno__TM__830 → Adreno 830
    .replace(/_+/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}
function parseCfg(relPath) {
  const seg = relPath.split('/');
  const game = seg[1];
  const file = seg[seg.length - 1];
  const parts = file.replace(/\.json$/, '').split('-');
  let end = parts.length;
  let ts = 0;
  if (end && /^\d{8,}$/.test(parts[end - 1])) { ts = parseInt(parts[end - 1], 10); end--; }
  const rest = parts.slice(1, end);          // 去掉游戏名（parts[0] 不完整，游戏名以目录名为准）
  let gi = -1;
  for (let i = rest.length - 1; i >= 0; i--) { if (GPU_PREFIX.test(rest[i])) { gi = i; break; } }
  let gpu = '', model = '', brand = '';
  if (gi >= 0) {
    gpu = prettyGpu(rest.slice(gi).join('-'));
    model = rest[gi - 1] || '';
    brand = rest[gi - 2] || '';
  } else {
    model = rest[rest.length - 1] || '';
    brand = rest[rest.length - 2] || '';
  }
  const phone = pretty([brand, model].filter(Boolean).join(' '));
  return { game, phone, gpu, ts, file };
}
function pretty(s) {
  return String(s || '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ---------- 主流程 ---------- */
function main() {
  const games = JSON.parse(fs.readFileSync(path.join(RAW, 'games.json'), 'utf8'));
  let devices = {};
  try { devices = JSON.parse(fs.readFileSync(path.join(RAW, 'devices.json'), 'utf8')); } catch (e) {}
  let recent = [];
  try { recent = JSON.parse(fs.readFileSync(path.join(RAW, 'recent.json'), 'utf8')); } catch (e) {}

  // ① 逐行解析配置清单 → 按游戏聚合
  const agg = new Map(); // game -> { c, dv:Map, gp:Map, t, files:[] }
  let lines = [];
  try { lines = fs.readFileSync(FILELIST, 'utf8').split(/\r?\n/).filter(Boolean); } catch (e) {
    console.error('⚠️  缺少 data/bannerhub/filelist.txt（配置清单），仅用 games.json 的 count 字段');
  }
  for (const line of lines) {
    const { game, phone, gpu, ts, file } = parseCfg(line);
    if (!game) continue;
    let a = agg.get(game);
    if (!a) { a = { c: 0, dv: new Map(), gp: new Map(), t: 0, files: [] }; agg.set(game, a); }
    a.c++;
    if (phone) a.dv.set(phone, (a.dv.get(phone) || 0) + 1);
    if (gpu) a.gp.set(gpu, (a.gp.get(gpu) || 0) + 1);
    if (ts > a.t) a.t = ts;
    a.files.push([phone, gpu, ts, file]);
  }

  const topN = (m, n) => [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, n).map(([k]) => k);

  // ② 组装 games 数组（以仓库 games.json 为准，配置数用实际清单覆盖）
  const list = [];
  const keyIndex = {};       // 归一化名 → games 下标
  const devAll = new Map();  // 全站手机型号 → 配置数
  const gpuAll = new Map();
  for (const g of games) {
    const a = agg.get(g.name);
    const dvRaw = Array.isArray(devices[g.name]) ? devices[g.name] : [];
    const dv = a ? topN(a.dv, 6) : [];
    const gp = a ? topN(a.gp, 4) : [];
    if (!dv.length) {
      for (const d of dvRaw.slice(0, 6)) {
        const nm = pretty(d.m || d.d || '');
        if (nm) dv.push(nm);
      }
    }
    if (!gp.length) for (const d of dvRaw.slice(0, 4)) { const nm = pretty(d.s || d.d || ''); if (nm) gp.push(nm); }
    for (const [k, v] of (a ? a.dv : [])) devAll.set(k, (devAll.get(k) || 0) + v);
    for (const [k, v] of (a ? a.gp : [])) gpuAll.set(k, (gpuAll.get(k) || 0) + v);

    const idx = list.length;
    list.push({
      k: g.name,
      p: pretty(g.name),
      c: a ? a.c : (g.count || 0),
      t: a ? a.t : 0,
      dv, gp,
      n: dvRaw.length,           // 仓库登记的机型总数
    });
    const key = normKey(g.name);
    if (key && keyIndex[key] === undefined) keyIndex[key] = idx;
  }

  // ③ 与本地库做预匹配（统计用；运行时仍走 keyIndex 动态匹配，保证新入库条目也能命中）
  let lib = [];
  try {
    const raw = JSON.parse(fs.readFileSync(LIB, 'utf8'));
    lib = Array.isArray(raw) ? raw : (raw.items || raw.games || []);
  } catch (e) { console.warn('⚠️  读取 data/games.json 失败，跳过匹配率统计'); }
  const libHit = new Map(); // games 下标 → [libItem,...]
  let matchedLibItems = 0;
  for (const it of lib) {
    for (const k of libKeys(it.title)) {
      const i = keyIndex[k];
      if (i !== undefined) {
        if (!libHit.has(i)) libHit.set(i, []);
        libHit.get(i).push(it.id);
        matchedLibItems++;
        break;
      }
    }
  }

  const out = {
    builtAt: Date.now(),
    repo: 'The412Banner/bannerhub-game-configs',
    site: 'https://the412banner.github.io/bannerhub-game-configs/',
    api: 'https://api.github.com/repos/The412Banner/bannerhub-game-configs/contents/configs/',
    raw: 'https://raw.githubusercontent.com/The412Banner/bannerhub-game-configs/main/configs/',
    stats: {
      games: list.length,
      configs: list.reduce((s, x) => s + x.c, 0),
      phones: devAll.size,
      gpus: gpuAll.size,
      matchedLibGames: libHit.size,
      matchedLibItems,
      libTotal: lib.length,
      topPhones: [...devAll.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [k, v]),
      topGpus: [...gpuAll.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [k, v]),
      topGames: [...list].sort((a, b) => b.c - a.c).slice(0, 12).map((x) => [x.p, x.c]),
    },
    recent: (recent || []).map((r) => ({ g: r.game, p: pretty(r.game), ph: pretty(r.manufacturer), gpu: pretty(r.device), t: r.timestamp })),
    keyIndex,
    games: list,
  };

  fs.writeFileSync(OUT, JSON.stringify(out), 'utf8');
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`✅ 已生成 ${path.relative(ROOT, OUT)}（${kb} KB）`);

  // ④ 逐配置明细（服务端按需加载，不进前端首包）
  const files = {};
  for (const [game, a] of agg) {
    files[game] = a.files.sort((x, y) => y[2] - x[2]);
  }
  const OUTF = path.join(ROOT, 'data', 'bannerhub-files.json');
  fs.writeFileSync(OUTF, JSON.stringify(files), 'utf8');
  console.log(`✅ 已生成 ${path.relative(ROOT, OUTF)}（${(fs.statSync(OUTF).size / 1024).toFixed(0)} KB，${Object.keys(files).length} 款游戏逐条配置）`);
  console.log(`   游戏 ${out.stats.games} 款 / 配置 ${out.stats.configs} 份 / 手机机型 ${out.stats.phones} / GPU ${out.stats.gpus}`);
  console.log(`   与本地库匹配：${out.stats.matchedLibGames} 款 BannerHub 游戏命中 ${out.stats.matchedLibItems} 条库记录（库共 ${out.stats.libTotal} 条）`);
  console.log(`   配置最多的游戏：` + out.stats.topGames.slice(0, 5).map(([n, c]) => `${n}(${c})`).join(', '));
}

main();
