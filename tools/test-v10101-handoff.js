/* v10.101 本机工具交接（Komo Convert）—— 磁力点击的三级回退
 *
 * 【用户口径】「点击后磁力下载判断是否有安装我的那个磁力下载工具；
 *   没有则拉起下载，有则用我的工具下」。
 *
 * 【这份套件守什么】浏览器**无法**真正判断协议有没有注册（没有任何 API），
 *   所以这段代码的本质是「试 + 用失焦反推」。能被自动化守住的只有四件事：
 *     ① 唤起方式：iframe 静默加载，不用 location.href（未注册时后者会留下跳转失败）；
 *     ② 判断窗口：2.2 秒，且失焦 / 页面隐藏两条信号都接；
 *     ③ 分流顺序：先 handoff，**失败才**落回云下载 —— 两条路不能同时走；
 *     ④ 非桌面端直接跳过，不让手机用户白等 2.2 秒。
 *   「真的把工具拉起来了」只能人工验（本机已实测：handoff.log 记到 len=85 / len=80，
 *     第二次触发进程数仍为 1）。**自动化不假装能测那一段。**
 *
 * 运行：node tools/test-v10101-handoff.js
 * 前置：服务已在 8123/8124 运行
 */
const { JSDOM, VirtualConsole } = require('jsdom');

const BASE = process.env.BASE || 'http://127.0.0.1:8124';
const results = [];
const ok = (n, c, extra) => { results.push([c, n, extra || '']); return c; };

const nativeFetch = globalThis.fetch;

function nvc() {
  const vc = new VirtualConsole();
  const errs = [];
  vc.on('jsdomError', (e) => {
    const m = String(e.message || e);
    /* 协议 iframe 在 jsdom 里必然「无法加载」——这是被测行为本身，不是错误。 */
    if (/Could not load|Not implemented|navigation/i.test(m)) return;
    errs.push(m);
    console.error('[jsdom]', m);
  });
  return { vc, errs };
}

/** desktop=true 时给 matchMedia 打桩成「鼠标设备」，否则 jsdom 本来就没有 matchMedia，
 *  正好对应 KC_DESKTOP 的兜底分支（手机 / 老浏览器）。 */
async function makeDom(desktop) {
  const url = BASE + '/';
  const html = await fetch(url).then((r) => r.text());
  const { vc, errs } = nvc();
  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      const raw = w.fetch;
      w.fetch = function (u, o) {
        const real = raw || nativeFetch;
        return real.call(w, String(u).startsWith('http') ? String(u) : BASE + u, o);
      };
      w.scrollTo = () => {};
      w.Element.prototype.scrollIntoView = function () {};
      w.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
      if (desktop) {
        w.matchMedia = (q) => ({ matches: true, media: q, addListener() {}, removeListener() {} });
      }
    },
  });
  await new Promise((r) => setTimeout(r, 1800));
  return { dom, errs };
}

