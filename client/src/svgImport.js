/**
 * SVG 图例导入 —— 纯浏览器本地解析（文件内容不离开浏览器，不上传服务器）
 *
 * 能力：
 *   - parseSvgText：用 DOMParser 解析 SVG 文本，非法文档抛出明确错误；
 *   - extractSvgColors：遍历图形元素的 fill / stroke 表现属性与内联 style 属性，
 *     仅提取纯色值（HEX、rgb()/rgba()、hsl()/hsla()，兼容 CSS Color 4 空格语法）；
 *     none、currentColor、url() 涂料引用、命名色等一律忽略；
 *   - 等价颜色归一化为 #rrggbb 并按文档首次出现顺序去重，
 *     带透明度的颜色按“合成到白底”的视觉效果归一化；
 *   - buildModifiedSvg：按调色板当前色值同步改写每个颜色的全部引用，
 *     属性引用直接 setAttribute，style 内引用只替换对应声明、保留其余声明。
 */
import { parse, converter } from 'culori';

const toRgb = converter('rgb');

export const MAX_SVG_COLORS = 8;
export const MAX_SVG_BYTES = 2 * 1024 * 1024; // 2 MB

const PAINT_PROPS = ['fill', 'stroke'];
export const PROP_LABELS = { fill: '填充', stroke: '描边' };

// 文本元素（text/tspan/title/desc/metadata）不作为图形元素扫描其用色，
// 避免把图例标签的文字色计入图形配色
const SKIP_TAGS = new Set(['text', 'tspan', 'textpath', 'title', 'desc', 'metadata']);

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * 判断一个 fill/stroke 值是否属于“支持的纯色字面量”。
 * 仅接受：#rgb / #rgba / #rrggbb / #rrggbbaa 与 rgb()/rgba()/hsl()/hsla()。
 * 这是粗筛闸门，最终有效性交给 culori 解析确认。
 */
function looksLikeSolidColor(value) {
  const v = value.trim();
  return (
    /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v) ||
    /^(?:rgb|rgba|hsl|hsla)\s*\([\s\S]*\)$/i.test(v)
  );
}

/**
 * 纯色值 → #rrggbb。
 * 支持 HEX / RGB / HSL（含 CSS Color 4 空格语法）；带 alpha 的颜色合成到白底：
 *   C_on_white = α·C + (1−α)·1
 * @returns {string|null} 归一化 hex；不支持/无效（none、currentColor、url()、命名色等）返回 null
 */
export function toSolidHex(value) {
  if (value == null) return null;
  const v = String(value).trim();
  if (!v || !looksLikeSolidColor(v)) return null;
  let parsed;
  try {
    parsed = parse(v);
  } catch {
    return null;
  }
  if (!parsed || !parsed.mode) return null;
  const rgb = toRgb(parsed);
  if (!rgb || (!Number.isFinite(rgb.r) || !Number.isFinite(rgb.g) || !Number.isFinite(rgb.b))) {
    return null;
  }
  const a = rgb.alpha == null ? 1 : clamp01(rgb.alpha);
  const byte = (c) => {
    const overWhite = a * clamp01(c) + (1 - a);
    return Math.round(overWhite * 255).toString(16).padStart(2, '0');
  };
  return `#${byte(rgb.r)}${byte(rgb.g)}${byte(rgb.b)}`;
}

/**
 * 解析 SVG 文本。解析失败（非 XML / 根元素不是 svg）抛出错误。
 */
export function parseSvgText(text) {
  if (typeof DOMParser === 'undefined') {
    throw new Error('当前浏览器不支持 SVG 解析');
  }
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc && doc.documentElement;
  const parseError =
    root && (root.nodeName === 'parsererror' || root.getElementsByTagName('parsererror').length);
  if (!root || parseError || (root.localName || root.nodeName) !== 'svg') {
    throw new Error('SVG 解析失败：文件不是有效的 SVG 文档（请检查 XML 结构是否完整）');
  }
  return doc;
}

/** 元素可读描述：<tag>#id.class，用于引用明细展示 */
export function describeElement(el) {
  const tag = el.localName || el.nodeName || '?';
  let s = `<${tag}>`;
  const id = el.getAttribute && el.getAttribute('id');
  if (id) s += `#${id}`;
  const cls = el.getAttribute && el.getAttribute('class');
  if (cls && cls.trim()) {
    s += `.${cls.trim().split(/\s+/).slice(0, 2).join('.')}`;
  }
  return s;
}

/** 单条引用的可读位置描述 */
export function describeRef(ref) {
  const where = ref.attr === 'style' ? `内联 style · ${ref.prop}` : `${ref.prop} 属性`;
  return `${describeElement(ref.el)} · ${where} = ${ref.raw}`;
}

/** 一组同色元素的默认标签：rect/circle · 填充/描边 ×N */
export function groupLabel(group) {
  const tags = [
    ...new Set(group.refs.map((r) => r.el.localName || r.el.nodeName || '?')),
  ].join('/');
  const props = [
    ...new Set(group.refs.map((r) => PROP_LABELS[r.prop] || r.prop)),
  ].join('/');
  return `${tags} · ${props} ×${group.refs.length}`;
}

