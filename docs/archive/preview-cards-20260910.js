/* _preview-cards.mjs — 用真实接口数据渲染「手游中心」卡片，输出静态预览 HTML
 * 目的：在不启浏览器的情况下肉眼核对合并卡片的字段与样式是否正确。
 */
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:8123';

(async () => {
  const list = await fetch(BASE + '/api/mobilehub/list?limit=12&sort=both').then((r) => r.json());
  const stats = await fetch(BASE + '/api/mobilehub/stats').then((r) => r.json());

  const TIER_CLS = { '流畅': 'smooth', '可玩': 'ok', '勉强': 'low', '卡顿': 'bad' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function card(it) {
    const title = it.name || it.libTitle || '?';
    const cov = it.libCover
      ? `<div class="cov"><img src="${esc(it.libCover)}" alt="" loading="lazy" referrerpolicy="no-referrer">
         ${it.libId ? `<button class="cov-btn" data-lib="${esc(it.libId)}" data-title="${esc(it.libTitle || title)}" type="button">查看游戏详情</button>` : ''}</div>`
      : `<div class="cov noimg"><span>${esc(String(title).slice(0, 2).toUpperCase())}</span></div>`;
    const srcs = it.sources || [];
    const srcTag = (srcs.indexOf('bh') >= 0 && srcs.indexOf('pc') >= 0)
      ? `<span class="tg src both">社区+实测</span>`
      : srcs.indexOf('pc') >= 0 ? `<span class="tg src pc">本站实测</span>`
        : `<span class="tg src bh">社区配置</span>`;
    const cfg = it.configs || 0, rec = it.records || 0;
    const fps = it.bestLabel || (it.bestMid ? it.bestMid + ' 帧' : '');
    const gpus = (it.gpus || []).slice(0, 3).map((g) => `<span class="tg">${esc(g)}</span>`).join('');
    const more = (it.gpus || []).length > 3 ? `<span class="tg dim">+${it.gpus.length - 3}</span>` : '';
    const alt = (it.alt || []).filter((a) => a && a !== title)[0] || '';
    const altHtml = alt ? `<div class="alt" title="${esc(alt)}">${esc(String(alt).slice(0, 40))}</div>` : '';
    return `<article class="emu-card${it.libCover ? ' has-cov' : ''}">
      ${cov}
      <div class="bd">
        <h4 title="${esc(title)}">${esc(title)}</h4>
        ${altHtml}
        <div class="meta">
          ${cfg ? `<span class="pill hot">${cfg} 套配置</span>` : ''}
          ${rec ? `<span class="pill rec">${rec} 条实测</span>` : ''}
          ${fps ? `<span class="pill fps ${TIER_CLS[it.tier] || ''}">${esc(String(fps))}</span>` : ''}
        </div>
        <div class="tgs">${srcTag}${gpus}${more}</div>
      </div>
    </article>`;
  }

  const css = fs.readFileSync(path.join('public', 'index.html'), 'utf8');
  const st = css.slice(css.indexOf('<style>') + 7, css.indexOf('</style>'));

  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>手游中心卡片预览</title><style>${st}
body{background:var(--c-bg,#F7F8FC);padding:22px;font-family:var(--font,system-ui)}
.pv-h{margin:0 0 14px;font-size:15px;font-weight:800}
.pv-h span{font-size:12px;font-weight:600;color:#6B7280;margin-left:8px}
</style></head><body>
<div class="pv-h">📱 手游中心 · 合并卡片预览<span>默认排序「双料优先」· 默认「仅看匹配端游」· 共 ${list.total} 款</span></div>
<div class="pv-h" style="font-weight:600;font-size:12px;color:#6B7280">
合并总数 ${stats.total} ｜ 匹配端游 ${stats.matched}（${stats.matchedRate}%）｜ 配置 ${stats.configs} ｜ 实测记录 ${stats.records}
</div>
<div class="emu-grid">${(list.items || []).map(card).join('')}</div>
</body></html>`;

  fs.writeFileSync('_preview-cards.html', html, 'utf8');
  console.log('written _preview-cards.html, cards:', (list.items || []).length);
  const withFps = (list.items || []).filter((x) => x.bestLabel).length;
  console.log('首屏带帧率:', withFps, '/', (list.items || []).length);
})();
