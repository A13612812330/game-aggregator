#!/usr/bin/env node
'use strict';
/**
 * 设置 / 修改管理员账号（v10.91）
 *
 *   node tools/set-admin-account.js                 # 看当前账号状态（不打印口令）
 *   node tools/set-admin-account.js liyou Ly123321  # 设置用户名与密码
 *
 * ★ 改密码后**不用重启**：server.js 每次登录现读 data/admin-account.json。
 * ★ 已登录的会话不受影响（会话在内存里，按需 `POST /api/admin/logout` 或等 30 天过期）。
 *   —— 这是有意的：改密码不应该把正在用的人踢掉，但也意味着「改密码 ≠ 强制下线」。
 */
const path = require('path');
const acc = require(path.join(__dirname, '..', 'data', 'admin-account'));

const user = process.argv[2];
const pass = process.argv[3];

if (!user && !pass) {
  const s = acc.stats();
  console.log('管理员账号状态');
  console.log('  已配置 : ' + (s.configured ? '是' : '否（登录一律 401）'));
  console.log('  用户名 : ' + (s.user || '—'));
  console.log('  来源   : ' + (s.source === 'env' ? '环境变量 GAMEHUB_ADMIN_USER/PASS（文件被忽略）' : s.source === 'file' ? 'data/admin-account.json' : '—'));
  console.log('  更新时间: ' + (s.updatedAt ? new Date(s.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '—'));
  console.log('');
  console.log('改账号：node tools/set-admin-account.js <用户名> <密码>');
  process.exit(0);
}

try {
  const r = acc.setPassword(user, pass);
  console.log('已写入 ' + r.file);
  console.log('  用户名 : ' + r.user);
  console.log('  密码   : （已用 scrypt 派生，明文不落盘）');
  console.log('  ⇒ 线上部署需重新发布载荷，或把同名文件放进部署目录的 data/ 下。');
} catch (e) {
  console.error('失败：' + e.message);
  process.exit(1);
}
