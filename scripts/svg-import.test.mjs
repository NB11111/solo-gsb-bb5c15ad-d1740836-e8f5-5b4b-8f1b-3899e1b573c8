/**
 * SVG 导入核心逻辑的 Node 冒烟测试（无需浏览器 / 额外依赖）。
 * 运行：node scripts/svg-import.test.mjs
 *
 * parseSvgText 依赖浏览器 DOMParser，不在本测试范围；
 * extractSvgColors / buildModifiedSvg 通过最小 fake DOM 验证。
 */
import assert from 'node:assert/strict';
import {
  toSolidHex,
  extractSvgColors,
  buildModifiedSvg,
  groupLabel,
  describeRef,
  outputSvgName,
  isHex6,
} from '../client/src/svgImport.js';

/* ---------------- 最小 fake DOM ---------------- */
class FakeEl {
  constructor(name, attrs = {}) {
    this.localName = name;
    this.nodeName = name;
    this._attrs = new Map(Object.entries(attrs).map(([k, v]) => [k, String(v)]));
    this.children = [];
  }
  getAttribute(k) {
    return this._attrs.has(k) ? this._attrs.get(k) : null;
  }
  hasAttribute(k) {
    return this._attrs.has(k);
  }
  setAttribute(k, v) {
    this._attrs.set(k, String(v));
  }
  append(child) {
    this.children.push(child);
    return child;
  }
}
class FakeDoc {
  constructor(root) {
    this.documentElement = root;
  }
  querySelectorAll(sel) {
    assert.equal(sel, '*');
    const out = [];
    const walk = (el) => {
      for (const c of el.children) {
        out.push(c);
        walk(c);
      }
    };
    walk(this.documentElement);
    return out;
  }
}
const serialize = (root) => {
  const lines = [];
  const walk = (el) => {
    const attrs = [...el._attrs.entries()].map(([k, v]) => `${k}="${v}"`).join(' ');
    lines.push(`${el.localName} ${attrs}`.trim());
    el.children.forEach(walk);
  };
  walk(root);
  return lines.join('\n');
};

/* ---------------- 1. 纯色归一化 ---------------- */
assert.equal(toSolidHex('#f00'), '#ff0000', '3 位 HEX 展开');
assert.equal(toSolidHex('#ff0000'), '#ff0000');
assert.equal(toSolidHex('#ff0000ff'), '#ff0000', 'HEX8 alpha=1');
assert.equal(toSolidHex('rgb(255, 0, 0)'), '#ff0000');
assert.equal(toSolidHex('rgba(255,0,0,1)'), '#ff0000');
assert.equal(toSolidHex('rgb(255  0 0)'), '#ff0000', 'CSS4 空格语法');
assert.equal(toSolidHex('hsl(120, 100%, 50%)'), '#00ff00');
assert.equal(toSolidHex('hsla(240, 100%, 50%, 1)'), '#0000ff');
assert.equal(toSolidHex('hsl(120deg 100% 50%)'), '#00ff00', 'hsl 空格 + deg');
assert.equal(toSolidHex('rgba(0,0,0,0.5)'), '#808080', '半透明黑合成到白底');
assert.equal(toSolidHex('rgba(0,0,0,0)'), '#ffffff', '全透明 → 白底');
for (const bad of ['none', 'currentColor', 'url(#g)', 'red', '', null, '#12', 'transparent']) {
  assert.equal(toSolidHex(bad), null, `忽略非纯色: ${bad}`);
}

/* ---------------- 2. 构建 fake SVG 文档 ---------------- */
const root = new FakeEl('svg', { xmlns: 'http://www.w3.org/2000/svg' });
const r1 = root.append(new FakeEl('rect', { id: 'r1', fill: '#f00', stroke: 'none' }));
const c1 = root.append(new FakeEl('circle', { class: 'a b', fill: 'rgb(0,128,0)' }));
const p1 = root.append(
  new FakeEl('path', { d: 'M0 0', style: 'fill: hsl(240,100%,50%); stroke-width: 2' }),
);
const r2 = root.append(new FakeEl('rect', { fill: '#ff0000' }));
const g = root.append(new FakeEl('g', {}));
g.append(new FakeEl('rect', { fill: 'url(#grad)' }));
g.append(new FakeEl('rect', { stroke: 'currentColor' }));
const t1 = root.append(new FakeEl('text', { fill: 'red' }));
const doc = new FakeDoc(root);

