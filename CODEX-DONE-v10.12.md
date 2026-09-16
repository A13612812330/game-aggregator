# CODEX-DONE v10.12 —— 机型「转译」第四跳补齐（CPU 配置）+ 机型卡不可见的真 bug

> **上一版（v10.11）的遗留**：机型转译只做到「机型 → GPU → SoC」三跳，
> 用户要的是「**机型对应的 cpu 等配置**」—— 第四跳（SoC → CPU 核簇）挂着没做。
>
> **一句话结论**：v10.11 的 CPU 覆盖率是 **0%**。不是「没写功能」，是**数据源选错了**：
> 唯一来源 `device-board.json` 只有 200 条主板，对库内 66 个 SoC 只命中 1 个。
> 补上 `data/soc-cpu.json`（343 条）后覆盖率 **0% → 92.4%**。
> 顺带用浏览器实拍逮到一个**只有截图才能发现的真 bug**：机型信息卡一直是隐藏的。

---

## 一、CPU 覆盖率 0% → 92.4%

### 根因：数据源只有 200 条，却要覆盖 66 个 SoC

| 项 | 实测 |
|---|---|
| `device-board.json` 主板数 | **200**（来自 GitHub `xTheEc0/Android-Device-Hardware-Specs-Database`，文件本身只有 21KB） |
| 库内不同 SoC 数 | **66**（其中 50 个覆盖 951 台机型） |
| `device-board` 对库内 SoC 的命中 | **1 个** |
| 结果 | 有 SoC 无 CPU：**967 台**，CPU 覆盖率 **0.0%** |

### 新数据源：nanoreview SoC 详情页

`https://nanoreview.net/en/soc/<vendor>-<slug>` 正文里有一句固定的自我介绍，正好是我们要的核簇描述：

> It has **2 cores Oryon (Phoenix L) at 4320 MHz** and **6 cores Oryon (Phoenix M) at 3530 MHz**.

- 抓取方式沿用 v10.11 的结论：**必须 `execFileSync('curl')`**，node 的 fetch/https 一律 403（TLS/JA3 指纹差异）。
- URL 不是猜的：从已缓存的 `/en/soc-list/rating` 列表页里把 246 条 `href` 抠出来（`/en/soc/qualcomm-snapdragon-8-gen-4`），
  自己拼 `qualcomm-snapdragon-8-elite` 会 404。
- 礼貌间隔 1.2s，246 页共约 12 分钟，**246/246 成功 0 失败**。
- 新增 `tools/fetch-soc-cpu.js`（支持 `--offline` 用缓存重跑、`--all` 抓全表）。

### 顺带发现 `device-board` 有脏值

```
Google Tensor G4 (GS401) → 1x Cortex-X4 @ 31.GHz 3x Cortex-A720 @ 2.6GHz ...   ← 31.GHz 是错的
HiSilicon Kirin 659      → 4x Cortex-A54 @ 2.3GHz ...                          ← Cortex-A54 不存在
```

所以把优先级反过来：**soc-cpu.json 优先，device-board 降为兜底**。那条 `31.GHz` 随之消失（现为 `@3.1GHz`）。

---

## 二、句式归一化：`fmtCpu()`

两个来源句式完全不同，界面需要统一：

| 来源 | 原始句式 |
|---|---|
| nanoreview | `1 core Cortex-X925 at 3620 MHz, 3 cores Cortex-X4 at 3300 MHz, and 4 cores Cortex-A720 at 2400 MHz` |
| device-board | `1x Cortex-X925 @ 3.6GHz 3x Cortex-X4 @ 3.3GHz 4x Cortex-A720 @ 2.4GHz` |

统一压成：

```
1×Cortex-X925 @3.62GHz · 3×Cortex-X4 @3.3GHz · 4×Cortex-A720 @2.4GHz
```

实现见 `data/device-gpu.js` 的 `fmtCpu()` —— 一个全局正则扫出所有 `<n>(core|cores|x) <name> (@|at) <freq>` 片段再重组，
扫不到就原样返回（不硬造）。`-` / 空串安全返回空（不会吐出 `-GHz`）。

---

## 三、顺手修掉的三处**错配**（同一颗 GPU 被整个系列共用）

`Mali-G720` 被 Dimensity 8350 / 8400 / 8450 / 8500 / 9400e 共用，`socOf(gpu)` 只能取 nanoreview 排第一的那个。

| 机型 | 修前 | 修后 | 依据 |
|---|---|---|---|
| `TECNO LJ9 MT6897` | Dimensity 9400e ❌ | **Dimensity 8350** | soc-db 的 id 就是 `dimensity_8350_mt6897_mt6897z_bza_mt8792zna` |
| `2311DRK48G MT6897` | Dimensity 9400e ❌ | **Dimensity 8350** | 同上 |
| `Infinix X6833B MT6789` | Dimensity 1080 ❌ | **Helio G100** | 同上 |
| `Xiaomi 22101320G` | `SM7325`（裸编号） | **Snapdragon 778G** | soc-db 的 id 是 `snapdragon_sm7325`（没有市场名可抠），GPU 也反查不到（778G 的 GPU 在 nanoreview 记 `Adreno 642`，soc-db 写 `Adreno 642L`）→ 用 `chipMarket` 小表补 |
| `TB322FC SM8750P` | 查不到 | **Snapdragon 8 Elite (Gen 4)** | `chipSpec` 只查精确键，补上「基号键」兜底 `SM8750P → SM8750` |

新增的两个机制：

