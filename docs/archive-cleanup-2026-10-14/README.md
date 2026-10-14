# 归档：2026-10-14 清理 1.1 GB 归档 / 测试 / 预览产物

> **这不是「删了就算」。** 删掉的东西里，能进仓库的「知识」**全部在这里**；
> 进不去的（1.06 GB 二进制）**逐文件有 SHA256 清单**，且每一项都有「可重建」的来源依据。
>
> 触发：2026-10-14 盘点时项目目录 **1880.6 MB**，而**真正的业务数据只有 `data/` 的 133 MB**
> —— 也就是说 93% 的空间花在了「跑一次就能再生成」的东西上。用户拍板：**清理并备份到 GitHub**。

---

## 一、GitHub 装不下 1.1 GB —— 这是必须先说清的技术边界

| 约束 | 实测值 |
|---|---|
| 本仓库当前体积 | **49,140 KB**（`gh api repos/A13612812330/game-aggregator --jq .size`） |
| GitHub 单文件硬上限 | **100 MB** |
| 仓库 >1 GB | 官方警告线 |

⇒ **不能承诺「把 1.1 GB 备份到 GitHub」**。硬推的后果不是失败，而是**污染**：
Git blob 永久留在历史里、`git clone` 从此永远很慢，而且**删掉也治不好**。

所以这里做的是**分层备份**：

| 层 | 内容 | 去哪 |
|---|---|---|
| ① 凭证层 | 全部 **3196 个**文件的 路径 / 大小 / mtime / **SHA256** | `manifest.json`（756 KB）→ **入 GitHub** |
| ② 知识层 | **1330 个**文本文件（脚本 / 报告 / md / 日志 / 还原说明），60.68 MB | `text-assets.tar.gz`（18.3 MB）→ **入 GitHub** |
| ③ 大二进制 | **1866 个**（profile 缓存 / 截图 / `.bin` 抓取样本），1063.74 MB | **不入库**，本地清理（依据见下） |

**为什么大二进制敢不入库**：它们不是「资料」，是「可重跑的中间产物」——
`.gitignore` 自己分好的类，`_archived/cache-purge-20260920/README.md` 又逐项写明「全部可重建」。
换句话说，**要恢复它们不需要备份，只需要重跑。**

---

## 二、清理范围（6 项 / 3196 文件 / 1124.42 MB）

| 目录 | 文件 | 体积 | 依据 |
|---|---|---|---|
| `_archived/cache-purge-20260920/` | 1450 | **448.3 MB** | 该目录自己的 `README.md`：「**这不是删除，是移动**……全部可重建」，并给出删除命令。其中 421.1 MB 是**已死的 Edge profile**（现行代码一律用 `chrome-preview`） |
| `_test-out/` | 996 | 307.2 MB | `.gitignore:47`「临时工作目录……可重跑」 |
| `_preview/` | 529 | 239.2 MB | `.gitignore:41`「本地验收产物（浏览器实拍截图），体积大」 |
| `_bak/` | 56 | 79.0 MB | `.gitignore:19`「本地备份」；内容已在 git 历史里 |
| `_verify/` | 15 | 32.5 MB | `.gitignore:56`「纯排查产物、可随时重建」 |
| `_probe2/` | 150 | 18.2 MB | `.gitignore:93`「纯排查产物，重跑的脚本都在里面」 |

### ★ 刻意**保留**的部分（没有一刀切）

- **`_archived/` 只清了 `cache-purge-20260920/`**，其余全部保留 ——
  因为 `CODEX-TASKS.md:421` 与 `tools/_build-deploy-payload.js:6` 都写着
  「不要动 `_archived/`（用户资产）」。删掉整个 `_archived/` 会把这条约定连同
  **`v1/` 四页快照、`CODEX-INDEX-v10.41.md`、`README-v10.41-版本块全量.md`、`WORKFLOW-v10.38-duplicated.md`** 一起抹了。
- **`_preview/` 留了 5 张 v10.73 验收截图** → `screenshots/`（1.31 MB）：
  `v1073-site-127.0.0.1.png` / `v1073-extract-127.0.0.1.png` / `v1073-click-done.png` /
  以及两张 `.162` 局域网实拍。**这是 v10.73「一个按钮走完下载+解压」的交付证据，不是可重跑的中间态。**

### 删除前做过的一次引用检查（避免文档裂图）

```
grep -rnE '!\[[^]]*\]\((\./)?_(preview|archived|test-out|bak|verify|probe2)/' --include=*.md .   → 空
grep -rnE '(src|href)="(\./)?_(preview|archived|test-out|bak|verify|probe2)/' --include=*.html  → 空
```

⇒ **项目内没有任何 md 图片引用或 HTML 资源引用指向这些目录**，删除不会让文档出现死图。

---

## 三、怎么用这里的备份

**查「某个文件删之前长什么样、多大、内容哈希」**：

```bash
node -e "
const m=require('./docs/archive-cleanup-2026-10-14/manifest.json');
const hit=m.files.filter(f=>f.path.includes(process.argv[1]));
for(const f of hit) console.log(f.size, f.sha256, f.path);
" 关键词
```

**取回文本资产**（1330 个文件，60.68 MB）：

```bash
cd "E:/新建文件夹/WorkBuddy/2026-09-03-16-11-58/game-aggregator/docs/archive-cleanup-2026-10-14"
tar -xzf text-assets.tar.gz          # 解出 _text-stage/，保持原始相对路径
# 例：_text-stage/_probe2/_byrut-cookie.txt  →  对应原来的 _probe2/_byrut-cookie.txt
```

**恢复缓存归档（448 MB）**：不需要恢复 —— 按 `_archived/cache-purge-20260920/README.md` 的重建路径走即可
（两个 profile 下次跑 `tools/browser.js` 会自动重新拉取；首次启动略慢，**无功能影响**）。

**重跑各类测试产物**：

```bash
node tools/run-all.js                 # 全量静态防线（产出 *_test-out/）
node tools/_build-deploy-payload.js   # 重建发布载荷
```

---

## 四、这次的账

| 项 | 清理前 | 清理后 |
|---|---|---|
| 项目目录总占用 | **1880.6 MB** | 预计 **约 760 MB**（-1117 MB / -59%） |
| 其中业务数据 `data/` | 133 MB | 133 MB（**未动**） |
| 入 GitHub 的归档 | — | manifest 0.74 MB + 文本包 18.3 MB + 截图 1.3 MB = **20.3 MB** |

> ⚠️ 有一项**同时被清理和入库**，别搞混：`_archived/cache-purge-20260920/README.md`
> 是那份「可重建」的**依据文档**，它既在 `manifest.json` 里被登记，也在 `text-assets.tar.gz` 里存了一份。
> 依据没了，下次就没人知道这 448 MB 能不能删了。

---

## 五、一句话总结

**真正的资料早就该在 `data/`（133 MB）和 git 里；这 1.1 GB 是「跑出来的烟」，不是「存下来的钱」。**
这次做的不是删数据，是把「烟」的**配方（文本 + 清单）**留下，把烟散掉。
