/* tools/preview-v1011-ba.js — 出「同分类更多」改前 / 改后对照页（真实数据，非示意）
 *
 *  改前：`/api/library/browse?g=genres[0]&sort=score` 取 100 条 → 前端随机洗牌取 6
 *        （库里每款只有 1 个标签，「动作冒险」独占 36.8%，等价于在超大池子里抽卡）
 *  改后：/api/library/related 多因子打分（类型 IDF + 系列名 + 评分接近度 + 容量接近度）
 *
 * 运行：node tools/preview-v1011-ba.js
 * 产出：_preview/v1011-before-after.html
 */
const fs = require('fs');
const path = require('path');
const gamesDb = require('../data/gamesDb');
const related = require('../data/related');

gamesDb.load();
const OUT = path.join(__dirname, '..', '_preview');
const ALL = gamesDb.all();

const SAMPLES = ['xd-191', 'xd-5828', 'xd-3668', 'xd-136'];

/** 旧实现（去掉随机洗牌，保留其排序与选池逻辑）：同标签 + 评分倒序 → 前 6 */
function oldPicks(cur) {
  const g = (cur.genres || [])[0] || '';
  if (!g) return { genre: '', items: [] };
  const r = gamesDb.browse(g, 100, 0, 'score');
  const curSeg = related.mainSeg(cur.title).toLowerCase();
  const items = (r.items || []).filter((it) => {
    if (!it || it.url === cur.url) return false;
    const seg = related.mainSeg(it.title).toLowerCase();
    return seg !== curSeg;
  }).slice(0, 6);
  return { genre: g, items };
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const cards = (items, mode) => items.map((it) => {
  const zh = related.mainSeg(it.title);
  const why = mode === 'new' && it.why && it.why.length
    ? `<i class="why">${esc(it.why[0])}</i>` : '';
  return `<div class="c">
    ${it.cover ? `<img src="${esc(it.cover)}" loading="lazy" alt="">` : '<div class="noimg"></div>'}
    <b class="t" title="${esc(it.title)}">${esc(zh)}</b>
    <span class="m">★${it.score || '—'} · ${esc(it.size || '容量未知')}</span>${why}</div>`;
}).join('');

let nOldSameSeries = 0, nNewSameSeries = 0, nOld = 0, nNew = 0;
const blocks = SAMPLES.map((id) => {
  const cur = gamesDb.byIdGet(id);
  if (!cur) return '';
  const o = oldPicks(cur);
  const n = related.related({ id: cur.id, t: cur.title, limit: 6 });
  const curKey = related.seriesKey(cur.title);
  const oS = o.items.filter((x) => related.seriesKey(x.title) === curKey && curKey).length;
  const nS = n.items.filter((x) => related.seriesKey(x.title) === curKey && curKey).length;
  nOld += o.items.length; nOldSameSeries += oS;
  nNew += n.items.length; nNewSameSeries += nS;
  const avg = (arr) => arr.length ? (arr.reduce((a, x) => a + (Number(x.score) || 0), 0) / arr.length).toFixed(2) : '—';
  return `<section>
    <h2>${esc(related.mainSeg(cur.title))} <span class="sub">${esc((cur.genres || []).join('/'))} · ★${cur.score || '—'} · ${esc(cur.size || '')}</span></h2>
    <div class="cols">
      <div class="col old"><h3>改前 · ${esc(o.genre || '无标签')} <em>均分 ${avg(o.items)}</em></h3>
        <div class="row">${cards(o.items, 'old')}</div>
        <p class="note">同标签 + 评分倒序；线上还会再<b>随机洗牌</b>。库里 36.8% 都是「动作冒险」，所以与本体常常毫不相干。</p></div>
      <div class="col new"><h3>改后 · 多因子打分 <em>均分 ${avg(n.items)}</em></h3>
        <div class="row">${cards(n.items, 'new')}</div>
        <p class="note">类型交集（IDF 加权）+ 系列名 + 评分接近度 + 容量接近度；同系列条目<b>跨标签并池</b>（生化危机4→8 才进得来）。</p></div>
    </div>
  </section>`;
}).join('');

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>v10.11 · 同分类更多 改前改后对照</title>
<style>
  :root{--c-t1:#0F172A;--c-t2:#334155;--c-t3:#8492AC;--c-border:#E6EAF2;--c-primary:#0B7BFF;--c-score:#F59E0B}
  *{box-sizing:border-box}
  body{margin:0;padding:26px 30px 40px;font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;
    background:#F6F8FC;color:var(--c-t1)}
  h1{font-size:19px;margin:0 0 6px}
  .lead{color:var(--c-t3);font-size:12.5px;margin-bottom:22px}
  .kpi{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:22px}
  .kpi div{background:#fff;border:1px solid var(--c-border);border-radius:10px;padding:8px 12px;font-size:12px}
  .kpi b{font-family:ui-monospace,Consolas,monospace;color:var(--c-primary);font-size:15px;margin-right:4px}
  section{background:#fff;border:1px solid var(--c-border);border-radius:14px;padding:14px 16px;margin-bottom:16px}
  h2{font-size:15px;margin:0 0 12px}
  h2 .sub{font-size:11.5px;color:var(--c-t3);font-weight:400;margin-left:6px}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  @media (max-width:900px){.cols{grid-template-columns:1fr}}
  .col{border:1px solid var(--c-border);border-radius:12px;padding:10px 12px}
  .col.old{background:#FFFBF7;border-color:#F7E3CE}
  .col.new{background:#F7FBFF;border-color:#D6E7FB}
  .col h3{font-size:12.5px;margin:0 0 9px;display:flex;gap:8px;align-items:baseline}
  .col h3 em{font-style:normal;font-size:11px;color:var(--c-t3);font-family:ui-monospace,monospace}
  .row{display:flex;gap:8px;overflow-x:auto}
  .c{flex:0 0 104px;display:flex;flex-direction:column;gap:4px}
  .c img,.c .noimg{width:100%;height:54px;object-fit:cover;border-radius:8px;background:#EDF1F7}
  .c .t{font-size:11.5px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .c .m{font-size:10.5px;color:var(--c-t3);font-family:ui-monospace,monospace}
  .c .why{font-style:normal;font-size:9.5px;font-weight:750;color:#1D4ED8;background:#DBEAFE;
    border-radius:4px;padding:1px 5px;align-self:flex-start}
  .note{font-size:11px;color:var(--c-t3);margin:9px 0 0;line-height:1.55}
  .note b{color:#B45309}
</style></head><body>
  <h1>v10.11 · 详情页「同分类更多」改前 / 改后对照</h1>
  <div class="lead">真实数据（本地库 ${ALL.length} 条），非示意图。改前 = 旧实现选池与排序（线上额外做了随机洗牌，这里去掉随机以便复现）。</div>
  <div class="kpi">
    <div><b>36.8%</b>库里都是「动作冒险」（5,627 / 15,302）</div>
    <div><b>99.6%</b>每款游戏只有 1 个类型标签</div>
    <div><b>${nOldSameSeries}/${nOld}</b>改前命中同系列</div>
    <div><b>${nNewSameSeries}/${nNew}</b>改后命中同系列</div>
  </div>
  ${blocks}
</body></html>`;

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'v1011-before-after.html'), html, 'utf8');
console.log('✅ _preview/v1011-before-after.html');
console.log(`   同系列命中：改前 ${nOldSameSeries}/${nOld} → 改后 ${nNewSameSeries}/${nNew}`);
