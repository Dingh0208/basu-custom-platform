import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';

const python = process.env.CLIENTHUB_PYTHON || process.env.PYTHON || 'python';
const script = path.join(process.cwd(), 'services', 'ai', 'main.py');

const child = spawn(python, [script, '--host', '127.0.0.1', '--port', '8765', '--parent-pid', String(process.pid)], {
  stdio: 'inherit',
  env: { ...process.env },
  windowsHide: true,
});

function killChildTree(signal) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } catch {
      // Already exited.
    }
    return;
  }
  if (!child.killed) child.kill(signal);
}

const shutdown = (signal) => {
  killChildTree(signal);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGBREAK', () => shutdown('SIGBREAK'));
process.on('exit', () => killChildTree('SIGTERM'));
child.on('exit', (code) => process.exit(code ?? 0));
