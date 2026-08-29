/* Where Chromium is.
 *
 * The sandbox this app was built in ships a browser at a fixed path and sets
 * PLAYWRIGHT_BROWSERS_PATH to match, so every walk here launched with
 * executablePath:'/opt/pw-browsers/chromium' — a path that exists on exactly
 * one machine. The first CI run said so: the suites cannot run anywhere the
 * browser is not at that address, which is every runner and every laptop.
 *
 * So the path is used when it is there and Playwright resolves its own
 * download when it is not, and --no-sandbox is only passed when running as
 * root, because it is a real weakening and a runner does not need it.
 */
import { existsSync } from 'node:fs';

const PINNED = '/opt/pw-browsers/chromium';

export function chromiumLaunch(extra = {}) {
  const args = ['--no-sandbox'].concat(extra.args || []);
  const opts = { ...extra, args };
  if (existsSync(PINNED)) opts.executablePath = PINNED;
  return opts;
}

/* The offline walks cut the browser's own egress by pointing it at a proxy
   that is not there, while letting the local server through. */
export const OFFLINE_ARGS = [
  '--proxy-server=http://127.0.0.1:1',
  '--proxy-bypass-list=127.0.0.1;localhost;[::1]'
];
