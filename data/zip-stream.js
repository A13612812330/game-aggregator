/**
 * data/zip-stream.js — 零依赖「流式 ZIP 打包」（v10.94）
 *
 * ── 为什么不用 archiver / adm-zip（2026-10-21）────────────────────────────
 * ① 发布载荷**故意不含 node_modules**（沙箱按 package.json 自己 install），
 *    多一个依赖就多一次「装不上就整站起不来」的失败面；
 * ② 云下载的文件本身就是已压缩的游戏包（BT 分卷），再 deflate 一遍只烧 CPU
 *    不省体积 ⇒ **store（method 0）** 才是正确选择，Node 内置能力足够；
 * ③ 单文件与总量都可能 > 4 GB（任务上限 30 GB）⇒ 必须 ZIP64，而
 *    `archiver` 的 zip64 行为依赖底层库版本，自己写反而可控。
 *
 * ── 关键设计（每条都是踩过的坑）────────────────────────────────────────
 * · **一遍流式**：CRC32 必须边读边算。若先算 CRC 再写正文 = 磁盘读两遍，
 *   30 GB 要读 60 GB。所以 local header 置 **bit 3（data descriptor）**，
 *   size/crc 先写 0，正文写完后紧跟 descriptor 补真实值。
 * · **local header 用 version 45 + UTF-8 flag（bit 11）**：中文文件名不标 UTF-8
 *   到 Windows 上会变乱码（「星露谷物语」→「æ˜Ÿ...」）。
 * · **central directory 一律带 ZIP64 extra（0x0001）**：即使当前文件 < 4 GB，
 *   统一写 extra 比「按大小分支」少一半路径；解析器对两者都认。
 * · 遇到客户端断开必须**立即停读**：否则一个「点了下载又取消」的用户会让服务器
 *   白读几十 GB（`res.destroyed` 检查 + 监听 close）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

/* ── CRC32（标准多项式 0xEDB88320，查表法）── */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32Update(crc, buf) {
  let c = crc ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xFF];
  return (c ^ -1) >>> 0;
}

/* ── DOS 时间（ZIP 用 1980 起算）── */
function dosStamp(d) {
  const dt = d instanceof Date && !isNaN(d.getTime()) ? d : new Date();
  const year = Math.max(1980, dt.getFullYear());
  return {
    time: ((dt.getHours() & 31) << 11) | ((dt.getMinutes() & 63) << 5) | ((dt.getSeconds() / 2) & 31),
    date: (((year - 1980) & 127) << 9) | (((dt.getMonth() + 1) & 15) << 5) | (dt.getDate() & 31),
  };
}

/** 写一块并尊重背压；客户端已断开时抛错（让调用方立刻停止读盘）。 */
function writeChunk(res, buf) {
  return new Promise((resolve, reject) => {
    if (res.destroyed || res.writableEnded) return reject(new Error('client-closed'));
    let ok = false;
    try {
      ok = res.write(buf);
    } catch (e) {
      return reject(e);
    }
    if (ok) return resolve();
    const onDrain = () => { cleanup(); resolve(); };
    const onClose = () => { cleanup(); reject(new Error('client-closed')); };
    const cleanup = () => {
      res.removeListener('drain', onDrain);
      res.removeListener('close', onClose);
    };
    res.once('drain', onDrain);
    res.once('close', onClose);
  });
}

function localHeader(nameBuf, dos) {
  const b = Buffer.alloc(30);
  b.writeUInt32LE(0x04034b50, 0);   // signature
  b.writeUInt16LE(45, 4);           // version needed (ZIP64)
  b.writeUInt16LE(0x0808, 6);       // bit3 data descriptor + bit11 UTF-8
  b.writeUInt16LE(0, 8);            // method 0 = store
  b.writeUInt16LE(dos.time & 0xFFFF, 10);
  b.writeUInt16LE(dos.date & 0xFFFF, 12);
  b.writeUInt32LE(0, 14);           // crc32（descriptor 里补）
  b.writeUInt32LE(0, 18);           // compressed size
  b.writeUInt32LE(0, 22);           // uncompressed size
  b.writeUInt16LE(nameBuf.length, 26);
  b.writeUInt16LE(0, 28);           // extra len（local 不需要 ZIP64 extra）
  return Buffer.concat([b, nameBuf]);
}

function dataDescriptor(crc, size) {
  const b = Buffer.alloc(24);
  b.writeUInt32LE(0x08074b50, 0);   // 可选签名
  b.writeUInt32LE(crc >>> 0, 4);
  b.writeBigUInt64LE(BigInt(size), 8);
  b.writeBigUInt64LE(BigInt(size), 16);
  return b;
}

