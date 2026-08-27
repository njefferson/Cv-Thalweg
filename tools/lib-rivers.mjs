/* Read the RIVERS array out of public/index.html.
 *
 * The tools must not keep their own copy of the river data — that is the
 * whole point of RIVERS being the only place river-specific values live.
 * So they read the literal out of the app and evaluate it, which fails
 * loudly if the shape ever changes rather than quietly going out of date.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const APP = join(here, '..', 'public', 'index.html');

function grab(src, name) {
  const start = src.indexOf('var ' + name + ' = ');
  if (start === -1) throw new Error('could not find ' + name + ' in index.html');
  const open = src.indexOf(name === 'RIVERS' ? '[' : '{', start);
  let depth = 0, i = open, inStr = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(open, i + 1);
}

const src = readFileSync(APP, 'utf8');
export const PROV = new Function('return ' + grab(src, 'PROV'))();
export const RIVERS = new Function('PROV', 'return ' + grab(src, 'RIVERS'))(PROV);
export const SEASON = new Function('PROV', 'return ' + grab(src, 'SEASON_ADOPTION'))(PROV);

export function bathyProxy() {
  const m = src.match(/var BATHY_PROXY\s*=\s*'([^']*)'/);
  return m ? m[1] : '';
}
