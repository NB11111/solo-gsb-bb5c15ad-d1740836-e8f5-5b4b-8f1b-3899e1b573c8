/**
 * 色觉安全校验核心算法
 *
 * 流水线：
 *   sRGB HEX ──去伽马──▶ 线性 sRGB ──CVD 矩阵──▶ 模拟后的线性 RGB
 *      ──裁剪到 [0,1]──▶ gamma 编码 sRGB（用于并排显示）
 *                        └──▶ Lab ──▶ CIEDE2000（ΔE00）
 *
 * 模拟矩阵采用 Machado, Oliveira & Fernandes (2009)
 * "A Physiologically-based Model for Simulation of Color Vision Deficiency",
 * IEEE TVCG —— 在“线性 sRGB”空间中定义的二色视觉矩阵。
 * 色弱（异常三色视觉）通过 单位矩阵 I 与 二色矩阵 D 之间线性插值得到：
 *      M(s) = (1 - s) · I + s · D,   s ∈ [0, 1]
 */

import {
  parse,
  converter,
  formatHex,
  differenceCiede2000,
} from 'culori';

const toLrgb = converter('lrgb');
const toRgb = converter('rgb');
const toLab = converter('lab');
const de2000 = differenceCiede2000();

export const MODES = [
  { id: 'normal', label: '正常色觉', short: '正常' },
  { id: 'protan', label: '红色弱（Protanomaly）', short: '红弱' },
  { id: 'deutan', label: '绿色弱（Deuteranomaly）', short: '绿弱' },
  { id: 'tritan', label: '蓝色弱（Tritanomaly）', short: '蓝弱' },
];

