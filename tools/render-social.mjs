/* social-card.html -> social-preview.png, 1280x640 at 2x, which is the size
 * GitHub asks for. Upload it by hand: repo -> Settings -> General -> Social
 * preview. No session can set it, so METADATA.md carries the row.
 *
 *   node tools/render-social.mjs
 */
import { chromium } from 'playwright-core';
import { chromiumLaunch } from './lib-browser.mjs';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({
  ...chromiumLaunch() });
const page = await browser.newPage({
  viewport: { width: 1280, height: 640 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(join(root, 'social-card.html')).href, { waitUntil: 'load' });
await page.screenshot({ path: join(root, 'social-preview.png'),
  clip: { x: 0, y: 0, width: 1280, height: 640 } });
await browser.close();
console.log('social-preview.png written');