async function main() {
  const { dom, errs } = await makeDom(true);
  const w = dom.window;

  ok('页面运行无 JS 异常', errs.length === 0, errs[0] || '');

  /* ============ 一、常量与入口齐备 ============ */
  ok('★ KC_SCHEME 指向 komoconvert://add?uri=',
    w.eval('KC_SCHEME') === 'komoconvert://add?uri=', w.eval('KC_SCHEME'));
  ok('★ kcLaunch / kcTryHandoff 都已定义',
    w.eval('typeof kcLaunch') === 'function' && w.eval('typeof kcTryHandoff') === 'function',
    `kcLaunch=${w.eval('typeof kcLaunch')} kcTryHandoff=${w.eval('typeof kcTryHandoff')}`);
  ok('桌面设备被识别为 true（KC_DESKTOP 打桩生效）', w.eval('KC_DESKTOP') === true,
    String(w.eval('KC_DESKTOP')));
  ok('等待窗口是 2200ms（1.8s 会把冷启动判成没装）', w.eval('KC_WAIT_MS') === 2200,
    String(w.eval('KC_WAIT_MS')));

  /* ============ 二、唤起方式：iframe 而非 location.href ============ */
  {
    const js = w.eval('kcLaunch.toString()');
    ok('★★ 用隐藏 iframe 加载协议（未注册时页面不动，href 会留下跳转失败）',
      /fr\.src = KC_SCHEME/.test(js) && /display = 'none'/.test(js));
    ok('★★ 反向：没有用 location.href 触发协议',
      !/location\.href\s*=/.test(js),
      (/location\.href\s*=.*/.exec(js) || [''])[0]);
    ok('★ iframe 用完被移出 DOM（不留隐形节点堆积）',
      /fr\.remove\(\)/.test(js));
  }

  /* ============ 三、失焦判断：两个信号都要接 ============ */
  {
    const js = w.eval('kcLaunch.toString()');
    ok('★★ 接 blur（外部程序抢前台）',
      /addEventListener\('blur'/.test(js));
    ok('★★ 接 visibilitychange（切标签/最小化也能判出来）',
      /addEventListener\('visibilitychange'/.test(js) && /document\.hidden/.test(js));
    ok('★ 判定后清理监听器与定时器（否则连点会残留 N 组回调）',
      /removeEventListener\('blur'/.test(js) && /removeEventListener\('visibilitychange'/.test(js)
      && /clearTimeout\(timer\)/.test(js));
  }

  /* ============ 四、运行时：blur → true；无反应 → 2.2s 后 false ============ */
  {
    const r1 = await w.eval(`(async () => {
      const p = kcLaunch('magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567');
      setTimeout(() => window.dispatchEvent(new Event('blur')), 120);
      return await p;
    })()`);
    ok('★★ 失焦 → 判为「已唤起」', r1 === true, String(r1));

    const t0 = Date.now();
    const r2 = await w.eval(`(async () => {
      return await kcLaunch('magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567');
    })()`);
    const ms = Date.now() - t0;
    ok('★★ 全程无反应 → 超时后判为「没唤起来」', r2 === false, String(r2));
    ok('★ 超时耗时落在 2.2s 附近（不是立刻失败，也不是死等）', ms >= 2100 && ms < 4500, `${ms} ms`);
  }

  /* ============ 五、分流顺序：先 handoff，失败才落回云下载 ============ */
  {
    const idx = await fetch(BASE + '/').then((r) => r.text());
    ok('★★ 点击处理器：handoff 成功即 return，不继续开云下载',
      /if \(await kcTryHandoff\(a\.dataset\.fgMagnet[^)]*\)\) return;/.test(idx));
    ok('★★ 正向锚点：handoff 失败后仍调用 fgcOpen（兜底那条路还在）',
      /if \(await kcTryHandoff\(a\.dataset\.fgMagnet[^)]*\)\) return;[\s\S]{0,160}fgcOpen\(/.test(idx));
    ok('★★ 反向：handoff 判断排在 fgcOpen **之前**（先开后补等于每次都白开一次弹窗）',
      idx.indexOf('if (await kcTryHandoff(a.dataset.fgMagnet') <
      idx.indexOf("fgcOpen(a.dataset.fgMagnet, a.dataset.fgTitle || '');"));
    ok('★ 取不到磁力就不拦（直接回落原流程）', /if \(!magnet\) return false;/.test(idx));
    ok('★★ 非桌面端直接返回 false（手机上不白等 2.2 秒）',
      /if \(!KC_DESKTOP \|\| !slug\) return false;/.test(idx));
  }

  /* ============ 六、兜底：云下载加载态给出安装入口 ============ */
  {
    const idx = await fetch(BASE + '/').then((r) => r.text());
    ok('★ 云下载加载态里出现 Komo Convert 安装包入口（没装的人有出口）',
      /KC_SETUP/.test(idx) && /\/dl\/KomoConvert-Setup-lite-/.test(idx),
      (/KC_SETUP = '([^']+)'/.exec(idx) || [])[1] || '');
    ok('★★ 安装包走**同域静态目录**，不是私有仓库的 Release（私有仓库资产对访客 404）',
      !/github\.com\/[^']*\/releases\/latest/.test(idx));
    ok('★ 安装入口带 download 属性（点了直接存文件，不在浏览器里打开 zip）',
      /href="' \+ KC_SETUP \+[\s\S]{0,80}download/.test(idx));
    ok('★ 原有「⧉ 复制磁力」仍在（无论判断对错，最后总能手动粘）',
      /if \(s\.magnet\) a\.push\(btn\('copy'/.test(idx));
  }

  /* ============ 七、非桌面端：整条 handoff 直接短路 ============ */
  {
    const { dom: mob, errs: mobErrs } = await makeDom(false);
    ok('移动端页面无 JS 异常', mobErrs.length === 0, mobErrs[0] || '');
    ok('★ 非桌面端 KC_DESKTOP=false', mob.window.eval('KC_DESKTOP') === false,
      String(mob.window.eval('KC_DESKTOP')));
    const falsey = await mob.window.eval(`kcTryHandoff('any-slug')`);
    ok('★★ 非桌面端 kcTryHandoff 立刻返回 false（不发请求、不等待）', falsey === false, String(falsey));
    mob.window.close();
  }

  dom.window.close();

  /* ---- 汇总 ---- */
  const pass = results.filter((r) => r[0]).length;
  const fail = results.length - pass;
  for (const [c, n, e] of results) {
    if (!c) console.log(`❌ ${n}${e ? '  ← ' + e : ''}`);
  }
  console.log(`\nv10.101 本机工具交接：通过 ${pass} / ${results.length}，失败 ${fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
