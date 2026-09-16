/**
 * gpu-tier.js — GPU / 芯片性能层级表
 *
 * 用途：「选机型 → 能跑哪些游戏」的推断依据。
 * 核心逻辑：若某游戏被 A 性能档的 GPU 跑过，则性能 ≥ A 的 GPU 也都算「可跑」（向下兼容）。
 *
 * tier 数值越大性能越强（相对序，非绝对跑分）。数据来源：
 *   - Adreno 序：按 Qualcomm 官方型号代际 + 社区实测（骁龙 8 Elite > 8 Gen 3 > 8 Gen 2 > ...）
 *   - Mali 序：按 Arm 官方代号（G52 < G57 < G68 < G76 < G77 < G78 < G610 < G615 < G710 < G715 < G720）
 * 注：这是「相对序」，用于可跑性推断足够；不做绝对性能承诺。
 */

/** 归一化 GPU 名：去厂商前缀、TM、噪声，统一大小写与空格 */
function normGpu(s) {
  let t = String(s == null ? '' : s).trim();
  if (!t) return '';
  t = t
    .replace(/ANGLE\s*/gi, '')
    .replace(/\s*on\s+Vulkan[\s\S]*$/i, '')
    .replace(/\(TM\)|\(R\)|™|®/gi, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t;
}

/**
 * 家族识别 + 基础型号抽取。
 * 返回 {fam, num, suffix} —— num 是系列号（Adreno 740 → 740；Mali G57 MC2 → 57，mc=2）
 */
function parseGpu(raw) {
  const t = normGpu(raw);
  if (!t) return null;
  const low = t.toLowerCase();

  // Adreno 数字 或 A8xx 代号（8Elite 原生驱动名）
  let m = low.match(/adreno\s*(\d{3})/);
  if (m) return { fam: 'adreno', num: +m[1], mc: 0, raw: t };

  // 裸 SM 编号（如 SM8650）→ 视为芯片，交给 chip 表
  m = low.match(/^sm\s*(\d{4})$/);
  if (m) return { fam: 'soc', num: +m[1], mc: 0, raw: t };

  // Mali-Gxx [MCn]
  m = low.match(/mali\s*-?\s*g\s*(\d{2,3})(?:\s*mc\s*(\d+))?/);
  if (m) return { fam: 'mali', num: +m[1], mc: m[2] ? +m[2] : 1, raw: t };

  // Immortalis-Gxxx / Immortalis MCxx（可能不带 G 型号）
  m = low.match(/immortalis[\s-]*(?:g)?\s*(\d{2,3})?(?:\s*mc\s*(\d+))?/);
  if (m && low.includes('immortalis')) {
    const num = m[1] ? +m[1] : 910;   // 无型号时按 900 系处理
    return { fam: 'mali', num: 1000 + num, mc: m[2] ? +m[2] : 1, raw: t };
  }

  // PowerVR Rogue GE / B-Series
  m = low.match(/powervr\s*(?:rogue\s*)?(\w+[\w-]*)/);
  if (m) return { fam: 'powervr', num: 0, mc: 0, raw: t, key: m[1] };

  // Xclipse（三星）
  m = low.match(/xclipse\s*(\d{3})/);
  if (m) return { fam: 'xclipse', num: +m[1], mc: 0, raw: t };

  return { fam: 'other', num: 0, mc: 0, raw: t };
}

/* ── Adreno 相对性能档（数字即档位，越大越强） ──
   特殊标注：
     610 < 612 < 615 < 616 < 618 < 619 < 620 < 630 < 640 < 642L < 643 < 644 < 650 < 660
     < 680 < 690 < 695 < 702 < 710 < 720 < 722 < 725 < 730 < 732 < 735 < 740 < 750
     < 810 < 825 < 829 < 830 < 840
   注：642L 比 642 略低，用小数处理。 */
const ADRENO_ADJ = {
  '642L': -0.5,
  'A8xx': 0,
  22: -300, // Adreno 22（老设备）
};

/* ── Mali 相对档：映射到与 Adreno 同一量纲（约 280–820） ──
   参照锚点（社区实测共识）：
     Mali-G52 MC2 ≈ Adreno 610 区间   → ~300
     Mali-G57 MC2 ≈ Adreno 618 区间   → ~330
     Mali-G68 MC4 ≈ Adreno 619 区间   → ~370
     Mali-G76      ≈ Adreno 640 区间  → ~420
     Mali-G77/G78  ≈ Adreno 650 区间  → ~470
     Mali-G610 MC6 ≈ Adreno 660 区间  → ~520
     Mali-G615 MC6 ≈ Adreno 720 区间  → ~600
     Mali-G715/G720 MC7 ≈ Adreno 730–735 → ~660
     Immortalis MC11/MC12 ≈ Adreno 750 → ~750
   MC 数（核心数）做小幅加成，封顶避免反超高端 Adreno。 */
function maliTier(num, mc) {
  const base = num >= 1000 ? num - 1000 : num; // Immortalis-G715 → 715
  let s;
  if (base < 52) s = 250;              // G31 等超入门
  else if (base < 57) s = 300;         // G52
  else if (base < 68) s = 330;         // G57
  else if (base < 76) s = 370;         // G68
  else if (base < 77) s = 420;         // G76
  else if (base < 78) s = 460;         // G77
  else if (base < 310) s = 490;        // G78
  else if (base < 510) s = 500;        // G310
  else if (base < 610) s = 510;        // G510
  else if (base < 615) s = 520;        // G610
  else if (base < 710) s = 600;        // G615
  else if (base < 715) s = 630;        // G710
  else if (base < 720) s = 650;        // G715
  else if (base < 910) s = 660;        // G720
  else s = 750;                        // Immortalis 900 系
  // MC 核心数加成：每核 +4，封顶 +60（避免 G720 MC12 反超 8 Gen 3）
  s += Math.min(Math.max((mc || 1) - 1, 0) * 4, 60);
  return Math.min(s, 780);
}

/**
 * 计算 GPU 的可比较性能分。
 * 跨家族统一到同一量纲：Adreno 数字 ≈ 直接可用；Mali 经 maliTier 映射到相近量纲。
 * 返回值：{ score, fam, num, label }
 */
function gpuScore(raw) {
  const p = parseGpu(raw);
  if (!p) return null;
  if (p.fam === 'adreno') {
    let s = p.num + (ADRENO_ADJ[p.num] || 0);
    return { score: s, fam: 'adreno', num: p.num, label: p.raw };
  }
  if (p.fam === 'mali') {
    const s = maliTier(p.num, p.mc);
    return { score: s, fam: 'mali', num: p.num, label: p.raw };
  }
  if (p.fam === 'xclipse') {
    // Xclipse 540 ≈ Adreno 730 级；920/940 更高
    const map = { 540: 730, 530: 660, 920: 810, 940: 830 };
    return { score: map[p.num] || 600, fam: 'xclipse', num: p.num, label: p.raw };
  }
  if (p.fam === 'powervr') {
    // PowerVR 入门段，普遍弱于 Adreno 610
    const base = /ge8(\d{4})/.exec(p.key || '');
    return { score: base ? 300 : 280, fam: 'powervr', num: 0, label: p.raw };
  }
  if (p.fam === 'soc') {
    return { score: socScoreFromSm(p.num), fam: 'soc', num: p.num, label: p.raw };
  }
  return { score: 400, fam: 'other', num: 0, label: p.raw };
}

/* ── 骁龙芯片（SM 编号）→ 近似 GPU 档位 ── */
const SM_GPU = {
  8750: 830, // 8 Elite
  8650: 750, // 8 Gen 3
  8550: 740, // 8 Gen 2
  8450: 730, // 8+ Gen 1
  8475: 730,
  8400: 730, // 8 Gen 1
  7350: 720, // 7+ Gen 3
  7550: 720,
  7450: 710, // 7 Gen 1
  7325: 710,
  6375: 642, // 6 Gen 1 / 4 Gen 1
  6225: 619,
  6115: 619,
  6853: 610,
  6833: 610,
  6650: 640,
  7150: 660,
  8150: 640,
  8250: 650,
};
function socScoreFromSm(num) {
  return SM_GPU[num] || 600;
}

/* ── 芯片层级：把实测库的芯片代号映射到近似 GPU 档 ── */
const CHIP_TIER = {
  '870': { gpu: 650, label: '骁龙 870', gen: 2021 },
  '8gen1': { gpu: 730, label: '骁龙 8 Gen 1', gen: 2021 },
  '8egn1': { gpu: 730, label: '骁龙 8 Gen 1', gen: 2021 },
  '8gen2': { gpu: 740, label: '骁龙 8 Gen 2', gen: 2022 },
  '8gen3': { gpu: 750, label: '骁龙 8 Gen 3', gen: 2023 },
  '8e': { gpu: 830, label: '骁龙 8 Elite', gen: 2024 },
  '8e5': { gpu: 840, label: '骁龙 8 Elite Gen 5', gen: 2025 },
  '888': { gpu: 660, label: '骁龙 888', gen: 2020 },
  '865': { gpu: 650, label: '骁龙 865', gen: 2020 },
  '855': { gpu: 640, label: '骁龙 855', gen: 2019 },
  '7gen3': { gpu: 720, label: '骁龙 7+ Gen 3', gen: 2024 },
  '778': { gpu: 642, label: '骁龙 778G', gen: 2021 },
  '695': { gpu: 619, label: '骁龙 695', gen: 2021 },
  '680': { gpu: 610, label: '骁龙 680', gen: 2021 },
};

/** 芯片代号 → 性能档 */
function chipScore(code) {
  const k = String(code == null ? '' : code).toLowerCase().replace(/[\s_-]/g, '');
  if (CHIP_TIER[k]) return { ...CHIP_TIER[k], key: k };
  // 宽容匹配：包含关系
  for (const [key, v] of Object.entries(CHIP_TIER)) {
    if (k.includes(key)) return { ...v, key };
  }
  return null;
}

/** 可跑判定：target 性能 ≥ required 性能 即视为可跑（向下兼容） */
function playableAt(targetScore, requiredScore) {
  if (targetScore == null || requiredScore == null) return null;
  const d = targetScore - requiredScore;
  if (d >= 40) return 'smooth';   // 明显更强
  if (d >= 0) return 'ok';        // 达到
  if (d >= -25) return 'maybe';   // 略低于，可能勉强
  return 'no';
}

module.exports = {
  normGpu,
  parseGpu,
  gpuScore,
  chipScore,
  playableAt,
  CHIP_TIER,
  SM_GPU,
};
