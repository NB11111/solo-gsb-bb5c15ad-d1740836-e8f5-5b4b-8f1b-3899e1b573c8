import React, { useEffect, useMemo, useState } from 'react';

/** 生成带下载文件名的结果名：legend.svg → legend-cvd-fixed.svg */
function buildDownloadName(name) {
  const base = name || 'legend.svg';
  return base.replace(/\.svg$/i, '') + '-cvd-fixed.svg';
}

function SvgFrame({ svgText, label }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [svgText]);
  return (
    <div className="svg-frame">
      <div className="svg-frame-label">{label}</div>
      <div className="svg-frame-box checker">
        {url && <img src={url} alt={label} />}
      </div>
    </div>
  );
}

/**
 * SVG 修改预览与下载。
 * - 仅当至少发生过一次换色时启用下载；
 * - 左侧原图（本地文本），右侧当前改写结果；
 * - “还原全部修改”基于原始文本重新解析，回到导入时状态。
 */
export default function SvgPreviewPanel({ svg, onReset, onDownload }) {
  const downloadName = useMemo(() => buildDownloadName(svg.fileName), [svg.fileName]);
  // 修改清单由“当前 hex ≠ 导入时 hex”派生，refs 数即该色的引用总数
  const changes = useMemo(
    () =>
      svg.colors
        .filter((c) => c.hex.toLowerCase() !== c.originalHex.toLowerCase())
        .map((c) => ({ sid: c.sid, from: c.originalHex, to: c.hex, refs: c.count })),
    [svg.colors],
  );
  const dirty = changes.length > 0;

  return (
    <section className="panel svg-preview-panel">
      <h2>
        SVG 修改预览
        <span className="hint">引用级同步改写，本地生成下载文件</span>
      </h2>

      <div className="svg-preview-grid">
        <SvgFrame svgText={svg.originalText} label="原始 SVG" />
        <SvgFrame svgText={svg.currentText} label={dirty ? '改写后 SVG' : '改写后 SVG（尚未修改）'} />
      </div>

      {dirty ? (
        <div className="svg-change-box">
          <div className="svg-change-title">已应用的颜色修改（{changes.length}）：</div>
          <ul className="svg-change-list">
            {changes.map((ch) => (
              <li key={ch.sid}>
                <span className="ch-chip" style={{ background: ch.from }} />
                <code>{ch.from}</code>
                <span className="ch-arrow">→</span>
                <span className="ch-chip" style={{ background: ch.to }} />
                <code>{ch.to}</code>
                <span className="ch-refs">{ch.refs} 处引用已改写</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="range-hint" style={{ margin: '8px 0 0' }}>
          在下方“替换色推荐”中选择待替换色并应用候选色后，这里会同步显示改写结果。
        </p>
      )}

      <div className="row-actions" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={!dirty} onClick={() => onDownload(svg.currentText, downloadName)}>
          ⬇ 下载修改后 SVG
        </button>
        <button className="btn" disabled={!dirty} onClick={onReset}>
          ↺ 还原全部修改
        </button>
      </div>
      <p className="range-hint" style={{ marginTop: 6 }}>
        下载文件：<code>{downloadName}</code>，原始文件始终保留在本机，不会被覆盖。
      </p>
    </section>
  );
}
