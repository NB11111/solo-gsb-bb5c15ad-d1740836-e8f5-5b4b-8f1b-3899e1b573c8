/**
 * 本地开发并行启动器：Express(3000) + Vite(5173，/api 代理到 3000)
 */
import { spawn } from 'node:child_process';

const procs = [
  {
    name: 'express',
    cmd: 'node',
    args: ['--watch', 'server/index.js'],
    color: '\x1b[36m',
  },
  {
    name: 'vite',
    cmd: 'npm',
    args: ['exec', 'vite', '--', '--config', 'client/vite.config.js'],
    color: '\x1b[35m',
  },
];

const children = procs.map((p) => {
  const child = spawn(p.cmd, p.args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = `${p.color}[${p.name}]\x1b[0m `;
  const tag = (buf) =>
    buf
      .toString()
      .split('\n')
      .filter(Boolean)
      .forEach((line) => process.stdout.write(prefix + line + '\n'));
  child.stdout.on('data', tag);
  child.stderr.on('data', tag);
  return child;
});

const shutdown = () => {
  for (const c of children) c.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
