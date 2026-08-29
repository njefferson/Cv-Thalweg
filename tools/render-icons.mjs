/* Rasterise icon.svg into the PNGs the manifest and iOS need.
 * The SVG is the source; these are artefacts. Re-run after editing it.
 *   node tools/render-icons.mjs
 */
import { chromium } from 'playwright-core';
import { chromiumLaunch } from './lib-browser.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const svg = readFileSync(join(dir, 'icon.svg'), 'utf8');
const browser = await chromium.launch({ ...chromiumLaunch() });

for (const [file, s] of Object.entries({ 'icon-180.png': 180, 'icon-192.png': 192, 'icon-512.png': 512 })) {
  const page = await browser.newPage({ viewport: { width: s, height: s }, deviceScaleFactor: 1 });
  await page.setContent(`<style>*{margin:0}html,body{width:${s}px;height:${s}px;background:#0A1214}svg{display:block;width:${s}px;height:${s}px}</style>${svg}`, { waitUntil: 'load' });
  await page.screenshot({ path: join(dir, file), clip: { x: 0, y: 0, width: s, height: s } });
  await page.close();
}

/* Maskable: full bleed, artwork inside the central 80% so a launcher can
   crop it to a circle without taking a bite out of the channel. */
const s = 512, inset = Math.round(s * 0.1);
const page = await browser.newPage({ viewport: { width: s, height: s }, deviceScaleFactor: 1 });
await page.setContent(`<style>*{margin:0}html,body{width:${s}px;height:${s}px;background:#0A1214}
 .w{position:absolute;left:${inset}px;top:${inset}px;width:${s - 2 * inset}px;height:${s - 2 * inset}px}
 svg{display:block;width:100%;height:100%}</style><div class="w">${svg}</div>`, { waitUntil: 'load' });
await page.screenshot({ path: join(dir, 'icon-512-maskable.png'), clip: { x: 0, y: 0, width: s, height: s } });
await browser.close();
console.log('icons rendered');
