/**
 * SVG 图例导入：纯前端解析 fill / stroke 纯色并支持引用级改写。
 *
 * 设计约定（与需求一一对应）：
 *  - 只收集图形元素的 presentation 属性 fill / stroke，以及内联 style 中的
 *    fill / stroke 声明；<style> 内的 CSS 规则、class 继承等“非内联”颜色不解析。
 *  - 仅接受纯色写法：HEX（#rgb / #rrggbb / 带 alpha 的 4/8 位）、
 *    rgb()/rgba()、hsl()/hsla()；
 *    none、currentColor、transparent、url(#…) 渐变引用、具名色（red 等）一律忽略。
 *  - 带 alpha 且 alpha < 1（半透明）的颜色不算可替换纯色，计入“已忽略”。
 *  - 等价颜色按 sRGB HEX（#rrggbb）归一化去重，并保留每个颜色对应的
 *    元素 / 属性引用，应用候选色时逐引用改写。
 *
 * 整个模块只依赖浏览器 DOM（DOMParser / XMLSerializer）与 culori，
 * 文件内容不离开本机。
 */

import { parse as parseColor, formatHex } from 'culori';

/* ---------------- 纯色识别与归一化 ---------------- */

const HEX_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
// 函数名白名单（rgb/rgba/hsl/hsla），兼容逗号与现代空格 / slash-alpha 语法；
// 括号内具体语法是否合法交给 culori 严格解析
const RGB_RE = /^rgba?\s*\(/i;
const HSL_RE = /^hsla?\s*\(/i;

/**
 * 解析一个颜色字面量。
 * @returns {{hex: string, family: string} | null}
 *   接受：HEX / RGB / HSL 且 alpha 为 1（或缺省）；其余（含半透明）返回 null。
 */
export function normalizeSolidColor(input) {
  const raw = String(input).trim().replace(/\s*!important\s*$/i, '');
  if (!raw) return null;
  // 必须是 HEX / RGB / HSL 之一，具名色（red…）与其它函数（lab()、color-mix()…）不接受
  let family = null;
  if (HEX_RE.test(raw)) family = 'hex';
  else if (RGB_RE.test(raw)) family = 'rgb';
  else if (HSL_RE.test(raw)) family = 'hsl';
  if (!family) return null;

  const parsed = parseColor(raw);
  if (!parsed) return null;
  const alpha = parsed.alpha === undefined ? 1 : parsed.alpha;
  if (alpha < 1 - 1e-9) return null; // 半透明纯色无法用单个不透明 HEX 等价替换

  return { hex: formatHex(parsed), family };
}

/* ---------------- 内联 style 声明 ---------------- */

/**
 * 解析 style="fill:#a;stroke:rgb(...)" 为有序声明数组。
 */
export function parseStyleDeclarations(styleText) {
  const decls = [];
  for (const piece of String(styleText).split(';')) {
    const m = piece.match(/^([^:]*?):([\s\S]*)$/);
    if (!m) continue;
    decls.push({
      name: m[1].trim().toLowerCase(),
      value: m[2].trim(),
    });
  }
  return decls;
}

function renderStyleDeclarations(decls) {
  // 维持 “name: value; name: value” 的常见序列化风格
  return decls.map((d) => `${d.name}: ${d.value}`).join(';');
}

/* ---------------- 元素描述 ---------------- */

function describeElement(el) {
  const tag = el.localName || el.nodeName;
  let name = tag;
  if (el.getAttribute && el.getAttribute('id')) {
    name = `#${el.getAttribute('id')}`;
  } else {
    const cls = el.getAttribute && el.getAttribute('class');
    if (cls) name = `${tag}.${cls.trim().split(/\s+/).join('.')}`;
  }
  return { tag, name };
}

/* ---------------- SVG 解析 ---------------- */

export class SvgParseError extends Error {}

/**
 * 解析 SVG 文本为 XML 文档。
 * 校验：非空、根节点为 <svg>、XML 无 parsererror。
 */
export function parseSvgText(text) {
  if (!text || !text.trim()) {
    throw new SvgParseError('文件为空，未找到任何 SVG 内容');
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'image/svg+xml');
  if (!doc || !doc.documentElement) {
    throw new SvgParseError('无法解析该文件：内容不是有效的 SVG / XML');
  }
  const root = doc.documentElement;
  if (root.nodeName === 'parsererror' || root.getElementsByTagName('parsererror').length) {
    throw new SvgParseError('SVG 语法解析失败：请检查 XML 标签是否闭合、属性格式是否正确');
  }
  if ((root.localName || root.nodeName).toLowerCase() !== 'svg') {
    throw new SvgParseError('根元素不是 <svg>，请确认上传的是 SVG 图例文件');
  }
  return doc;
}

/**
 * 遍历文档内所有元素，排除 foreignObject 内嵌的 HTML（其 fill/stroke 不代表图形上色）。
 * 不按命名空间严格过滤：仅后续真正携带 fill/stroke 信息的元素才会被收集，
 * 因此 HTML 根文档等环境下混入的无关元素不会产生结果。
 */
function svgElements(doc) {
  const out = [];
  for (const el of doc.querySelectorAll('*')) {
    if (el.closest && el.closest('foreignObject')) continue;
    out.push(el);
  }
  return out;
}

const PAINT_ATTRS = ['fill', 'stroke'];

/** 返回忽略原因；none/transparent/空串视为正常“无颜色”（reason === 'none'，不计入提示） */
function classifyPaint(raw) {
  const v = String(raw).trim().replace(/\s*!important\s*$/i, '');
  const low = v.toLowerCase();
  if (v === '' || low === 'none' || low === 'transparent') return 'none';
  if (low === 'currentcolor' || low === 'inherit') return 'keyword';
  if (low.startsWith('url(')) return 'reference';
  if (HEX_RE.test(v) || RGB_RE.test(v) || HSL_RE.test(v)) {
    const p = parseColor(v);
    if (p && p.alpha !== undefined && p.alpha < 1 - 1e-9) return 'alpha';
  }
  const norm = normalizeSolidColor(v);
  return norm ? null : 'unsupported';
}

/**
 * 从 SVG 文档抽取纯色并归一化去重。
 * 每个 ref 直接绑定其 DOM 元素节点（_el）与（内联样式时的）声明序号。
 *
 * @returns {{
 *   colors: Array<{
 *     hex: string,
 *     count: number,
 *     attrs: {fill: number, stroke: number},
 *     elements: string[],
 *     refs: Array<object>,
 *   }>,
 *   stats: { elements: number, refs: number, skipped: Array<{reason: string, count: number}> },
 * }}
 */
export function extractSvgColors(doc) {
  const map = new Map(); // hex -> color record
  const skipCounts = new Map();
  let elementCount = 0;

  const addSkipped = (reason) => {
    skipCounts.set(reason, (skipCounts.get(reason) || 0) + 1);
  };

  const consider = (el, where, name, raw, styleIndex) => {
    const reason = classifyPaint(raw);
    if (reason === 'none') return;
    if (reason) {
      addSkipped(reason);
      return;
    }
    const { hex } = normalizeSolidColor(raw);
    let rec = map.get(hex);
    if (!rec) {
      rec = {
        hex,
        count: 0,
        attrs: { fill: 0, stroke: 0 },
        elementSet: new Set(),
        refs: [],
      };
      map.set(hex, rec);
    }
    const desc = describeElement(el);
    rec.count += 1;
    rec.attrs[name] += 1;
    rec.elementSet.add(desc.name);
    rec.refs.push({
      hex,
      where, // 'attr' | 'style'
      name,
      raw: raw.trim(),
      tag: desc.tag,
      element: desc.name,
      styleIndex,
      _el: el,
    });
  };

  for (const el of svgElements(doc)) {
    elementCount += 1;

    // 1) presentation 属性
    for (const name of PAINT_ATTRS) {
      if (el.hasAttribute(name)) consider(el, 'attr', name, el.getAttribute(name));
    }

    // 2) 内联 style 中的 fill / stroke
    if (el.hasAttribute('style')) {
      parseStyleDeclarations(el.getAttribute('style')).forEach((d, index) => {
        if (PAINT_ATTRS.includes(d.name)) consider(el, 'style', d.name, d.value, index);
      });
    }
  }

  const colors = [...map.values()].map((rec) => ({
    hex: rec.hex,
    count: rec.count,
    attrs: rec.attrs,
    elements: [...rec.elementSet],
    refs: rec.refs,
  }));
  const skipped = [...skipCounts.entries()].map(([reason, count]) => ({ reason, count }));
  return { colors, stats: { elements: elementCount, refs: colors.reduce((s, c) => s + c.count, 0), skipped } };
}

/* ---------------- 引用改写 ---------------- */

/**
 * 将单个颜色引用改写为新的 HEX 值。
 * 对属性引用直接 setAttribute；对内联 style 引用替换对应序号的声明，
 * 保留同一 style 字符串中的其它声明。
 */
export function rewriteRef(ref, newHex) {
  const value = String(newHex).trim();
  const el = ref._el;
  if (!el) return false;

  if (ref.where === 'attr') {
    if (!el.hasAttribute(ref.name)) return false;
    const before = el.getAttribute(ref.name);
    el.setAttribute(ref.name, value);
    return before !== value;
  }

  if (!el.hasAttribute('style')) return false;
  const decls = parseStyleDeclarations(el.getAttribute('style'));
  // styleIndex 是该声明在整个 style 字符串中的序号（抽取时记录）
  const target = decls[ref.styleIndex ?? 0];
  if (!target || target.name !== ref.name) return false;
  if (target.value === value) return false;
  target.value = value;
  el.setAttribute('style', renderStyleDeclarations(decls));
  return true;
}

/**
 * 改写某归一化颜色的全部引用。
 * @returns {number} 实际发生改写的引用数
 */
export function rewriteColor(refs, newHex) {
  let n = 0;
  for (const ref of refs) if (rewriteRef(ref, newHex)) n += 1;
  return n;
}

export function serializeSvg(doc) {
  return new XMLSerializer().serializeToString(doc);
}

/**
 * 一站式解析：文本 → { doc, colors, stats }。
 */
export function importSvgText(text) {
  const doc = parseSvgText(text);
  const { colors, stats } = extractSvgColors(doc);
  return { doc, colors, stats };
}
