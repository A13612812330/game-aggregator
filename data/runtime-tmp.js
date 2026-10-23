'use strict';
/**
 * 临时目录归一（v10.109，2026-10-23 用户口径）
 *
 * 用户原话：「后续的 Temp 不要在 C 盘，在项目下的文件夹即可」。
 *
 * 【为什么要有这个文件】
 *   2026-10-23 一次部署直接报 `ENOSPC`：C 盘 **0 字节可用**（120GB 全满）。
 *   当场量到两块可回收的临时产物 —— `%TEMP%\.net` 1.05GB、
 *   上一次失败部署残留的 `%TEMP%\site-bundle.tar.gz` 190MB。
 *   而项目工作区在 E 盘（当时现测 603GB 可用）。
 *   ⇒ 项目自己产生的临时文件没有任何理由写在已经装满的 C 盘上。
 *
 * 【做法】
 *   在 require 三方库**之前**，把 TEMP / TMP / TMPDIR 三个变量指到 `<项目>/_tmp/`。
 *     · Node 的 `os.tmpdir()` 每次调用都读环境变量 ⇒ 赋值后立即生效，无需重启
 *     · `child_process.spawn` 默认继承父进程 env ⇒ aria2 / 7z / 刷新脚本一起走
 *
 * 【边界（不要越界）】
 *   · 只改**本进程树**的环境变量，不动系统设置 —— 退出后 `%TEMP%` 仍是原值
 *   · 不改用户机器的任何全局配置，也不需要管理员权限
 *   · `_tmp/` 已在 .gitignore 里，不会被提交
 *
 * ⚠️ 谁不需要改：`tools/` 下的**一次性探针**。它们在 .gitignore 的 `tools/_*` 规则里，
 *   本身就不入库、跑完即弃，落系统 Temp 也不影响仓库。真正要守的是**长驻进程**
 *   （server.js）与它 spawn 出来的子进程 —— 那才是会把盘写满的那一类。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '_tmp');

let ok = true;
let err = null;
try {
  fs.mkdirSync(ROOT, { recursive: true });
} catch (e) {
  ok = false;
  err = e && e.message;
}

if (ok) {
  process.env.TEMP = ROOT;
  process.env.TMP = ROOT;
  process.env.TMPDIR = ROOT;
}

/** 当前生效的临时目录（供 /api/admin/env 与环境自检展示，别处不要另算一份） */
function info() {
  return { dir: ROOT, applied: ok, err };
}

module.exports = { info, ROOT };