function centralEntry(e) {
  const nameBuf = e.nameBuf;
  /* ZIP64 extra：uncompressed(8) + compressed(8) + local header offset(8) */
  const extra = Buffer.alloc(28);
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(24, 2);
  extra.writeBigUInt64LE(BigInt(e.size), 4);
  extra.writeBigUInt64LE(BigInt(e.size), 12);
  extra.writeBigUInt64LE(BigInt(e.offset), 20);

  const b = Buffer.alloc(46);
  b.writeUInt32LE(0x02014b50, 0);
  b.writeUInt16LE(45, 4);           // version made by
  b.writeUInt16LE(45, 6);           // version needed
  b.writeUInt16LE(0x0808, 8);       // 同 local：descriptor + UTF-8
  b.writeUInt16LE(0, 10);
  b.writeUInt16LE(e.dos.time & 0xFFFF, 12);
  b.writeUInt16LE(e.dos.date & 0xFFFF, 14);
  b.writeUInt32LE(e.crc >>> 0, 16);
  b.writeUInt32LE(0xFFFFFFFF, 20);  // csize → extra
  b.writeUInt32LE(0xFFFFFFFF, 24);  // usize → extra
  b.writeUInt16LE(nameBuf.length, 28);
  b.writeUInt16LE(extra.length, 30);
  b.writeUInt16LE(0, 32);           // comment
  b.writeUInt16LE(0, 34);           // disk start
  b.writeUInt16LE(0, 36);           // internal attrs
  b.writeUInt32LE(0, 38);           // external attrs
  b.writeUInt32LE(0xFFFFFFFF, 42);  // offset → extra
  return Buffer.concat([b, nameBuf, extra]);
}

function zip64End(count, cdSize, cdOffset) {
  const rec = Buffer.alloc(56);
  rec.writeUInt32LE(0x06064b50, 0);
  rec.writeBigUInt64LE(44n, 4);     // size of remaining record
  rec.writeUInt16LE(45, 12);
  rec.writeUInt16LE(45, 14);
  rec.writeUInt32LE(0, 16);         // this disk
  rec.writeUInt32LE(0, 20);         // disk with CD
  rec.writeBigUInt64LE(BigInt(count), 24);
  rec.writeBigUInt64LE(BigInt(count), 32);
  rec.writeBigUInt64LE(BigInt(cdSize), 40);
  rec.writeBigUInt64LE(BigInt(cdOffset), 48);

  const loc = Buffer.alloc(20);
  loc.writeUInt32LE(0x07064b50, 0);
  loc.writeUInt32LE(0, 4);
  loc.writeBigUInt64LE(BigInt(cdOffset + cdSize), 8);  // zip64 EOCD 位置
  loc.writeUInt32LE(1, 16);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(0xFFFF, 8);
  eocd.writeUInt16LE(0xFFFF, 10);
  eocd.writeUInt32LE(0xFFFFFFFF, 12);
  eocd.writeUInt32LE(0xFFFFFFFF, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([rec, loc, eocd]);
}

/** ZIP 内文件名：只留 basename，并去掉路径分隔符（防 zip-slip）。 */
function safeName(p) {
  return String(p || '').replace(/\\/g, '/').split('/').pop() || 'file';
}

/**
 * 把一批文件流式写成一个 ZIP 到 `res`。
 * @param {object} res  Express 响应（已是 200 + attachment 头）
 * @param {Array<{abs:string,name?:string,size?:number,mtime?:Date}>} files
 * @param {{onAbort?:Function}} opts
 * @returns {Promise<{ok:boolean,files:number,bytes:number,error?:string}>}
 */
async function pipeZip(res, files, opts) {
  const o = opts || {};
  const list = (files || []).filter((f) => f && f.abs);
  const entries = [];
  let offset = 0;
  let totalBytes = 0;
  let aborted = false;

  const onClose = () => { aborted = true; };
  res.once('close', onClose);

  try {
    for (const f of list) {
      if (aborted) break;
      let st;
      try { st = fs.statSync(f.abs); } catch (e) { continue; }   // 文件被清掉就跳过，不让整包失败
      if (!st.isFile()) continue;
      const name = safeName(f.name || f.abs);
      const nameBuf = Buffer.from(name, 'utf8');
      const dos = dosStamp(f.mtime || st.mtime);

      const lh = localHeader(nameBuf, dos);
      await writeChunk(res, lh);
      const eOffset = offset;
      offset += lh.length;

      let crc = 0;
      let size = 0;
      const stream = fs.createReadStream(f.abs, { highWaterMark: 1 << 20 });
      for await (const chunk of stream) {
        if (aborted) { stream.destroy(); break; }
        crc = crc32Update(crc, chunk);
        size += chunk.length;
        await writeChunk(res, chunk);
        offset += chunk.length;
      }
      if (aborted) break;

      const dd = dataDescriptor(crc, size);
      await writeChunk(res, dd);
      offset += dd.length;
      totalBytes += size;

      entries.push({ nameBuf, dos, crc, size, offset: eOffset });
    }

    if (aborted) return { ok: false, files: entries.length, bytes: totalBytes, error: 'client-closed' };

    /* central directory */
    const cdOffset = offset;
    let cdSize = 0;
    for (const e of entries) {
      const buf = centralEntry(e);
      await writeChunk(res, buf);
      cdSize += buf.length;
    }
    await writeChunk(res, zip64End(entries.length, cdSize, cdOffset));
    res.end();
    return { ok: true, files: entries.length, bytes: totalBytes };
  } catch (err) {
    if (o.onAbort) { try { o.onAbort(err); } catch (_) { /* 回调失败不影响收尾 */ } }
    if (!res.destroyed) { try { res.destroy(); } catch (_) { /* 已关闭 */ } }
    return { ok: false, files: entries.length, bytes: totalBytes, error: (err && err.message) || 'unknown' };
  } finally {
    res.removeListener('close', onClose);
  }
}

module.exports = { pipeZip, crc32Update, safeName, dosStamp };
