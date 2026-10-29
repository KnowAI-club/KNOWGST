import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const root = resolve(import.meta.dirname, '..');
const webPort = Number(process.env.KNOWGST_WEB_PORT || 4173);
const webHost = `127.0.0.1:${webPort}`;
const secret = randomBytes(32).toString('hex');
const child = fork(resolve(root, 'apps/parity/server.js'), [], {
  env: { ...process.env, KNOWGST_PORT: '0', KNOWGST_LOCAL_SECRET: secret, KNOWGST_RUNTIME: process.env.KNOWGST_RUNTIME ?? resolve(root, '.local/parity') },
  stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
});
const port = await new Promise<number>((resolvePort, reject) => {
  const timer = setTimeout(() => { child.kill(); reject(new Error('Local service startup timed out')); }, 15000);
  child.once('error', error => { clearTimeout(timer); reject(error); });
  child.once('exit', code => { clearTimeout(timer); reject(new Error(`Local service exited: ${code}`)); });
  child.on('message', (message: unknown) => {
    const value = message as { type?: string; port?: number };
    if (value.type === 'ready' && typeof value.port === 'number') { clearTimeout(timer); resolvePort(value.port); }
  });
});
let web: Awaited<ReturnType<typeof createServer>>;
try {
  web = await createServer({ root: resolve(root, 'apps/parity'), server: { host: '127.0.0.1', port: webPort, strictPort: true,
    proxy: { '/api': { target: `http://127.0.0.1:${port}`, headers: { 'x-knowgst-key': secret } } },
  }, plugins: [{ name: 'local-origin-guard', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith('/api')) return next();
      if (req.headers.host !== webHost || (req.headers.origin && req.headers.origin !== `http://${webHost}`) || req.headers['sec-fetch-site'] === 'cross-site') { res.statusCode = 403; res.end('Origin not allowed'); return; }
      next();
    });
  } }] });
  await web.listen();
} catch (error) { child.kill(); throw error; }
console.log(`KNOWGST parity workspace: http://${webHost}`);
let stopping = false;
async function stop() { if (stopping) return; stopping = true; await web.close(); child.kill('SIGTERM'); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
child.once('exit', async () => { if (!stopping) { await web.close(); process.exitCode = 1; } });