/* ---------------- 3. 提取 + 去重 + 引用保留 ---------------- */
const { groups, totalRefs, skipped } = extractSvgColors(doc);
assert.equal(groups.length, 3, '归一化为 3 个等价色');
assert.deepEqual(
  groups.map((g) => g.hex),
  ['#ff0000', '#008000', '#0000ff'],
  '按首次出现顺序',
);
assert.equal(groups[0].refs.length, 2, '#f00 与 #ff0000 合并，共 2 处引用');
assert.deepEqual(
  groups[0].refs.map((r) => r.attr),
  ['fill', 'fill'],
);
assert.equal(groups[2].refs[0].attr, 'style');
assert.equal(groups[2].refs[0].prop, 'fill');
assert.equal(groups[2].refs[0].raw, 'hsl(240,100%,50%)');
// none / url / currentColor 被跳过；命名色所在的 text 元素整体不扫描
assert.equal(totalRefs, 7, '图形元素 fill/stroke 声明总数（含被跳过的）');
assert.equal(skipped, 3, 'none、url、currentColor 各一处');

assert.equal(groupLabel(groups[0]), 'rect · 填充 ×2');
assert.equal(describeRef(groups[2].refs[0]), '<path> · 内联 style · fill = hsl(240,100%,50%)');
assert.equal(describeRef(groups[0].refs[0]), '<rect>#r1 · fill 属性 = #f00');
assert.equal(describeRef(groups[1].refs[0]), '<circle>.a.b · fill 属性 = rgb(0,128,0)');

/* ---------------- 4. 改写全部引用 + 序列化 ---------------- */
const rows = [
  { hex: '#123456', originalHex: '#ff0000', refs: groups[0].refs },
  { hex: '#222222', originalHex: '#0000ff', refs: groups[2].refs },
  { hex: '#abc', originalHex: '#008000', refs: groups[1].refs }, // 非法候选 → 回归原色
];
const out = buildModifiedSvg(doc, groups, rows, serialize);
assert.match(out, /rect id="r1" fill="#123456" stroke="none"/);
assert.match(out, /rect fill="#123456"/);
assert.match(out, /circle class="a b" fill="#008000"/, '非法候选不改动引用（归一化原色）');
assert.equal(
  p1.getAttribute('style'),
  'fill: #222222; stroke-width: 2',
  'style 内只替换 fill，其余声明与形式保留',
);
assert.match(out, /rect fill="url\(#grad\)"/, '渐变引用保持原样');
assert.match(out, /rect stroke="currentColor"/);
assert.equal(t1.getAttribute('fill'), 'red', '文字元素不参与扫描，颜色原样保留');

// 再次构建（幂等）：换色仍按当前值重写；删除的行回归归一化原色
const out2 = buildModifiedSvg(
  doc,
  groups,
  [{ hex: '#654321', originalHex: '#ff0000', refs: groups[0].refs }],
  serialize,
);
assert.match(out2, /rect id="r1" fill="#654321"/);
assert.match(out2, /rect fill="#654321"/);
assert.match(out2, /circle class="a b" fill="#008000"/, '被删除的行回归原色');
assert.match(
  out2,
  /path d="M0 0" style="fill: #0000ff; stroke-width: 2"/,
  '被删除的 style 引用行回归原色，其余声明保留',
);

/* ---------------- 5. 辅助函数 ---------------- */
assert.equal(outputSvgName('map.svg'), 'map-cvd.svg');
assert.equal(outputSvgName('a/b/map.SVG'), 'a/b/map-cvd.svg');
assert.equal(outputSvgName(''), 'legend-cvd.svg');
assert.ok(isHex6('#aabbcc'));
assert.ok(!isHex6('#abc'));

console.log('✅ svgImport 全部测试通过');
