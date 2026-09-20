/* 反证：把启动器三件套逐个打坏，tools/test-launcher.js 的对应断言必须变红。
 *
 * 为什么必须做：断言全绿也可能是**假绿**（护栏写歪、或根本没走到被守护的分支，照样打印 ✓）。
 * 判据只有一个：把被守护的行为**故意打坏**，对应断言必须变红。
 *
 * 五个打坏点各代表一族：
 *   ① .cmd 的 node 回退重新写死版本号   （本次真 bug 的形态：版本漂移 ⇒ 静默失效）
 *   ② .vbs 里塞中文注释                （编码族：VBScript 按 ANSI 解析源文件）
 *   ③ .url 指向旧域名                  （链接漂移族：漏改一处）
 *   ④ .cmd 端口正则删掉尾随空格        （误匹配族：`:8123` 会命中 `:81230`）
 *   ⑤ .cmd 换行被刷成 LF               （换行族：工具改写后的静默形态）
 *
 * 每个坏点**独立**打坏 → 跑 → 还原，避免互相干扰。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SUITE = path.join(__dirname, 'test-launcher.js');

const CASES = [
  {
    label: '\u2460 .cmd 的 node 回退重新写死版本号（本次真 bug 的形态）',
    file: '\u542f\u52a8\u805a\u5408\u7ad9.cmd',
    break: (s) => s.replace(/set "VBASE=[^"]*"/, 'set "VBASE=%USERPROFILE%\\.workbuddy\\binaries\\node\\versions\\22.22.2-3"'),
    need: ['\u2605 .cmd \u91cc**\u6ca1\u6709**\u786c\u7f16\u7801\u7248\u672c\u76ee\u5f55'],
  },
  {
    label: '\u2461 .vbs 里塞中文注释（VBScript 按 ANSI 解析源文件）',
    file: '\u542f\u52a8\u805a\u5408\u7ad9-\u9759\u9ed8.vbs',
    break: (s) => "' \u8fd9\u662f\u4e00\u884c\u4e2d\u6587\u6ce8\u91ca\n" + s,
    need: ['\u2605 .vbs \u6e90\u7801\u7eaf ASCII'],
  },
  {
    label: '\u2462 .url \u6307\u5411\u65e7\u57df\u540d（\u94fe\u63a5\u6f02\u79fb\uff1a\u6f0f\u6539\u4e00\u5904）',
    file: '\u6253\u5f00\u7ebf\u4e0a\u7248.url',
    break: (s) => s.replace(/^URL=.+$/m, 'URL=https://gamehub-agg-v3.app.workbuddy.host/'),
    need: ['\u2605 \u300c\u6253\u5f00\u7ebf\u4e0a\u7248.url\u300d== report.js \u7684 LIVE'],
  },
  {
    label: '\u2463 .cmd \u7aef\u53e3\u6b63\u5219\u5220\u6389\u5c3e\u968f\u7a7a\u683c（`:8123` \u4f1a\u547d\u4e2d `:81230`）',
    file: '\u542f\u52a8\u805a\u5408\u7ad9.cmd',
    break: (s) => s.replace('":%PORT% .*LISTENING"', '":%PORT%.*LISTENING"'),
    need: ['\u2605 .cmd \u63a2\u6d4b\u5360\u7528\uff1a\u7aef\u53e3\u6b63\u5219**\u5e26\u5c3e\u968f\u7a7a\u683c**'],
  },
  {
    label: '\u2464 .cmd \u6362\u884c\u88ab\u5237\u6210 LF\uff08\u5de5\u5177\u6539\u5199\u540e\u7684\u9759\u9ed8\u5f62\u6001\uff09',
    file: '\u542f\u52a8\u805a\u5408\u7ad9.cmd',
    break: (s) => s.replace(/\r\n/g, '\n'),
    need: ['\u2605 .cmd \u6362\u884c\u662f CRLF'],
  },
];

let bad = 0;
for (const c of CASES) {
  const p = path.join(ROOT, c.file);
  const orig = fs.readFileSync(p, 'utf8');
  const broken = c.break(orig);
  if (broken === orig) { console.log('\u274c ' + c.label + ' —— 打坏点没生效（锚点变了？）'); bad++; continue; }

  let out = '';
  try {
    fs.writeFileSync(p, broken);
    console.log('\u25b6 ' + c.label);
    try {
      out = execFileSync(process.execPath, [SUITE], { encoding: 'utf8', timeout: 120000 });
    } catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
  } finally {
    fs.writeFileSync(p, orig);
  }

  const fails = out.split('\n').filter((l) => l.indexOf('\u2717 FAIL') >= 0).map((l) => l.trim());
  const sum = (out.match(/\u901a\u8fc7 \d+ \/ \d+/) || ['(\u65e0\u6c47\u603b)'])[0];

  console.log('   ' + sum + '   \u53d8\u7ea2 ' + fails.length + ' \u6761');
  const missed = c.need.filter((n) => !fails.some((l) => l.indexOf(n.replace(/^\u2605 /, '')) >= 0));
  if (missed.length) {
    console.log('   \u274c \u53cd\u8bc1\u4e0d\u5145\u5206 —— \u8fd9\u4e9b\u65ad\u8a00\u6253\u574f\u540e**\u6ca1\u53d8\u7ea2**\uff08\u5047\u7eff\uff09\uff1a');
    missed.forEach((m) => console.log('      ' + m));
    bad++;
  } else {
    console.log('   \u2705 \u5bf9\u5e94\u65ad\u8a00\u5df2\u53d8\u7ea2');
  }
  console.log('');
}

/* 还原后必须复跑一次全绿，否则「还原」本身可能是假的 */
let out2 = '';
try { out2 = execFileSync(process.execPath, [SUITE], { encoding: 'utf8', timeout: 120000 }); }
catch (e) { out2 = String(e.stdout || '') + String(e.stderr || ''); }
const sum2 = (out2.match(/\u901a\u8fc7 \d+ \/ \d+/) || ['(\u65e0\u6c47\u603b)'])[0];
console.log('\u25c0 \u5168\u90e8\u8fd8\u539f\u540e\u590d\u8dd1\uff1a' + sum2);
if (!/^通过 (\d+) \/ \1$/.test(sum2)) { console.log('\u274c \u8fd8\u539f\u540e\u672a\u5168\u7eff —— \u8bf4\u660e\u8fd8\u539f\u4e0d\u5e72\u51c0'); bad++; }

if (bad) { console.log('\n\u274c \u53cd\u8bc1\u5931\u8d25 ' + bad + ' \u9879'); process.exit(1); }
console.log('\n\u2705 \u53cd\u8bc1\u6210\u7acb\uff1a' + CASES.length + ' \u4e2a\u6253\u574f\u70b9\u5404\u81ea\u5bf9\u5e94\u7684\u65ad\u8a00\u90fd\u53d8\u7ea2\uff0c\u4e14\u96f6\u5047\u7eff\u3002');
