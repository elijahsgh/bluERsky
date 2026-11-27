import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = 5173;
const URL = `http://localhost:${PORT}`;

const viteBin = resolve(process.cwd(), 'node_modules/.bin/vite');
const localSim = resolve(
  process.cwd(),
  '../node_modules/@evenrealities/evenhub-simulator/bin/index.js',
);

const vite = spawn(viteBin, ['--port', String(PORT), '--strictPort'], {
  stdio: 'inherit',
});

let sim = null;

function cleanup(code = 0) {
  if (sim && !sim.killed) sim.kill('SIGTERM');
  if (!vite.killed) vite.kill('SIGTERM');
  process.exit(code);
}

process.on('SIGINT', () => cleanup(0));
process.on('SIGTERM', () => cleanup(0));

vite.on('exit', (code) => {
  if (code && code !== 0) {
    console.error(`Vite exited with code ${code}`);
    cleanup(code);
  }
});

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Server not ready yet.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

try {
  await waitForServer(URL);
  if (existsSync(localSim)) {
    sim = spawn(process.execPath, [localSim, URL], { stdio: 'inherit' });
  } else {
    sim = spawn('evenhub-simulator', [URL], { stdio: 'inherit' });
  }
  sim.on('exit', (code) => cleanup(code ?? 0));
} catch (err) {
  console.error((err instanceof Error ? err.message : String(err)));
  cleanup(1);
}
