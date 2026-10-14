/* ================= 🗜️ 解压助手 · 页面逻辑（独立页专属） =================
 *
 * 这个页面回答一个问题：**「下载下来的压缩包，能不能一次性解到底？」**
 * 用户原话（2026-10-14）：「压缩包中含有压缩包，有没有办法直接自动解压并且检测到
 * 如果还是有压缩包则直接再次解压或增加提醒+再次解压功能」。
 *
 * 分工（★ 照本站既有分工，页面不做业务判断）：
 *   递归解压的判定与执行全在 data/extractor.js（魔数识别 / 分卷 / 密码 / 回滚）
 *   任务调度与目录护栏在 server.js（/api/extract/*）
 *   本文件只管「拿数据、画出来、响应交互、轮询」。
 *
 * ★ 与「📦 解包匹配」是两件事，别看混：
 *   unpack  = 分析游戏解包工具导出的**配置 JSON**（判断能跑哪些游戏）
 *   extract = 把**压缩包**递归解开（本页）
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const st = {
    env: null,
    tab: 'url',
    taskId: null,
    timer: null,
    task: null,
    scan: null,
    lastTarget: null,    /* 上一轮的目标，供「重新解压」用 */
    hist: null,          /* ★ v10.73：落盘的历史记录（含每次的产物路径） */
  };

  const PHASE_TX = { queued: '排队中', download: '下载中', extract: '解压中', done: '已结束' };
  /* ⚠️ '7z' 必须加引号：数字开头的 key 在对象字面量里非法（曾整页 SyntaxError） */
  const FMT_TX = { zip: 'ZIP', rar: 'RAR', '7z': '7Z', gzip: 'GZ', bzip2: 'BZ2', xz: 'XZ', cab: 'CAB', tar: 'TAR' };

  function fmtSize(n) {
    if (!n && n !== 0) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  function note(text, kind) {
    const el = $('exMsg');
    if (!el) return;
    if (!text) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.className = 'ex-msg' + (kind ? ' ' + kind : '');
    el.textContent = text;
  }

  /* ============================ 环境自检 ============================ */
  async function loadEnv() {
    try {
      const d = await fetch(api('/api/extract/env')).then((r) => r.json());
      st.env = d;
      const el = $('exEnv');
      if (!d.ready) {
        el.className = 'ex-env bad';
        el.innerHTML = '<span class="dot"></span><b>解压器未就绪</b><span>' + esc(d.hint || '请安装 7-Zip') + '</span>';
        return;
      }
      el.className = 'ex-env ok';
      el.innerHTML = '<span class="dot"></span><b>解压器就绪</b>' +
        '<span class="mono">' + esc(d.exe) + '</span>' +
        '<span class="ver">' + esc(String(d.version || '').slice(0, 46)) + '</span>';
      if (d.defaultDir) {
        /* ★ 占位符只放「默认目录的尾部」，完整路径挪到 title：
         *   实测把整个 C:\Users\komo\Downloads\GameHub 塞进占位符，输入框会被撑到
         *   末尾截断，用户看不到目录名，反而比不显示更差。 */
        const seg = String(d.defaultDir).replace(/^[A-Za-z]:[\\/]/, '').split(/[\\/]/).filter(Boolean);
        const short = seg.length > 2 ? '…\\' + seg.slice(-2).join('\\') : seg.join('\\');
        const iu = $('exDirUrl');
        iu.placeholder = '保存到（留空 = ' + (short || '默认目录') + '）';
        iu.title = '默认目录：' + d.defaultDir;
        const id = $('exDir');
        id.placeholder = '文件夹绝对路径，例如 ' + (short || d.defaultDir);
        id.title = d.defaultDir;
        id.value = id.value || d.defaultDir;
      }
    } catch (e) {
      $('exEnv').className = 'ex-env bad';
      $('exEnv').innerHTML = '<span class="dot"></span><b>无法连接服务</b><span>' + esc(String(e.message || e)) + '</span>';
    }
  }

  /* ============================ Tab 切换 ============================ */
  function setTab(m) {
    st.tab = m;
    document.querySelectorAll('.ex-tab').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
    $('exPaneUrl').hidden = m !== 'url';
    $('exPaneDir').hidden = m !== 'dir';
    note('');
  }

  /* ============================ 轮询 ============================ */
  function stopPoll() { if (st.timer) { clearTimeout(st.timer); st.timer = null; } }

  function poll(id, delay) {
    stopPoll();
    st.timer = setTimeout(async () => {
      try {
        const d = await fetch(api('/api/extract/task?id=' + encodeURIComponent(id))).then((r) => r.json());
        if (!d.ok || !d.task) {
          note('任务查询失败：' + esc((d && d.error) || '未知错误'), 'err');
          return;
        }
        st.task = d.task;
        renderTask();
        if (d.task.state === 'running') poll(id, 800);
        else {
          renderReport(d.task.summary, d.task);
          if (d.task.state === 'need-password') note('有压缩包需要解压密码 —— 在下面填好再点「继续解压」。', 'warn');
          else if (d.task.state === 'error') note('任务结束但有失败项，详见报告。', 'err');
          else if (d.task.state === 'saved') note('这条地址给的不是压缩包，已按普通文件保存。');
          else if (d.task.state === 'not-archive') note('这条地址返回的是网页，不是文件（多半是网盘页）—— 没下到东西。', 'warn');
          else note('全部完成。');
          /* ★ v10.73：每跑完一单就刷一次历史 —— 用户要的正是「跑完回头看列表」。 */
          loadHistory();
        }
      } catch (e) {
        note('轮询出错：' + esc(String(e.message || e)), 'err');
      }
    }, delay == null ? 800 : delay);
  }

  /* ============================ 开始任务 ============================ */
  async function startDownload() {
    const url = ($('exUrl').value || '').trim();
    if (!/^https?:\/\//i.test(url)) { note('请粘贴 http(s) 开头的下载直链。', 'warn'); return; }
    const dir = ($('exDirUrl').value || '').trim();
    /* ★ v10.73：游戏名 + 类别 ⇒ 服务端据此建 `游戏名_类别_原链名` 文件夹。
       两个都留空也能用（服务端会退回只用原链名），所以不做必填校验。 */
    const game = ($('exGame').value || '').trim();
    const cat = ($('exCat').value || '').trim();
    $('exGoUrl').disabled = true;
    note('正在建任务…');
    try {
      const r = await fetch(api('/api/extract/download'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, game, cat, dir: dir || undefined }),
      });
      const d = await r.json();
      if (!d.ok) { note('没能开始：' + esc(d.error || ('HTTP ' + r.status)), 'err'); $('exGoUrl').disabled = false; return; }
      st.taskId = d.id;
      st.lastTarget = { type: 'url', url, dir: d.dir };
      $('exReport').innerHTML = '';
      note('任务已建立，落点：' + esc(d.name || d.dir || '') + '，正在下载…');
      poll(d.id, 400);
    } catch (e) {
      note('请求失败：' + esc(String(e.message || e)), 'err');
    } finally {
      $('exGoUrl').disabled = false;
    }
  }

  async function scanDir() {
    const dir = ($('exDir').value || '').trim();
    $('exScanBtn').disabled = true;
    note('正在扫描…');
    try {
      const r = await fetch(api('/api/extract/scan'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir }),
      });
      const d = await r.json();
      if (!d.ok) { note('扫描失败：' + esc(d.error || ('HTTP ' + r.status)), 'err'); st.scan = null; renderScan(); return; }
      st.scan = d;
      st.lastTarget = { type: 'dir', dir: d.dir };
      renderScan();
      note(d.count ? ('扫到 ' + d.count + ' 个压缩包（按文件头识别，不看扩展名）。') : '该目录下没有认出压缩包。');
    } catch (e) {
      note('扫描请求失败：' + esc(String(e.message || e)), 'err');
    } finally {
      $('exScanBtn').disabled = false;
    }
  }

  async function runDir() {
    const dir = ($('exDir').value || '').trim();
    $('exRunBtn').disabled = true;
    note('正在建任务…');
    try {
      const r = await fetch(api('/api/extract/run'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir }),
      });
      const d = await r.json();
      if (!d.ok) { note('没能开始：' + esc(d.error || ('HTTP ' + r.status)), 'err'); return; }
      if (!d.id) { note(esc(d.note || '没有可解压的包。'), 'warn'); return; }
      st.taskId = d.id;
      st.lastTarget = { type: 'dir', dir };
      $('exReport').innerHTML = '';
      note('任务已建立，共 ' + d.count + ' 个压缩包。');
      poll(d.id, 400);
    } catch (e) {
      note('请求失败：' + esc(String(e.message || e)), 'err');
    } finally {
      $('exRunBtn').disabled = false;
    }
  }

  /* 「重新解压」：对上一次的目标再跑一遍。
   * ★ 这就是用户说的「提醒 + 再次解压」里那个「再次解压」的手动出口 ——
   *   自动递归已经覆盖绝大多数情况，但人工改动过目录后想再跑一次时要有入口。 */
  async function rerun() {
    if (!st.lastTarget) { note('还没有可重跑的目标。', 'warn'); return; }
    if (st.lastTarget.type === 'url') { $('exUrl').value = st.lastTarget.url; $('exDirUrl').value = st.lastTarget.dir || ''; setTab('url'); startDownload(); }
    else { $('exDir').value = st.lastTarget.dir; setTab('dir'); runDir(); }
  }

  /* ============================ 提交密码续跑 ============================ */
  async function submitPasswords() {
    if (!st.taskId) return;
    const inputs = Array.from(document.querySelectorAll('#exPwForm input[data-pw]'));
    const pws = inputs.map((i) => (i.value || '').trim()).filter(Boolean);
    if (!pws.length) { note('请至少填一个密码。', 'warn'); return; }
    $('exPwGo').disabled = true;
    note('正在用这些密码续跑…');
    try {
      const r = await fetch(api('/api/extract/password'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: st.taskId, passwords: pws }),
      });
      const d = await r.json();
      if (!d.ok) { note('提交失败：' + esc(d.error || ('HTTP ' + r.status)), 'err'); return; }
      note('已提交，正在续跑…');
      poll(st.taskId, 400);
    } catch (e) {
      note('请求失败：' + esc(String(e.message || e)), 'err');
    } finally {
      $('exPwGo').disabled = false;
    }
  }

  /* ============================ 渲染：扫描结果 ============================ */
  function renderScan() {
    const el = $('exScanRes');
    if (!st.scan) { el.innerHTML = ''; return; }
    const list = st.scan.items || [];
    if (!list.length) { el.innerHTML = '<div class="ex-empty">该目录下没有认出压缩包。<br><span>识别按<b>文件头</b>判断，不依赖扩展名。</span></div>'; return; }
    el.innerHTML =
      '<div class="ex-card">' +
        '<div class="ex-card-h"><b>目录里的压缩包</b><span class="n">' + list.length + ' 个</span>' +
          '<code class="p">' + esc(st.scan.dir) + '</code></div>' +
        '<div class="ex-scan-l">' + list.map((x) =>
          '<div class="ex-scan-it">' +
            '<span class="fmt">' + esc(FMT_TX[x.format] || x.format) + '</span>' +
            '<span class="nm" title="' + esc(x.file) + '">' + esc(x.name) + '</span>' +
            (x.isVolume ? '<span class="tag vol">分卷首卷</span>' : '') +
            '<span class="sz">' + fmtSize(x.size) + '</span>' +
          '</div>').join('') + '</div>' +
      '</div>';
  }

  /* ============================ 渲染：任务进度 ============================ */
  function renderTask() {
    const el = $('exTask');
    const t = st.task;
    if (!t) { el.innerHTML = ''; return; }
    const pct = Math.max(0, Math.min(100, t.progress || 0));
    const running = t.state === 'running';
    const stx = t.state === 'done' ? '已完成' : t.state === 'need-password' ? '等待密码'
      : t.state === 'error' ? '有失败'
      /* ★ v10.73 两个新终态 —— 不加这两条会掉进「进行中」，看着像卡住了 */
      : t.state === 'saved' ? '已保存（非压缩包）'
      : t.state === 'not-archive' ? '不是文件' : '进行中';
    el.innerHTML =
      '<div class="ex-card">' +
        '<div class="ex-card-h"><b>任务</b>' +
          '<span class="badge ' + esc(t.state) + '">' + esc(stx) + '</span>' +
          '<span class="ph">' + esc(PHASE_TX[t.phase] || t.phase || '') + '</span>' +
          (t.phase === 'download' && t.totalBytes ? '<span class="by">' + fmtSize(t.bytes) + ' / ' + fmtSize(t.totalBytes) + '</span>' : '') +
        '</div>' +
        '<div class="ex-bar"><i style="width:' + pct + '%"' + (running ? ' class="run"' : '') + '></i></div>' +
        '<div class="ex-ev">' + (t.events || []).slice(-40).map(evLine).join('') + '</div>' +
      '</div>';
  }

  function evLine(e) {
    const ic = { queued: '·', downloading: '↓', downloaded: '✓', layer: '▸', 'layer-ok': '✓',
      'layer-fail': '✕', 'need-password': '🔒', 'file-start': '▶', 'circuit-break': '⏹',
      'password-submitted': '⏳', 'password-ok': '✓', 'still-need-password': '🔒', error: '✕' }[e.type] || '·';
    /* ⚠️ 兜底是 e.type 原文 —— 漏映射的事件会把内部英文 token 直接漏到用户眼前
     *   （实测踩到：事件流第一行显示裸的 queued）。新增事件类型时必须在这里补一条。 */
    let tx = e.type;
    if (e.type === 'queued') tx = '任务已排队，等待空闲槽位';
    else if (e.type === 'downloading') tx = '开始下载 ' + String(e.url || '').slice(0, 60);
    else if (e.type === 'downloaded') tx = '下载完成 ' + e.file + '（' + fmtSize(e.size) + '）';
    else if (e.type === 'layer') tx = '第 ' + e.depth + ' 层 · 解压 ' + e.file + ' [' + (FMT_TX[e.format] || e.format) + ']';
    else if (e.type === 'layer-ok') tx = '第 ' + e.depth + ' 层 · 解开 ' + e.file + '，产出 ' + e.produced + ' 个';
    else if (e.type === 'layer-fail') tx = '第 ' + e.depth + ' 层 · 失败 ' + e.file + '：' + (e.err || '');
    else if (e.type === 'need-password') tx = '第 ' + e.depth + ' 层 · 需要密码：' + e.file;
    else if (e.type === 'file-start') tx = '(' + e.i + '/' + e.n + ') 处理 ' + e.file;
    else if (e.type === 'circuit-break') tx = e.reason;
    else if (e.type === 'password-submitted') tx = '已提交 ' + e.count + ' 个密码，续跑 ' + e.targets + ' 个包';
    else if (e.type === 'password-ok') tx = '密码有效，成功续跑 ' + e.count + ' 个包';
    else if (e.type === 'still-need-password') tx = '仍有 ' + e.count + ' 个包需要密码';
    else if (e.type === 'error') tx = '出错：' + (e.error || '');
    return '<div class="ex-ev-it ' + esc(e.type) + '"><i>' + ic + '</i><span>' + esc(tx) + '</span></div>';
  }

  /* ============================ 渲染：报告 ============================ */
  function renderReport(s, t) {
    const el = $('exReport');
    if (!s) { el.innerHTML = ''; return; }
    const layers = s.layers || [];
    const okN = layers.filter((L) => L.ok && !L.nothingNew).length;
    const newN = layers.filter((L) => L.nothingNew).length;
    const failN = (s.failures || []).length;
    const needN = (s.needsPassword || []).length;

    let html =
      '<div class="ex-card">' +
        '<div class="ex-card-h"><b>结果报告</b>' +
          '<code class="p">' + esc(s.destDir || '') + '</code></div>' +
        '<div class="ex-stats">' +
          stat(layers.length, '总层数' + (s.maxDepth ? ' / 上限 ' + s.maxDepth : '')) +
          stat(s.reachedDepth || 0, '最深嵌套', 'hi') +
          stat(okN, '解出内容', okN ? 'hi' : '') +
          stat(newN, '已存在（跳过）', newN ? 'mb' : '') +
          stat(needN, '待解密', needN ? 'mb' : '') +
          stat(failN, '失败', failN ? 'no' : '') +
          stat(s.files || 0, '最终文件') +
        '</div>';

    /* ---- 逐层明细 ---- */
    if (layers.length) {
      html += '<div class="ex-layers">' +
        '<div class="ex-sub">逐层明细</div>' +
        layers.map((L) =>
          '<div class="ex-layer ' + (L.ok ? (L.nothingNew ? 'skip' : 'ok') : 'bad') + '">' +
            '<span class="d">L' + L.depth + '</span>' +
            '<span class="nm" title="' + esc(L.name) + '">' + esc(L.name) + '</span>' +
            '<span class="fmt">' + esc(FMT_TX[L.format] || L.format || '') + '</span>' +
            '<span class="rs">' + (L.ok ? (L.nothingNew ? '已存在，跳过' : '产出 ' + L.produced + ' 个') :
              (L.needPassword ? '需要密码' : (L.skipReason === 'volume' ? '分卷不完整' : '失败'))) + '</span>' +
            '<span class="er">' + esc(L.err || '') + '</span>' +
          '</div>').join('') +
        '</div>';
    }

    /* ---- 待解密：每个包一个输入框 ---- */
    if (needN) {
      html += '<div class="ex-sub">需要解压密码</div>' +
        '<div class="ex-pw" id="exPwForm">' +
          (s.needsPassword || []).map((n, i) =>
            '<div class="ex-pw-it">' +
              '<span class="nm" title="' + esc(n.name) + '">' + esc(n.name) + '</span>' +
              '<span class="dp">第 ' + n.depth + ' 层</span>' +
              '<input type="text" data-pw="' + i + '" placeholder="解压密码（可留空跳过这个包）" autocomplete="off">' +
            '</div>').join('') +
          '<div class="ex-pw-bar">' +
            '<button class="ex-b primary" id="exPwGo">用这些密码继续解压</button>' +
            '<span class="hint">填了多个密码时会按顺序逐个尝试；留空的包会被跳过。</span>' +
          '</div>' +
        '</div>';
    }

    /* ---- 失败 ---- */
    if (failN) {
      html += '<div class="ex-sub">失败项</div>' +
        '<div class="ex-fails">' + (s.failures || []).slice(0, 30).map((f) =>
          '<div class="ex-fail"><span class="d">L' + f.depth + '</span>' +
          '<span class="nm">' + esc(String(f.file || '').split(/[\\/]/).pop()) + '</span>' +
          '<span class="er">' + esc(f.err || f.reason || '') + '</span></div>').join('') + '</div>';
    }

    /* ---- 跳过的（深度上限 / 分卷中间卷 / 非压缩包） ---- */
    const sk = (s.skipped || []).filter((x) => x.reason !== 'volume-part');
    if (sk.length) {
      html += '<details class="ex-fold"><summary>还有 ' + sk.length + ' 项被跳过（点开看原因）</summary>' +
        '<div class="ex-skip-l">' + sk.slice(0, 60).map((x) =>
          '<div class="ex-skip"><span class="nm">' + esc(String(x.file || '').split(/[\\/]/).pop()) + '</span>' +
          '<span class="rs">' + esc({ 'max-depth': '达到嵌套层数上限', 'not-archive': '不是压缩包', 'volume-part': '分卷的后续卷' }[x.reason] || x.reason) + '</span></div>').join('') +
        '</div></details>';
    }

    if (!layers.length && !failN && !needN) {
      html += '<div class="ex-empty">这次没有解开任何东西 —— 目标里可能本来就没有压缩包。</div>';
    }

    html += '<div class="ex-bar2"><button class="ex-b" id="exAgain">对上一次的目标重新解压</button>' +
      '<span class="hint">原压缩包按你的设定<b>保留不动</b>，所以重复解压是安全的（已存在的文件会跳过）。</span></div>';

    html += '</div>';
    el.innerHTML = html;

    const go = $('exPwGo');
    if (go) go.onclick = submitPasswords;
    const again = $('exAgain');
    if (again) again.onclick = rerun;
  }

  function stat(n, label, cls) {
    return '<div class="ex-s ' + (cls || '') + '"><b>' + n + '</b><span>' + esc(label) + '</span></div>';
  }

  /* ============================ 历史记录（v10.73） ============================
   * 用户原话：「解压助手保留日志以及路径」。
   * 服务端把每条任务的终态**落盘**到 `Downloads\GameHub\_下载历史.json` ——
   * 内存任务表只留 24 个、且服务一重启就没，而这个列表的价值恰恰在
   * 「重启之后才想起来要找那一次」。 */
  const ST_TX = { done: '已解压', saved: '已保存', 'not-archive': '不是文件',
    error: '失败', 'need-password': '待密码', running: '进行中' };

  async function loadHistory() {
    try {
      const d = await fetch(api('/api/extract/history?n=60')).then((r) => r.json());
      if (!d.ok) return;
      st.hist = d;
      renderHistory();
    } catch (e) { /* 历史是旁路信息，拉不到不许打断主流程 */ }
  }

  function tsx(ms) {
    if (!ms) return '—';
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function renderHistory() {
    const el = $('exHist');
    if (!el) return;
    const items = (st.hist && st.hist.items) || [];
    if (!items.length) {
      el.innerHTML = '<div class="ex-card"><div class="ex-card-h"><b>历史记录</b></div>' +
        '<div class="ex-hint">还没有记录。跑过一次下载 / 解压之后，这里会留下每次的<b>落点路径</b>，' +
        '重启服务也不会丢。</div></div>';
      return;
    }
    el.innerHTML = '<div class="ex-card">' +
      '<div class="ex-card-h"><b>历史记录</b>' +
      '<span class="n">最近 ' + items.length + ' 条 / 共 ' + (st.hist.total || items.length) + ' 条</span>' +
      '<span class="ph">' + esc(st.hist.file || '') + '</span></div>' +
      '<div class="ex-hist">' + items.map(histRow).join('') + '</div>' +
      '</div>';
    /* ★ 事件用 addEventListener 逐个挂，不用内联 onclick：路径里带反斜杠、
       引号、中文，内联拼字符串是自找注入与转义事故。 */
    el.querySelectorAll('button[data-hcopy]').forEach((b) => {
      b.onclick = () => copyPath(b.getAttribute('data-hcopy'));
    });
    el.querySelectorAll('button[data-hopen]').forEach((b) => {
      b.onclick = () => openDir(b.getAttribute('data-hopen'));
    });
  }

  function histRow(x) {
    const dir = x.dir || '';
    const name = dir ? dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : '';
    const bits = [];
    if (x.layers) bits.push(x.layers + ' 层');
    if (x.files) bits.push(x.files + ' 个文件');
    if (x.bytes) bits.push(fmtSize(x.bytes));
    if (x.sniffed) bits.push(String(x.sniffed).toUpperCase());
    return '<div class="ex-hist-it">' +
      '<div class="hd"><span class="badge ' + esc(x.state) + '">' + esc(ST_TX[x.state] || x.state) + '</span>' +
      '<b>' + esc(name || x.game || '（未命名）') + '</b>' +
      '<span class="tm">' + esc(tsx(x.at)) + '</span></div>' +
      (bits.length ? '<div class="mt">' + esc(bits.join(' · ')) + '</div>' : '') +
      '<div class="pt" title="' + esc(dir) + '">' + esc(dir || '（无路径）') + '</div>' +
      (x.error ? '<div class="er">' + esc(x.error) + '</div>' : '') +
      (dir ? '<div class="acts">' +
        '<button type="button" data-hcopy="' + esc(dir) + '">复制路径</button>' +
        '<button type="button" data-hopen="' + esc(dir) + '">打开文件夹</button></div>' : '') +
      '</div>';
  }

  /* 复制路径：★ 必须留这个出口 ——「打开文件夹」靠 explorer.exe，
   *   而它的退出码**不可靠**（常转交给已有实例后立刻退出），失败时用户得有别的办法。 */
  function copyPath(p) {
    if (!p) return;
    const done = () => note('已复制：' + p);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(p).then(done, () => fallbackCopy(p, done));
    } else fallbackCopy(p, done);
  }
  function fallbackCopy(text, done) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy');
      document.body.removeChild(ta); done();
    } catch (e) { note('复制失败，请手动复制：' + text, 'warn'); }
  }

  async function openDir(p) {
    try {
      const r = await fetch(api('/api/extract/open'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: p || undefined }),
      });
      const d = await r.json();
      if (!d.ok) note('打不开文件夹（' + (d.error || '未知原因') + '），请用「复制路径」', 'warn');
    } catch (e) { note('打不开文件夹，请用「复制路径」', 'warn'); }
  }

  /* ============================ 初始化 ============================ */
  window.initEx = function () {
    document.querySelectorAll('.ex-tab').forEach((b) => { b.onclick = () => setTab(b.dataset.m); });
    $('exGoUrl').onclick = startDownload;
    $('exScanBtn').onclick = scanDir;
    $('exRunBtn').onclick = runDir;
    $('exUrl').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') startDownload(); });
    $('exDir').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') scanDir(); });
    loadEnv();
    loadHistory();
  };
})();
