import { spawn } from 'node:child_process';
import path from 'node:path';

const python = process.env.CLIENTHUB_PYTHON || process.env.PYTHON || 'python';
const script = path.join(process.cwd(), 'services', 'ai', 'main.py');

const child = spawn(python, [script, '--host', '127.0.0.1', '--port', '8765'], {
  stdio: 'inherit',
  env: { ...process.env },
});

const shutdown = (signal) => {
  if (!child.killed) child.kill(signal);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
child.on('exit', (code) => process.exit(code ?? 0));
