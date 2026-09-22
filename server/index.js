import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import {
  MODES,
  analyzePalette,
  recommendReplacement,
} from './color-core.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 3000;
const DEFAULT_MODES = MODES.map((m) => m.id);

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

function parseBody(body) {
  const colors = body.colors;
  if (!Array.isArray(colors) || colors.length < 2 || colors.length > 8) {
    throw new Error('colors 必须是包含 2–8 个颜色的数组');
  }
  const modeIds = Array.isArray(body.modes) && body.modes.length ? body.modes : DEFAULT_MODES;
  const threshold = Number(body.threshold);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw new Error('threshold 必须是正数');
  }
  let severity = body.severity === undefined || body.severity === null ? 0.6 : Number(body.severity);
  if (!Number.isFinite(severity) || severity < 0 || severity > 1) {
    throw new Error('severity 必须在 0–1 之间');
  }
  return { colors, modeIds, threshold, severity };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, modes: MODES });
});

app.post('/api/analyze', (req, res) => {
  try {
    const { colors, modeIds, threshold, severity } = parseBody(req.body || {});
    res.json(analyzePalette({ colors, modeIds, threshold, severity }));
  } catch (e) {
    return badRequest(res, e.message);
  }
});

app.post('/api/recommend', (req, res) => {
  try {
    const { colors, modeIds, threshold, severity } = parseBody(req.body || {});
    const targetIndex = Number(req.body.targetIndex);
    if (!Number.isInteger(targetIndex)) {
      throw new Error('targetIndex 必须是整数');
    }
    const limit = req.body.limit === undefined ? 12 : Number(req.body.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 64) {
      throw new Error('limit 必须是 1–64 的整数');
    }
    res.json(
      recommendReplacement({
        colors,
        modeIds,
        threshold,
        severity,
        targetIndex,
        limit,
      }),
    );
  } catch (e) {
    return badRequest(res, e.message);
  }
});

// 生产环境托管 React 构建产物
const distDir = join(__dirname, '..', 'client', 'dist');
if (process.env.NODE_ENV === 'production' && existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (_req, res) => res.sendFile(join(distDir, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`色觉安全图例校验台服务已启动: http://localhost:${PORT}`);
});
