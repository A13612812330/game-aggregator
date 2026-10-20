'use strict';
/**
 * 管理员账号（v10.91）
 *
 * 用户口径：「为什么要令牌，不如直接给我一个管理员账号」。
 * 令牌的问题不是不能鉴权，而是**不好记、不好查、填错只会得到一张空表**——
 * 本质上它是个「一次性长得像乱码的密码」，还要求用户手工保管。
 *
 * 设计取舍：
 *   · 账号密码走**服务端校验**，明文密码不出现在 public/ 任何文件里
 *     （如果做成前端硬编码对比，任何人 View Source 就能拿到密码）。
 *   · 落盘只存 scrypt(pass, salt) + salt，**明文不落盘**；文件与 admin-token.json 同级，
 *     在 .gitignore 里（仓库里不带凭据）。
 *   · 账号真源双通道：env（GAMEHUB_ADMIN_USER + GAMEHUB_ADMIN_PASS） > data/admin-account.json。
 *     env 的存在是为了让「部署时给一次、不写盘」成为可能。
 *   · 令牌通道**保留**（这是有意的，不是遗留）：抓取脚本 / verify-online / 各测试套件
 *     都在用它做无头鉴权，砍掉会把一批防线一起弄坏。账号是给人用的，令牌是给程序用的。
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'admin-account.json');
const DEFAULT_USER = 'liyou';
const KEYLEN = 32;

/** scrypt 派生的口令哈希（hex）。salt 每次随机 16 字节。 */
function hashOf(pass, salt) {
  return crypto.scryptSync(String(pass), String(salt), KEYLEN).toString('hex');
}
/** 定长比较：长度不同直接 false（timingSafeEqual 对长度不等会抛异常）。 */
function safeEq(a, b) {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return j && typeof j === 'object' ? j : null;
  } catch (e) {
    return null;
  }
}

/**
 * 当前生效的账号。返回 null ⇒ 完全没配置（登录一律 401，并给出配置提示）。
 * ★ 每次调用现读文件 / 现读 env：改密码不用重启（与 adminToken 同一取舍）。
 */
function current() {
  const envU = process.env.GAMEHUB_ADMIN_USER;
  const envP = process.env.GAMEHUB_ADMIN_PASS;
  if (envU && envP) {
    return {
      user: String(envU),
      source: 'env',
      updatedAt: null,
      check: (u, p) => safeEq(u, String(envU)) && safeEq(p, String(envP)),
    };
  }
  const j = load();
  if (!j || !j.user || !j.hash || !j.salt) return null;
  return {
    user: String(j.user),
    source: 'file',
    updatedAt: j.updatedAt || null,
    check: (u, p) => safeEq(u, String(j.user)) && safeEq(hashOf(p, String(j.salt)), String(j.hash)),
  };
}

/** 校验用户名 + 密码。用户名为空 / 密码为空一律 false（不区分「哪个错了」——防枚举）。 */
function check(user, pass) {
  const u = String(user == null ? '' : user).trim();
  const p = String(pass == null ? '' : pass);
  if (!u || !p) return false;
  const a = current();
  if (!a) return false;
  return !!a.check(u, p);
}

/** 写账号文件（仅供 CLI `tools/set-admin-account.js` 与测试使用）。原子写。 */
function setPassword(user, pass) {
  const u = String(user || DEFAULT_USER).trim();
  const p = String(pass || '');
  if (!u) throw new Error('用户名不能为空');
  if (p.length < 6) throw new Error('密码至少 6 位');
  const salt = crypto.randomBytes(16).toString('hex');
  const j = {
    user: u,
    salt,
    hash: hashOf(p, salt),
    alg: 'scrypt-N16384-r8-p1-keylen32',
    updatedAt: Date.now(),
    note: '管理员账号：只存派生值，明文不落盘。改密码用 node tools/set-admin-account.js <user> <pass>',
  };
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(j, null, 2) + '\n');
  fs.renameSync(tmp, FILE);
  return { user: j.user, file: FILE, updatedAt: j.updatedAt };
}

/** 状态摘要（不回传 hash/salt）。给设置页与自证用。 */
function stats() {
  const a = current();
  return {
    configured: !!a,
    user: a ? a.user : null,
    source: a ? a.source : null,
    updatedAt: a ? a.updatedAt : null,
    file: fs.existsSync(FILE) ? 'data/admin-account.json' : null,
  };
}

module.exports = { check, setPassword, stats, current, hashOf, FILE, DEFAULT_USER };
