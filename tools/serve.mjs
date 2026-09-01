/* A static server for public/, for local work only.
 *   node tools/serve.mjs [port]
 * Cloudflare Pages serves these files as-is; nothing here is a build step.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

/* THE SIXTH TOOL HERE TO NEED THESE THREE LINES (hub LESSONS 173 and 201).
   This server is not only static: it runs worker.js's `handle` at /bathy,
   exactly as Pages does, and that calls Node's own fetch — which ignores
   HTTPS_PROXY unless NODE_USE_ENV_PROXY is set, read at STARTUP. Without it
   the proxy answered HTTP 403 for DWR's bathymetry AND for CDEC, which the
   app routes through the same path, so the live suite reported nine failures
   about missing surveys and a Feather with no flow. Every one of those was
   this file, and none of them said so. */
/* AND UNLIKE THE BAKE TOOLS, THIS ONE HAS TO FORWARD SIGNALS. They re-exec
   and exit; this is a long-running server that CI and every walk stop with
   `kill $!` — and `$!` is the PARENT. A child that outlives the kill keeps
   port 8787, so the next run cannot bind it and the suite after it measures a
   server it did not start, from a tree it does not know. Forward the signal,
   and leave when the child leaves. */
const REEXEC = !process.env.NODE_USE_ENV_PROXY &&
  !!(process.env.HTTPS_PROXY || process.env.https_proxy);
if (REEXEC) {
  const child = spawn(process.execPath, [import.meta.filename, ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'])
    process.on(sig, () => { try { child.kill(sig); } catch { /* already gone */ } });
  child.on('exit', (code, sig) => process.exit(sig ? 1 : (code == null ? 1 : code)));
}
import { handle } from '../worker.js';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Workers have caches.default; Node does not. A Map is enough for local
   work — it is the same code path, just without the edge. */
if (!globalThis.caches) {
  const store = new Map();
  globalThis.caches = { default: {
    async match(req) { const hit = store.get(req.url); return hit && hit.clone(); },
    async put(req, res) { store.set(req.url, res.clone()); }
  } };
}

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');
const port = Number(process.argv[2] || 8787);
const TYPES = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json',
  '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml',
  '.png':'image/png', '.geojson':'application/geo+json'
};

if (!REEXEC) createServer(async (req, res) => {
  /* Serve the bathymetry proxy at /bathy, exactly as Pages does through
     functions/bathy/[[path]].js, so local work and production take the
     same path through the same allow-list. */
  if (req.url.startsWith('/bathy/') || req.url === '/bathy') {
    const ctx = { waitUntil(p) { return p; } };
    const out = await handle(new Request('http://127.0.0.1:' + port + req.url), ctx, '/bathy');
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
    return;
  }
  /* Mirror the /version function too, so tools/check-deploy.mjs can be
     run against a local server before it is run against the real one. */
  if (req.url.split('?')[0] === '/version') {
    const { onRequest } = await import('../functions/version.js');
    const out = await onRequest({ request: new Request('http://127.0.0.1:' + port + '/version'), env: process.env });
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
    return;
  }

  let p = normalize(decodeURIComponent(req.url.split('?')[0]));
  if (p.includes('..')) { res.writeHead(403).end('no'); return; }
  if (p.endsWith('/')) p += 'index.html';
  const file = join(root, p);
  try {
    await stat(file);
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type':'text/plain' }).end('not found');
  }
}).listen(port, () => console.log('Thalweg on http://127.0.0.1:' + port));
