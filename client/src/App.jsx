import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyze, recommend, getModes } from './api.js';
import {
  MAX_SVG_COLORS,
  MAX_SVG_BYTES,
  parseSvgText,
  extractSvgColors,
  buildModifiedSvg,
  groupLabel,
  describeRef,
  downloadText,
  outputSvgName,
  isHex6,
} from './svgImport.js';

/* ---------------- 预设调色板 ---------------- */
const PRESETS = [
  {
    name: '分类 · 五色',
    colors: [
      { hex: '#4e79a7', label: '蓝' },
      { hex: '#f28e2b', label: '橙' },
      { hex: '#59a14f', label: '绿' },
      { hex: '#e15759', label: '红' },
      { hex: '#76b7b2', label: '青' },
    ],
  },
  {
    name: '土地利用 · 六色',
    colors: [
      { hex: '#8dd3c7', label: '水域' },
      { hex: '#ffffb3', label: '耕地' },
      { hex: '#bebada', label: '林地' },
      { hex: '#fb8072', label: '建设' },
      { hex: '#80b1d3', label: '草地' },
      { hex: '#fdb462', label: '裸地' },
    ],
  },
  {
    name: '风险分级 · 四色',
    colors: [
      { hex: '#2c7bb6', label: '低风险' },
      { hex: '#abd9e9', label: '较低' },
      { hex: '#fdae61', label: '较高' },
      { hex: '#d7191c', label: '高风险' },
    ],
  },
  {
    name: '红绿双色 · 2 色',
    colors: [
      { hex: '#d62728', label: '停止' },
      { hex: '#2ca02c', label: '通行' },
    ],
  },
];

const MODE_TABS_FALLBACK = [
  { id: 'normal', label: '正常色觉', short: '正常' },
  { id: 'protan', label: '红色弱', short: '红弱' },
  { id: 'deutan', label: '绿色弱', short: '绿弱' },
  { id: 'tritan', label: '蓝色弱', short: '蓝弱' },
];

const fmt = (n) => (Math.round(n * 10) / 10).toFixed(1);