1. **`marketFromId()`** —— soc-db 的 `id` 里藏着的市场名（`dimensity_8350_…` → `Dimensity 8350`）。
   规则：按 `_` 切开 → 丢厂商前缀 → 累积令牌直到撞上芯片编号（`mt/sm/msm/sdm`+数字），
   要求至少 2 个令牌且含数字（否则 `snapdragon_sm8650` 会解析出光秃秃的 "Snapdragon"）。
2. **`upgradeSoc()`** —— 配对路径反查出来的名字若还是**裸编号**（`SM7325`），
   用 `device-alias.json` 的 `chipMarket` 升格成市场名，顺带拿到 GPU 与档位。

### 芯片编号反向挂载（自动化，不用手维护）

nanoreview 只按市场名索引，但社区库里的机型名常只写编号。
`tools/fetch-soc-cpu.js` 的 `attachChipCodes()` 借 soc-db 的 `id` 反向挂：`snapdragon_778g_sm7325_…` → 顺手登记 `sm7325`。
离线重跑一次，**附加 97 个编号键**（246 → 343 条）。

---

## 四、★ 真 bug：机型信息卡一直是隐藏的（截图才发现）

```
CSS:  .dm-info{display:none; ...}                    ← 「类规则」
JS:   info.style.display = '';                       ← 只清掉「内联」样式
                                                     → CSS 照样赢，卡永远不显示
```

旁边 `#dmResultSec` 用的是**内联** `style="display:none"`，`style.display = ''` 对它有效 ——
两行代码长得一模一样，一行对一行错，**看代码看不出来**，jsdom 也测不出来（jsdom 不算布局）。

**只有浏览器实拍能发现**：截图出来是 109 字节的白图（元素宽高为 0）。
修法：`info.style.display = 'block'`。

> 影响面：芯片 / GPU / 性能档 / CPU 这**四行全是这个卡里的** ——
> 也就是说 v10.11 做的机型转译，用户在界面上**一行都没看到**，只在接口里是对的。

---

## 五、验收

| 项 | 结果 |
|---|---|
| `手动: 机型转译覆盖率` | 机型 1,044 ｜ GPU **97.9%** ｜ SoC **92.7%** ｜ CPU **0% → 92.4%** |
| **新增** `tools/test-device-translate.js`（第 11 道防线） | ✅ **43 / 43** |
| **新增** `tools/preview-v1012.js`（浏览器实拍） | ✅ CPU 行渲染 **5/5**；桌面溢出 0px、窄屏 375 溢出 0px |
| 既有 9 个套件 | ✅ 575 / 575 |
| **合计** | ✅ **618 / 618** |
| 线上接口抽查 | `/api/device/match?model=小米15` ✅ 含 CPU ｜ `TECNO LJ9 MT6897` ✅ ｜ `Xiaomi 22101320G` ✅ |

实拍产物：`_preview/v1012-device-cpu.png`、`_preview/v1012-device-cpu-mobile.png`。

---

## 六、改动清单

**新增**

- `data/soc-cpu.json`（123KB，343 条 = 246 市场名 + 97 芯片编号别名）
- `tools/fetch-soc-cpu.js`（抓取 + 编号反挂；`--offline` / `--all`）
- `tools/test-device-translate.js`（第 11 道防线，43 项）
- `tools/preview-v1012.js`（浏览器实拍 + 溢出检测）

**修改**

| 文件 | 改了什么 |
|---|---|
| `data/device-gpu.js` | 新增 `SOCCPU` 加载、`socCpuMap`、`socCpuOf()`、`fmtCpu()`、`marketFromId()`、`upgradeSoc()`、`chipMarketMap`；`cpuOf()` 改为「soc-cpu 优先 → device-board 兜底」并统一走 `fmtCpu`；`chipSpec()` 补基号键兜底；`chipIdx`/`nameIdx` 记录补 `id`/`model` 字段 |
| `data/device-match.js` | `deviceList` 输出补 `cpu` 字段（原来只透传了 `soc`） |
| `data/device-alias.json` | 新增 `chipMarket`（`sm7325` → Snapdragon 778G、`sm8635` → Snapdragon 8s Gen 3） |
| `tools/emulator-sections.js` | ★ `info.style.display = 'block'`（修不可见 bug）；更新过时注释 |
| `public/index.html` | `.dm-info-cpu` 的 flex 子项补 `min-width:0` + `align-items:flex-start`（否则长串不换行） |
| `public/emulator.html` | 由 `tools/build-emulator-page.js` 重新生成同步 |

---

## 七、遗留（如实记录）

1. **剩 3 台机型**（SDM429w / G3x Gen 2 / G1 Gen 2）nanoreview 未收录 → 显示「未收录」，不编造。
   nanoreview 全表只有 246 个 SoC，且偏重手机；掌机芯片（G3x/G1）确实没有。
2. **联网兜底仍未做**：抓取是一次性的（产物落盘），运行时全离线。
   终端用户输入一个表外机型时不会现抓（会走别名表 / 芯片编号路径）。
3. **`soc-db` 的 `arch`/`year` 字段不可信**（把 SM8750 标成 ARMv8.2-A / 2021，实际是 2024 的 ARMv9 Oryon），
   本次只用了它的 `id`（提市场名）与 GPU，没有采信 arch/year。
4. 别名表与 chipMarket 仍是人工维护（154 + 2 条），加行即可。
5. `fmtCpu()` 依赖正则句式；nanoreview 若改文案会静默退化成「原样输出」（有测试兜底：6 条句式用例）。
