import React, { useCallback, useRef, useState } from 'react';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

const SKIP_REASON_LABEL = {
  keyword: 'currentColor / inherit',
  reference: '渐变 / 图案引用（url(#…)）',
  alpha: '半透明色（alpha < 1）',
  unsupported: '不支持的写法（具名色等）',
};

const FAMILY_LABEL = { hex: 'HEX', rgb: 'RGB', hsl: 'HSL' };

/**
 * SVG 图例导入面板。
 * 文件仅在浏览器内读取解析，不发起任何上传请求。
 */
export default function SvgImportPanel({ svg, onFile, onToggleColor, onClear }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [localError, setLocalError] = useState(null);

  const handleFile = useCallback(
    async (file) => {
      setLocalError(null);
      if (!file) return;
      if (!/\.svg$/i.test(file.name) && file.type && file.type !== 'image/svg+xml') {
        setLocalError('请选择 .svg 格式的图例文件');
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        setLocalError('文件过大（> 5MB），请精简后再导入');
        return;
      }
      try {
        const text = await file.text();
        await onFile({ name: file.name, size: file.size, text });
      } catch (e) {
        setLocalError(e.message || '读取文件失败');
      }
    },
    [onFile],
  );

  return (
    <section className="panel svg-import">
      <h2>
        SVG 图例导入
        <span className="hint">本地解析，文件不上传服务器</span>
      </h2>

      {!svg ? (
        <>
          <div
            className={`drop-zone ${dragOver ? 'over' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFile(e.dataTransfer.files?.[0]);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
          >
            <div className="drop-icon">📄</div>
            <div className="drop-main">点击选择或拖入本地 .svg 图例文件</div>
            <div className="drop-sub">
              解析 fill / stroke 属性与内联 style 中的 HEX、RGB、HSL 纯色；
              忽略 none、currentColor、渐变与外链资源
            </div>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".svg,image/svg+xml"
            hidden
            onChange={(e) => {
              handleFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {localError && <div className="error-box" style={{ marginTop: 10, marginBottom: 0 }}>⚠ {localError}</div>}
        </>
      ) : (
        <ImportedSvgCard svg={svg} onToggleColor={onToggleColor} onClear={onClear} localError={localError} />
      )}
    </section>
  );
}

function ImportedSvgCard({ svg, onToggleColor, onClear, localError }) {
  const selected = svg.selected.length;
  const total = svg.colors.length;
  return (
    <div className="svg-card">
      <div className="svg-file-line">
        <span className="svg-file-name" title={svg.fileName}>📎 {svg.fileName}</span>
        <button className="icon-btn" title="移除 SVG，恢复手动编辑" onClick={onClear}>✕</button>
      </div>

      <p className="range-hint" style={{ margin: '6px 0 0' }}>
        扫描 {svg.stats.elements} 个图形元素，归一化去重后得到 <b>{total}</b> 个纯色、
        共 {svg.stats.refs} 处 fill/stroke 引用；
        已勾选 <b>{selected}</b> 个进入下方调色板校验（2–8 色）。
      </p>

      {selected < 2 && (
        <div className="error-box" style={{ marginTop: 8, marginBottom: 0 }}>
          ⚠ 当前仅选择 {selected} 个颜色，至少勾选 2 个颜色后才会进入校验
        </div>
      )}
      {selected > 8 && (
        <div className="error-box" style={{ marginTop: 8, marginBottom: 0 }}>
          ⚠ 最多选择 8 个颜色进入校验，请取消 {selected - 8} 个
        </div>
      )}
      {localError && <div className="error-box" style={{ marginTop: 8, marginBottom: 0 }}>⚠ {localError}</div>}

      <ul className="svg-color-list">
        {svg.colors.map((c) => {
          const checked = svg.selected.includes(c.sid);
          const disabled = !checked && selected >= 8;
          return (
            <li key={c.sid}>
              <label className={disabled ? 'disabled' : ''}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onToggleColor(c.sid)}
                />
                <span className="svg-swatch" style={{ background: c.hex }} />
                <span className="svg-hex">{c.hex}</span>
                <span className="svg-ref-count">
                  {c.count} 处
                  <span className="svg-attr-detail">
                    {c.attrs.fill > 0 && ` fill×${c.attrs.fill}`}
                    {c.attrs.stroke > 0 && ` stroke×${c.attrs.stroke}`}
                  </span>
                </span>
                <span className="svg-families">
                  {[...new Set(c.refs.map((r) => FAMILY_LABEL[familyOf(r.raw)]))].filter(Boolean).join('/')}
                </span>
              </label>
              <div className="svg-refs" title={c.elements.join('、')}>
                {c.elements.slice(0, 3).map((n) => (
                  <code key={n}>{n}</code>
                ))}
                {c.elements.length > 3 && <code>+{c.elements.length - 3}</code>}
              </div>
            </li>
          );
        })}
      </ul>

      {svg.stats.skipped.length > 0 && (
        <p className="range-hint skipped-note">
          已忽略：
          {svg.stats.skipped.map((s) => (
            <span key={s.reason} className="skip-tag">
              {SKIP_REASON_LABEL[s.reason] || s.reason} ×{s.count}
            </span>
          ))}
        </p>
      )}
      <p className="range-hint" style={{ marginTop: 4 }}>
        勾选颜色会实时同步到调色板；应用推荐替换色时，将同步改写该颜色在 SVG 中的全部引用。
      </p>
    </div>
  );
}

function familyOf(raw) {
  const v = String(raw).trim();
  if (/^#/i.test(v)) return 'hex';
  if (/^rgb/i.test(v)) return 'rgb';
  if (/^hsl/i.test(v)) return 'hsl';
  return '';
}