export default function App() {
  const [modeMeta, setModeMeta] = useState(MODE_TABS_FALLBACK);
  const [palette, setPalette] = useState(PRESETS[0].colors);
  const [enabledModes, setEnabledModes] = useState(
    MODE_TABS_FALLBACK.map((m) => m.id),
  );
  const [threshold, setThreshold] = useState(10);
  const [severity, setSeverity] = useState(0.6);

  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeMode, setActiveMode] = useState('normal');
  const [markedTarget, setMarkedTarget] = useState(null);

  const [targetIndex, setTargetIndex] = useState(0);
  const [rec, setRec] = useState(null);
  const [recLoading, setRecLoading] = useState(false);

  // SVG 图例导入：全部在浏览器本地完成，文件内容不会上传服务器
  // svg: { name, doc, totalRefs, skipped }
  const [svg, setSvg] = useState(null);
  const [svgError, setSvgError] = useState(null);
  const [svgInfo, setSvgInfo] = useState(null);
  const [svgDragging, setSvgDragging] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    getModes().then(setModeMeta).catch(() => {});
  }, []);

  const payload = useMemo(
    () => ({
      colors: palette.map((c) => c.hex),
      labels: palette.map((c) => c.label),
      modes: enabledModes,
      threshold: Number(threshold),
      severity: Number(severity),
    }),
    [palette, enabledModes, threshold, severity],
  );

  const runAnalyze = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await analyze(payload);
      setResult(data);
      if (!data.modes.some((m) => m.id === activeMode)) {
        setActiveMode(data.modes[0].id);
      }
    } catch (e) {
      setError(e.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [payload, activeMode]);

  // 首次加载自动校验一次
  useEffect(() => {
    runAnalyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- 调色板编辑 ---------- */
  const updateColor = (i, patch) =>
    setPalette((ps) => ps.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  const addColor = () => {
    if (palette.length >= 8) return;
    const pool = ['#af7aa1', '#ff9da7', '#9c755f', '#bab0ac'];
    setPalette((ps) => [
      ...ps,
      { hex: pool[(ps.length - 2 + pool.length) % pool.length], label: `色 ${ps.length + 1}` },
    ]);
  };
  const removeColor = (i) =>
    setPalette((ps) => (ps.length > 2 ? ps.filter((_, k) => k !== i) : ps));

  /* ---------- SVG 图例导入（纯本地解析） ---------- */
  const importSvgFile = useCallback(async (file) => {
    setSvgError(null);
    setSvgInfo(null);
    setError(null);
    if (!file) return;
    if (!/\.svg$/i.test(file.name) && file.type && file.type !== 'image/svg+xml') {
      setSvgError('请选择 .svg 文件');
      return;
    }
    if (file.size > MAX_SVG_BYTES) {
      setSvgError(`文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），请使用 2 MB 以内的 SVG`);
      return;
    }
    let text;
    try {
      text = await file.text();
    } catch {
      setSvgError('文件读取失败，请重试');
      return;
    }

    let doc;
    try {
      doc = parseSvgText(text);
    } catch (e) {
      setSvgError(e.message);
      return;
    }
    const { groups, totalRefs, skipped } = extractSvgColors(doc);
    if (!groups.length) {
      setSvgError('未在该 SVG 中发现可用的纯色（fill / stroke 的 HEX、RGB、HSL）');
      return;
    }

    const kept = groups.slice(0, MAX_SVG_COLORS);
    const overflow = groups.length - kept.length;
    const rows = kept.map((g) => ({
      hex: g.hex,
      originalHex: g.hex,
      label: groupLabel(g),
      refs: g.refs,
    }));
    setPalette(rows);
    setSvg({
      name: file.name,
      doc,
      originalText: text,
      groups,
      totalRefs,
      skipped,
      groupCount: groups.length,
    });
    setTargetIndex(0);
    setRec(null);
    setMarkedTarget(null);

    const parts = [
      `发现 ${groups.length} 种纯色、${totalRefs} 处 fill/stroke 引用，已载入校验`,
    ];
    if (overflow > 0) {
      parts.push(`；超出 ${MAX_SVG_COLORS} 色上限的 ${overflow} 种颜色不参与校验，导出时保持原值`);
    }
    if (skipped > 0) {
      parts.push(`；已忽略 ${skipped} 处 none / currentColor / 渐变 / 外链涂料引用`);
    }
    if (groups.length < 2) {
      parts.push('。仅 1 种颜色无法做色对校验，可在下方手动添加颜色后运行');
    }
    setSvgInfo(parts.join(''));

    if (rows.length >= 2) {
      // 导入结果直接进入现有多模式校验
      const p = {
        colors: rows.map((r) => r.hex),
        modes: enabledModes,
        threshold: Number(threshold),
        severity: Number(severity),
      };
      try {
        const data = await analyze(p);
        setResult(data);
        if (!data.modes.some((m) => m.id === activeMode)) setActiveMode(data.modes[0].id);
      } catch (e) {
        setError(e.message);
      }
    } else {
      setResult(null);
    }
  }, [enabledModes, threshold, severity, activeMode]);

  const handleSvgSelect = (e) => {
    const file = e.target.files && e.target.files[0];
    importSvgFile(file);
    e.target.value = ''; // 允许再次选择同一文件
  };

  const handleSvgDrop = (e) => {
    e.preventDefault();
    setSvgDragging(false);
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    importSvgFile(file);
  };

  const clearSvg = () => {
    setSvg(null);
    setSvgError(null);
    setSvgInfo(null);
    setPalette(PRESETS[0].colors.map((c) => ({ ...c })));
    setTargetIndex(0);
    setRec(null);
    setMarkedTarget(null);
    runAnalyze();
  };

  // 当前调色板写回 SVG 后的文本；删除行 / 超出上限 / 非法 hex 的组回归归一化原色
  const modifiedSvgText = useMemo(
    () => (svg ? buildModifiedSvg(svg.doc, svg.groups, palette) : null),
    [svg, palette],
  );
  const changedRows = svg
    ? palette.filter((r) => r.originalHex && r.hex.toLowerCase() !== r.originalHex.toLowerCase())
    : [];

  const toggleMode = (id) =>
    setEnabledModes((ms) => {
      if (ms.includes(id)) return ms.length > 1 ? ms.filter((m) => m !== id) : ms;
      return [...ms, id];
    });

  /* ---------- 推荐 ---------- */
  const runRecommend = async () => {
    setRecLoading(true);
    setError(null);
    try {
      const data = await recommend({ ...payload, targetIndex: Number(targetIndex), limit: 11 });
      setRec(data);
    } catch (e) {
      setError(e.message);
      setRec(null);
    } finally {
      setRecLoading(false);
    }
  };

  const applyCandidate = async (hex) => {
    updateColor(targetIndex, { hex });
    setMarkedTarget(targetIndex);
    setLoading(true);
    setError(null);
    try {
      const nextColors = palette.map((c, i) => (i === targetIndex ? hex : c.hex));
      const data = await analyze({
        colors: nextColors,
        modes: enabledModes,
        threshold: Number(threshold),
        severity: Number(severity),
      });
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const activeResult = result?.modes.find((m) => m.id === activeMode);

  return (
    <>
      <header className="app-header">
        <h1>🎨 色觉安全图例校验台</h1>
        <p>线性 RGB 色觉模拟 → Lab CIEDE2000 全色对校验 → 锁定换色推荐</p>
      </header>

      <div className="layout">
        {/* ================= 左侧：编辑与设置 ================= */}
        <div>
          <section className="panel svg-import-panel">
            <h2>
              SVG 图例导入
              <span className="hint">本地解析 · 原文件不上传服务器</span>
            </h2>

            <div
              className={`dropzone ${svgDragging ? 'dragging' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setSvgDragging(true);
              }}
              onDragLeave={() => setSvgDragging(false)}
              onDrop={handleSvgDrop}
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
              }}
            >
              <div className="drop-icon">📄</div>
              <div className="drop-text">
                <b>点击选择</b> 或拖拽本地 <code>.svg</code> 文件到此处
              </div>
              <div className="drop-sub">
                解析 fill / stroke 属性与内联 style 中的 HEX、RGB、HSL 纯色；
                忽略 none、currentColor、渐变与外链涂料
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".svg,image/svg+xml"
                onChange={handleSvgSelect}
                hidden
              />
            </div>

            {svgError && (
              <div className="error-box" style={{ marginTop: 10 }}>
                ⚠ {svgError}
              </div>
            )}
            {svg && (
              <div className="svg-file-bar">
                <span className="svg-filename" title={svg.name}>
                  ✅ {svg.name}
                </span>
                <button className="btn tiny" onClick={() => fileInputRef.current?.click()}>
                  重新选择
                </button>
                <button className="btn tiny" onClick={clearSvg}>
                  移除
                </button>
              </div>
            )}
            {svgInfo && <div className="info-box">ℹ {svgInfo}</div>}
          </section>

          <section className="panel">
            <h2>
              调色板
              <span className="hint">{palette.length} / 8 色（带标签，2–8 色）</span>
            </h2>
            {palette.map((c, i) => (
              <div className="palette-row" key={i}>
                <input
                  type="color"
                  value={isHex6(c.hex) ? c.hex : '#000000'}
                  onChange={(e) => updateColor(i, { hex: e.target.value })}
                  title="选色"
                />
                <input
                  className="hex-input"
                  type="text"
                  value={c.hex}
                  onChange={(e) => updateColor(i, { hex: e.target.value })}
                />
                <input
                  className="label-input"
                  type="text"
                  value={c.label}
                  onChange={(e) => updateColor(i, { label: e.target.value })}
                  placeholder="标签"
                />
                {c.refs?.length ? (
                  <span
                    className="ref-badge"
                    title={`${c.refs.map(describeRef).join('\n')}`}
                  >
                    {c.refs.length}
                  </span>
                ) : (
                  <span className="ref-badge placeholder" />
                )}
                <button
                  className="icon-btn"
                  onClick={() => removeColor(i)}
                  disabled={palette.length <= 2}
                  title="删除该色"
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="row-actions">
              <button className="btn" onClick={addColor} disabled={palette.length >= 8}>
                ＋ 添加颜色
              </button>
            </div>
            <div className="preset-chips">
              {PRESETS.map((p) => (
                <button key={p.name} onClick={() => setPalette(p.colors.map((c) => ({ ...c })))}>
                  {p.name}
                </button>
              ))}
            </div>
            {svg && (
              <p className="range-hint" style={{ marginTop: 8 }}>
                调色板来自导入的 SVG，色名右侧数字为该色在 SVG 中的引用数（悬停查看明细）；
                应用推荐色时将同步改写全部引用。
              </p>
            )}
          </section>

          <section className="panel">
            <h2>校验设置</h2>
            <div className="mode-checks">
              {modeMeta.map((m) => (
                <label key={m.id}>
                  <input
                    type="checkbox"
                    checked={enabledModes.includes(m.id)}
                    onChange={() => toggleMode(m.id)}
                  />
                  {m.short || m.label}
                </label>
              ))}
            </div>
            <p className="range-hint" style={{ marginTop: 6 }}>
              至少保留一个模式；正常模式为单位矩阵，不施加模拟。
            </p>

            <div className="field">
              <label htmlFor="sev">色弱强度（矩阵插值 s）</label>
              <div className="range-row">
                <input
                  id="sev"
                  type="range"
                  min="0.05"
                  max="1"
                  step="0.05"
                  value={severity}
                  onChange={(e) => setSeverity(Number(e.target.value))}
                />
                <output>{Math.round(severity * 100)}%</output>
              </div>
              <p className="range-hint">
                M(s) = (1−s)·I + s·D：60% 为典型色弱，100% 为对应二色视觉（色盲）。
              </p>
            </div>

            <div className="field">
              <label htmlFor="thr">ΔE00 达标阈值</label>
              <input
                id="thr"
                type="number"
                min="1"
                max="100"
                step="0.5"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
              <div className="threshold-presets">
                {[5, 10, 15].map((t) => (
                  <button
                    key={t}
                    className={threshold === t ? 'active' : ''}
                    onClick={() => setThreshold(t)}
                  >
                    {t === 5 ? '宽松 ≥5' : t === 10 ? '推荐 ≥10' : '严格 ≥15'}
                  </button>
                ))}
              </div>
            </div>

            <div className="row-actions" style={{ marginTop: 14 }}>
              <button className="btn primary" onClick={runAnalyze} disabled={loading}>
                {loading ? <span className="spinner" /> : '🔍'} 运行校验
              </button>
            </div>
          </section>

          <RecommendPanel
            palette={palette}
            targetIndex={targetIndex}
            setTargetIndex={(i) => {
              setTargetIndex(i);
              setRec(null);
            }}
            onRun={runRecommend}
            loading={recLoading}
            rec={rec}
            onApply={applyCandidate}
          />
        </div>

        {/* ================= 右侧：结果 ================= */}
        <div>
          {svg && (
            <SvgPreviewPanel
              svg={svg}
              palette={palette}
              modifiedText={modifiedSvgText}
              changedRows={changedRows}
            />
          )}

          {error && <div className="error-box">⚠ {error}</div>}

          {!result && !error && <div className="empty-hint">配置调色板后点击“运行校验”。</div>}

          {result && (
            <>
              <ResultBanner result={result} modeMeta={modeMeta} />

              <section className="panel">
                <h2>各模式最差距离概览</h2>
                <ModeSummary result={result} />
              </section>

              <section className="panel" style={{ marginTop: 18 }}>
                <h2>
                  原色 / 模拟色 并排对照
                  <span className="hint">上为原色，下为该模式下的模拟色</span>
                </h2>
                <div className="tabs">
                  {result.modes.map((m) => (
                    <button
                      key={m.id}
                      className={activeMode === m.id ? 'active' : ''}
                      onClick={() => setActiveMode(m.id)}
                    >
                      {m.short}
                      <span className="mini">ΔE {fmt(m.minDeltaE)}</span>
                    </button>
                  ))}
                </div>
                <p className="legend-note">
                  模拟在<b>线性 sRGB</b> 中施加矩阵后裁剪到 [0,1]，再 gamma 编码显示；ΔE00 由模拟色
                  Lab 计算。
                </p>
                <SwatchGrid
                  result={result}
                  mode={activeMode}
                  labels={palette.map((c) => c.label)}
                  markedTarget={markedTarget}
                />
              </section>

              {activeResult && (
                <section className="panel" style={{ marginTop: 18 }}>
                  <h2>
                    {activeResult.label} · 色对距离矩阵
                    <span className="hint">红底 = 低于阈值 {result.threshold}</span>
                  </h2>
                  <DistanceMatrix result={result} mode={activeMode} labels={palette} />
                </section>
              )}

              <section className="panel" style={{ marginTop: 18 }}>
                <h2>
                  不达标色对清单
                  <span className="hint">取各模式最小值，按 ΔE00 升序</span>
                </h2>
                <PairTable result={result} labels={palette} />
              </section>
            </>
          )}
        </div>
      </div>

      <footer>
        Machado, Oliveira &amp; Fernandes (2009) CVD 矩阵 · CIEDE2000 (Sharma et al. 2005) ·
        React + Express + culori
      </footer>
    </>
  );
}

/* ================= 子组件 ================= */

function RecommendPanel({ palette, targetIndex, setTargetIndex, onRun, loading, rec, onApply }) {
  return (
    <section className="panel">
      <h2>替换色推荐 <span className="hint">锁定其余颜色</span></h2>
      <div className="replace-controls">
        <div className="field">
          <label htmlFor="target">待替换色</label>
          <select
            id="target"
            value={targetIndex}
            onChange={(e) => setTargetIndex(Number(e.target.value))}
            style={selectStyle}
          >
            {palette.map((c, i) => (
              <option key={i} value={i}>
                {i + 1}. {c.label || '未命名'}（{c.hex}）
              </option>
            ))}
          </select>
        </div>
        <button className="btn primary" onClick={onRun} disabled={loading}>
          {loading ? <span className="spinner" /> : '💡'} 生成推荐
        </button>
      </div>

      <div className="locked-chips">
        <span className="range-hint" style={{ margin: '2px 4px 0 0' }}>
          已锁定：
        </span>
        {palette.map((c, i) =>
          i === targetIndex ? null : (
            <span className="chip" key={i}>
              <span className="dot" style={{ background: c.hex }} />
              {c.label || c.hex}
            </span>
          ),
        )}
      </div>

      {rec && (
        <>
          <p className="range-hint" style={{ marginTop: 10 }}>
            从 {`HSL 等距网格`} 中筛选“跨模式最小 ΔE00”最大者；平分时与原色改变量更小者优先。
            点击卡片即可应用。
          </p>
          <div className="cand-grid">
            {rec.candidates.map((c, k) => {
              if (c.original) {
                return (
                  <div className="cand-card original" key="orig">
                    <div className="cand-anchor">
                      <span className="rank">原色</span>
                      <div className="cand-strip" style={{ background: c.hex }} />
                    </div>
                    <div className="cand-body">
                      <div className="hex">{c.hex}</div>
                      <div className="metric">
                        <span>改变量</span>
                        <b>0.0</b>
                      </div>
                    </div>
                  </div>
                );
              }
              const isBest = k === 1;
              return (
                <button
                  className="cand-card"
                  key={c.hex}
                  onClick={() => onApply(c.hex)}
                  title={`应用 ${c.hex}`}
                >
                  <div className="cand-anchor">
                    {isBest && <span className="rank">★ 最优</span>}
                    <div className="cand-strip" style={{ background: c.hex }} />
                  </div>
                  <div className="cand-body">
                    <div className="hex">{c.hex}</div>
                    <div className="metric">
                      <span>最小 ΔE</span>
                      <b style={{ color: c.pass ? 'var(--ok-ink)' : 'var(--bad-ink)' }}>
                        {fmt(c.score)}
                      </b>
                    </div>
                    <div className="metric">
                      <span>改变量</span>
                      <b>{fmt(c.change)}</b>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

const selectStyle = {
  width: '100%',
  border: '1px solid var(--line)',
  borderRadius: 6,
  padding: '6px 8px',
  font: 'inherit',
  background: '#fff',
};

/* SVG 文本 → Blob URL 的安全预览（<img> 不执行脚本） */
function SvgImg({ text, alt }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!text) return undefined;
    const u = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [text]);
  return <img className="svg-preview-img" src={url || undefined} alt={alt} />;
}

function SvgPreviewPanel({ svg, palette, modifiedText, changedRows }) {
  const present = new Set(
    palette.map((r) => r.originalHex && r.originalHex.toLowerCase()),
  );
  const lockedOut = svg.groups.filter((g) => !present.has(g.hex.toLowerCase())).length;
  return (
    <section className="panel svg-preview-panel">
      <h2>
        修改后 SVG 预览与下载
        <span className="hint">颜色改动实时同步到全部引用</span>
      </h2>

      <div className="svg-preview-grid">
        <figure>
          <figcaption>原图</figcaption>
          <div className="svg-preview-box">
            <SvgImg text={svg.originalText} alt="原始 SVG 图例" />
          </div>
        </figure>
        <figure>
          <figcaption>应用候选色后</figcaption>
          <div className="svg-preview-box modified">
            <SvgImg text={modifiedText} alt="修改后 SVG 图例" />
          </div>
        </figure>
      </div>

      <div className="svg-change-row">
        <div className="svg-changes">
          {changedRows.length ? (
            changedRows.map((r) => (
              <span className="change-chip" key={r.originalHex}>
                <span className="cell-swatch" style={{ background: r.originalHex }} />
                <code>{r.originalHex}</code>
                <span className="arrow">→</span>
                <span className="cell-swatch" style={{ background: r.hex }} />
                <code>{r.hex}</code>
                <span className="range-hint">×{r.refs.length} 处</span>
              </span>
            ))
          ) : (
            <span className="range-hint">尚未改动颜色；在“替换色推荐”中点击候选卡即可改写 SVG。</span>
          )}
        </div>
        <button
          className="btn primary"
          onClick={() => downloadText(outputSvgName(svg.name), modifiedText)}
        >
          ⬇ 下载修改后 SVG
        </button>
      </div>

      <p className="range-hint" style={{ marginTop: 8 }}>
        {svg.groupCount} 种颜色 / {svg.totalRefs} 处引用；
        {svg.skipped > 0 &&
          `已忽略 ${svg.skipped} 处 none / currentColor / 渐变 / 外链涂料引用；`}
        {lockedOut > 0 &&
          `其中 ${lockedOut} 种颜色未在校验调色板中（超出 8 色上限或已删除），导出时保持归一化原色；`}
        全部处理均在浏览器本地完成，原文件不会上传服务器。
      </p>
    </section>
  );
}

function ResultBanner({ result, modeMeta }) {
  const failPairs = result.pairs.filter((p) => !p.pass);
  const worstMeta = result.modes.find((m) => m.id === result.worstMode);
  return (
    <div className={`banner ${result.overallPass ? 'pass' : 'fail'}`}>
      <span className="big">{result.overallPass ? '✅ 全部达标' : '❌ 存在不达标色对'}</span>
      <span className="sub">
        最差模式：
        <b>
          {worstMeta.short}（最小 ΔE00 = {fmt(worstMeta.minDeltaE)}，阈值 ≥
          {result.threshold}）
        </b>
      </span>
      <span className={`badge ${result.overallPass ? 'ok' : 'bad'}`}>
        {result.pairs.length - failPairs.length}/{result.pairs.length} 色对通过
      </span>
      <span className="badge neutral">色弱强度 {Math.round(result.severity * 100)}%</span>
      {failPairs.length > 0 && (
        <span className="badge bad">{failPairs.length} 对不达标</span>
      )}
    </div>
  );
}

function ModeSummary({ result }) {
  const max = Math.max(result.threshold * 2, ...result.modes.map((m) => m.minDeltaE));
  return (
    <div className="mode-summary">
      {result.modes.map((m) => {
        const pct = Math.min(100, (m.minDeltaE / max) * 100);
        return (
          <div
            key={m.id}
            className={`mode-line ${m.id === result.worstMode ? 'worst' : ''}`}
            title={m.id === result.worstMode ? '全组最差模式' : ''}
          >
            <span className="mname">
              {m.short}
              {m.id === result.worstMode && <span className="badge bad" style={{ marginLeft: 8 }}>最差</span>}
            </span>
            <span className="bar-track">
              <span
                className={`bar-fill ${m.pass ? '' : 'bad'}`}
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="dval">
              {fmt(m.minDeltaE)}
              <span className="range-hint"> / {result.threshold}</span>
            </span>
            <span className={`badge ${m.pass ? 'ok' : 'bad'}`}>{m.pass ? '达标' : '不达标'}</span>
          </div>
        );
      })}
    </div>
  );
}

function SwatchGrid({ result, mode, labels, markedTarget }) {
  const sims = result.simulations[mode];
  return (
    <div className="swatch-grid">
      {result.colors.map((hex, i) => (
        <div
          className={`swatch-card ${markedTarget === i ? 'target' : ''}`}
          key={`${mode}-${i}`}
        >
          <div className="swatch-pair">
            <div className="swatch-cell" style={{ background: hex }} data-tag="原" />
            <div className="swatch-cell" style={{ background: sims[i] }} data-tag="模" />
          </div>
          <div className="swatch-meta">
            <div className="name">
              {i + 1}. {labels[i] || '未命名'}
            </div>
            <div className="codes">
              <span>{hex}</span>
              <span>→ {sims[i]}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DistanceMatrix({ result, mode, labels }) {
  const n = result.colors.length;
  const cellClass = (d) =>
    d < result.threshold ? 'cell-fail' : d < result.threshold * 1.25 ? 'cell-warn' : 'cell-ok';
  const getD = (i, j) => {
    if (i === j) return null;
    const pair = result.pairs.find((p) => p.i === Math.min(i, j) && p.j === Math.max(i, j));
    return pair.deltas[mode];
  };
  return (
    <div className="matrix-wrap">
      <table className="dist">
        <thead>
          <tr>
            <th></th>
            {result.colors.map((_, j) => (
              <th key={j}>
                <span className="cell-swatch" style={{ background: result.colors[j] }} />
                {j + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: n }, (_, i) => (
            <tr key={i}>
              <th>
                <span className="cell-swatch" style={{ background: result.colors[i] }} />
                {i + 1} {labels[i]?.label || ''}
              </th>
              {Array.from({ length: n }, (_, j) => {
                const d = getD(i, j);
                return (
                  <td key={j} className={d == null ? '' : cellClass(d)}>
                    {d == null ? '—' : fmt(d)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PairTable({ result, labels }) {
  const sorted = [...result.pairs].sort((a, b) => a.min - b.min);
  const shortOf = (id) => result.modes.find((m) => m.id === id)?.short || id;
  return (
    <div className="matrix-wrap">
      <table className="dist pair-table">
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>色对</th>
            {result.modes.map((m) => (
              <th key={m.id}>{m.short} ΔE00</th>
            ))}
            <th>最差模式</th>
            <th>最小 ΔE00</th>
            <th>判定</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={`${p.i}-${p.j}`} className={p.pass ? '' : 'fail'}>
              <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                <span className="cell-swatch" style={{ background: p.colors[0] }} />
                <span className="cell-swatch" style={{ background: p.colors[1] }} />
                {labels[p.i]?.label || p.colors[0]} ↔ {labels[p.j]?.label || p.colors[1]}
                <span className="pair-ids">
                  （{p.i + 1}–{p.j + 1}）
                </span>
              </td>
              {result.modes.map((m) => (
                <td
                  key={m.id}
                  className={p.deltas[m.id] < result.threshold ? 'cell-fail' : ''}
                >
                  {fmt(p.deltas[m.id])}
                </td>
              ))}
              <td>{shortOf(p.minMode)}</td>
              <td>
                <b>{fmt(p.min)}</b>
              </td>
              <td>
                <span className={`badge ${p.pass ? 'ok' : 'bad'}`}>
                  {p.pass ? '达标' : '不达标'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