function addRef(map, raw, ref, stats) {
  const hex = toSolidHex(raw);
  if (!hex) {
    stats.skipped += 1;
    return;
  }
  let group = map.get(hex);
  if (!group) {
    group = { hex, refs: [] };
    map.set(hex, group);
  }
  group.refs.push(ref);
}

/**
 * 从已解析 SVG 文档提取颜色。
 * @returns {{ groups: Array<{hex:string, refs:Ref[]}>, totalRefs:number, skipped:number }}
 *   groups 按文档首次出现顺序排列；Ref = { el, attr: 'fill'|'stroke'|'style', prop, raw }
 */
export function extractSvgColors(doc) {
  const map = new Map();
  const stats = { skipped: 0, totalRefs: 0 };

  doc.querySelectorAll('*').forEach((el) => {
    if (!el.getAttribute) return;
    const tag = (el.localName || el.nodeName || '').toLowerCase();
    if (SKIP_TAGS.has(tag)) return; // 仅扫描图形元素，跳过文字 / 元数据元素

    // 1) 内联 style 属性中的 fill / stroke 声明
    const styleAttr = el.getAttribute('style');
    if (styleAttr) {
      for (const decl of styleAttr.split(';')) {
        const idx = decl.indexOf(':');
        if (idx < 0) continue;
        const prop = decl.slice(0, idx).trim().toLowerCase();
        if (!PAINT_PROPS.includes(prop)) continue;
        const raw = decl.slice(idx + 1).trim();
        if (!raw) continue;
        stats.totalRefs += 1;
        addRef(map, raw, { el, attr: 'style', prop, raw }, stats);
      }
    }

    // 2) fill / stroke 表现属性
    for (const prop of PAINT_PROPS) {
      if (!el.hasAttribute || !el.hasAttribute(prop)) continue;
      const raw = el.getAttribute(prop);
      if (raw == null || !raw.trim()) continue;
      stats.totalRefs += 1;
      addRef(map, raw.trim(), { el, attr: prop, prop, raw: raw.trim() }, stats);
    }
  });

  return {
    groups: [...map.values()],
    totalRefs: stats.totalRefs,
    skipped: stats.skipped,
  };
}

export const isHex6 = (v) => /^#[0-9a-fA-F]{6}$/.test(String(v || '').trim());

/** 只替换 style 属性中的指定声明，保留其他声明与书写形式 */
function setStyleDeclaration(el, prop, value) {
  const styleAttr = el.getAttribute('style') || '';
  const next = styleAttr
    .split(';')
    .map((decl) => {
      const idx = decl.indexOf(':');
      if (idx < 0) return decl;
      if (decl.slice(0, idx).trim().toLowerCase() !== prop) return decl;
      return `${decl.slice(0, idx + 1)} ${value}`;
    })
    .join(';');
  el.setAttribute('style', next);
}

/**
 * 将调色板当前色值写回 SVG 文档中的全部引用，然后序列化为字符串。
 * 以导入时提取的“全部颜色组”为基准（而非当前调色板行）：
 *   - 组对应的调色板行存在且 hex 合法 → 写入行当前 hex（同步全部引用）；
 *   - 行已被删除 / 超出 8 色上限未导入 → 写回归一化原色（幂等，不残留旧值）；
 *   - 行 hex 当前非法（手动编辑中）→ 同样保留归一化原色。
 * @param doc       parseSvgText 得到的文档
 * @param groups    extractSvgColors 返回的全部颜色组
 * @param rows      调色板行（带可选 originalHex / hex）
 * @param serialize XMLSerializer 包装，默认浏览器原生
 */
export function buildModifiedSvg(doc, groups, rows, serialize) {
  const byOriginal = new Map();
  for (const row of rows || []) {
    if (row.originalHex) byOriginal.set(row.originalHex.toLowerCase(), row);
  }
  for (const group of groups || []) {
    const row = byOriginal.get(group.hex.toLowerCase());
    const targetHex = row && isHex6(row.hex) ? String(row.hex).trim() : group.hex;
    for (const ref of group.refs) {
      if (ref.attr === 'style') setStyleDeclaration(ref.el, ref.prop, targetHex);
      else ref.el.setAttribute(ref.prop, targetHex);
    }
  }
  // 独立 SVG 文件需要显式命名空间，blob 预览 / 下载后才能正常渲染
  const root = doc.documentElement;
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const ser = serialize || ((node) => new XMLSerializer().serializeToString(node));
  return ser(root);
}

/** 触发浏览器下载 */
export function downloadText(filename, text, mime = 'image/svg+xml;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 输出文件名：原名去 .svg 后缀 + -cvd.svg */
export function outputSvgName(filename) {
  const base = (filename || 'legend').replace(/\.svg$/i, '').trim() || 'legend';
  return `${base}-cvd.svg`;
}