/* Machado et al. 2009，强度 1.0（二色视觉）的线性 RGB 矩阵 */
const DICHROMACY_MATRICES = {
  // 红色盲 / 红弱极端
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  // 绿色盲 / 绿弱极端
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  // 蓝色盲 / 蓝弱极端
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

const IDENTITY = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** 线性插值得到给定强度的模拟矩阵；normal 恒为单位矩阵 */
export function cvdMatrix(mode, severity = 0.6) {
  if (mode === 'normal') return IDENTITY.map((row) => [...row]);
  const d = DICHROMACY_MATRICES[mode];
  if (!d) throw new Error(`未知模拟模式: ${mode}`);
  const s = Math.min(1, Math.max(0, severity));
  return d.map((row, r) => row.map((v, c) => (1 - s) * IDENTITY[r][c] + s * v));
}

const matCache = new Map();
function matrixFor(mode, severity) {
  const key = `${mode}@${severity}`;
  let m = matCache.get(key);
  if (!m) {
    m = cvdMatrix(mode, severity);
    matCache.set(key, m);
  }
  return m;
}

function applyMatrix([r, g, b], m) {
  return [
    m[0][0] * r + m[0][1] * g + m[0][2] * b,
    m[1][0] * r + m[1][1] * g + m[1][2] * b,
    m[2][0] * r + m[2][1] * g + m[2][2] * b,
  ];
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function normalizeHex(input) {
  const s = String(input).trim();
  // 裸十六进制（1–8 位）补 #；hsl()/rgb() 等 CSS 函数写法原样交给 culori
  const css = /^[a-z]+\(/i.test(s) || s.startsWith('#') ? s : `#${s}`;
  const parsed = parse(css);
  if (!parsed) throw new Error(`无法解析颜色: ${input}`);
  return formatHex(parsed);
}

/**
 * 模拟单个颜色。
 * 返回 { hex, simHex, lab }，其中 lab 由“裁剪后的模拟线性 RGB”计算。
 */
export function simulateColor(hex, mode = 'normal', severity = 0.6) {
  const norm = normalizeHex(hex);
  const lr0 = toLrgb(norm);
  const v0 = [lr0.r, lr0.g, lr0.b];
  const v1 = applyMatrix(v0, matrixFor(mode, severity)).map(clamp01);
  const lr1 = { mode: 'lrgb', r: v1[0], g: v1[1], b: v1[2] };
  return {
    hex: norm,
    simHex: formatHex(toRgb(lr1)),
    lab: toLab(lr1),
  };
}

/** 两个颜色（Lab）之间的 CIEDE2000 距离 */
export function deltaE(labA, labB) {
  return de2000(labA, labB);
}

function combinations(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) out.push([i, j]);
  }
  return out;
}

/**
 * 校验整组调色板。
 * @param {string[]} colors      2–8 个十六进制颜色
 * @param {string[]} modeIds     参与校验的模式
 * @param {number}   threshold   ΔE00 达标阈值
 * @param {number}   severity    色弱强度 0–1
 */
export function analyzePalette({ colors, modeIds, threshold, severity = 0.6 }) {
  const hexes = colors.map(normalizeHex);
  if (hexes.length < 2 || hexes.length > 8) {
    throw new Error('调色板需要 2–8 个颜色');
  }
  const ids = modeIds && modeIds.length ? modeIds : ['normal'];
  for (const id of ids) {
    if (!MODES.some((m) => m.id === id)) throw new Error(`未知模式: ${id}`);
  }

  // 每种模式下，每个色板位置的模拟结果
  const sims = {};
  for (const id of ids) {
    sims[id] = hexes.map((h) => simulateColor(h, id, severity));
  }

  const pairs = combinations(hexes.length).map(([i, j]) => {
    const deltas = {};
    for (const id of ids) {
      deltas[id] = deltaE(sims[id][i].lab, sims[id][j].lab);
    }
    // 最差模式：距离最小的模式；距离相等时按 MODES 顺序保持确定性
    let minMode = ids[0];
    for (const id of ids) {
      if (deltas[id] < deltas[minMode]) minMode = id;
    }
    const min = deltas[minMode];
    return {
      i,
      j,
      colors: [hexes[i], hexes[j]],
      deltas,
      min,
      minMode,
      pass: min >= threshold,
    };
  });

  const modes = ids.map((id) => {
    let worstPair = pairs[0];
    for (const p of pairs) {
      if (p.deltas[id] < worstPair.deltas[id]) worstPair = p;
    }
    const minDeltaE = worstPair.deltas[id];
    return {
      id,
      label: MODES.find((m) => m.id === id).label,
      short: MODES.find((m) => m.id === id).short,
      minDeltaE,
      worstPair: [worstPair.i, worstPair.j],
      pass: minDeltaE >= threshold,
    };
  });

  let worstMode = modes[0];
  for (const m of modes) if (m.minDeltaE < worstMode.minDeltaE) worstMode = m;

  return {
    colors: hexes,
    threshold,
    severity,
    modes,
    pairs,
    simulations: Object.fromEntries(
      Object.entries(sims).map(([id, arr]) => [id, arr.map((s) => s.simHex)]),
    ),
    worstMode: worstMode.id,
    overallPass: pairs.every((p) => p.pass),
  };
}

/**
 * 内置候选网格：HSL 等角度/等亮度网格 + 中性灰轴。
 */
export function buildCandidateGrid() {
  const hues = Array.from({ length: 36 }, (_, k) => k * 10);
  const sats = [0.35, 0.5, 0.65, 0.8];
  const lights = [0.25, 0.35, 0.45, 0.55, 0.65, 0.75];
  const out = [];
  for (const h of hues) {
    for (const s of sats) {
      for (const l of lights) {
        out.push(normalizeHex(`hsl(${h}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`));
      }
    }
  }
  // 中性轴（s=0）
  for (const l of [0.1, 0.25, 0.4, 0.6, 0.75, 0.9]) {
    out.push(normalizeHex(`hsl(0, 0%, ${Math.round(l * 100)}%)`));
  }
  return [...new Set(out)];
}

/**
 * 为“待替换色”推荐候选：锁定其余颜色，取跨模式最小 ΔE00 最大者；
 * 平局时取与原色 ΔE00（Lab）改变量更小者。
 *
 * @param targetIndex 待替换色下标
 * @param limit       返回前 N 名
 */
export function recommendReplacement({
  colors,
  modeIds,
  threshold,
  severity = 0.6,
  targetIndex,
  grid = buildCandidateGrid(),
  limit = 12,
}) {
  const hexes = colors.map(normalizeHex);
  if (targetIndex < 0 || targetIndex >= hexes.length) {
    throw new Error('待替换色下标越界');
  }
  const ids = modeIds && modeIds.length ? modeIds : ['normal'];
  const lockedIdx = hexes.map((_, i) => i).filter((i) => i !== targetIndex);

  // 锁定色在各模式下的模拟 Lab（保持不变）
  const lockedLabs = {};
  for (const id of ids) {
    lockedLabs[id] = lockedIdx.map((i) => simulateColor(hexes[i], id, severity).lab);
  }
  const originLab = toLab(hexes[targetIndex]);

  const scored = grid.map((cand) => {
    // 跨模式 × 所有锁定色 的最小距离
    let score = Infinity;
    let worstMode = ids[0];
    for (const id of ids) {
      const candLab = simulateColor(cand, id, severity).lab;
      for (const lab of lockedLabs[id]) {
        const d = de2000(candLab, lab);
        if (d < score) {
          score = d;
          worstMode = id;
        }
      }
    }
    const change = de2000(toLab(cand), originLab);
    return { hex: cand, score, worstMode, change, pass: score >= threshold };
  });

  // 包含原色作为参照行（改变量 0）
  scored.push({
    hex: hexes[targetIndex],
    score: -1,
    worstMode: null,
    change: 0,
    original: true,
    pass: false,
  });

  scored.sort((a, b) => {
    // 参照行始终排到最前，方便对比
    if (a.original) return -1;
    if (b.original) return 1;
    if (b.score !== a.score) return b.score - a.score; // 最小距离更大者优先
    if (a.change !== b.change) return a.change - b.change; // 平局：改变量更小者
    return a.hex < b.hex ? -1 : 1;
  });

  return {
    targetIndex,
    targetColor: hexes[targetIndex],
    threshold,
    locked: lockedIdx.map((i) => hexes[i]),
    best: scored[1],
    candidates: scored.slice(0, limit + 1),
  };
}
