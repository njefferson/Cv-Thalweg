/* A static server for public/, for local work only.
 *   node tools/serve.mjs [port]
 * Cloudflare Pages serves these files as-is; nothing here is a build step.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');
const port = Number(process.argv[2] || 8787);
const TYPES = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json',
  '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml',
  '.png':'image/png', '.geojson':'application/geo+json'
};

createServer(async (req, res) => {
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
