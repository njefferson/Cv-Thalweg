#!/usr/bin/env node
/* fetch-widths — how wide the river is, along its own course, baked.
 *
 * The down-river profile draws the DEPTH along the centreline. This adds the
 * other dimension of the same channel: how far it is from bank to bank at each
 * point, so a reader can see a narrows and a wide flat for what they are rather
 * than inferring them from a depth line.
 *
 * WHERE IT COMES FROM. USGS's National Hydrography Dataset, the large-scale
 * Area layer — the polygon of the mapped water surface, compiled at 1:24,000.
 * The width is measured by casting a line across the river, perpendicular to
 * the local course, and taking the distance between the two nearest bank
 * crossings.
 *
 * WHAT THAT NUMBER IS AND IS NOT, and both halves have to reach the reader.
 * It is the width of the channel AS MAPPED, at the scale it was mapped at and
 * on the day it was compiled. It is not a measurement of today's water: the
 * river is wider in a flood and narrower in a drought, and NHD does not move
 * with the stage. Bars, benches and shallow margins are inside the mapped
 * polygon, so this is bank to bank rather than the width of navigable water —
 * which is the same relationship the depth surveys have to a safe channel, and
 * the same reason neither is for navigation.
 *
 * WHERE IT REFUSES TO ANSWER. Two cases, and neither prints a number.
 *   · The cast leaves the mapped water on one side and does not come back
 *     inside the cap — a confluence, a flooded bypass, the Delta, anywhere the
 *     idea of "the width here" has no single answer.
 *   · The centreline point is not inside any mapped polygon at all. USGS's
 *     flowline and USGS's area polygon are two different products and they do
 *     not always agree; where they disagree this app says nothing rather than
 *     measuring from the wrong bank.
 *
 *   node tools/fetch-widths.mjs           # fetch and write
 *   node tools/fetch-widths.mjs --check   # verify what is committed
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/* Hub LESSONS §173 — Node's fetch reads the proxy env at STARTUP. */
if (!process.env.NODE_USE_ENV_PROXY &&
    (process.env.HTTPS_PROXY || process.env.https_proxy)) {
  const r = spawnSync(process.execPath, [import.meta.filename, ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(r.status === null ? 1 : r.status);
}

const repo = (() => { const i = process.argv.indexOf('--repo');
  return i === -1 ? process.cwd() : process.argv[i + 1]; })();
const APP = join(repo, 'public', 'index.html');
const LINES_FILE = join(repo, 'public', 'river-lines.js');
const OUT = join(repo, 'public', 'river-widths.js');
const CHECK = process.argv.includes('--check');

const SERVICE = 'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/9';
/* FTYPE 460 is StreamRiver — the mapped surface of a river. Canals, ditches and
   lakes are deliberately not included: a canal beside the Sacramento is not the
   Sacramento, and taking the nearest crossing without this filter would measure
   across whichever water happened to be closest. */
const FTYPE_STREAM_RIVER = 460;

/* THE CAP. Past this the cast has left the channel — a confluence, a bypass, a
   Delta junction — and the honest answer is that there is no single width here.
   1200 m is comfortably wider than any reach of these rivers and narrow enough
   that a cast into open water fails rather than finding a far bank a kilometre
   away that belongs to something else. */
const MAX_HALF_M = 1200;
/* EVERY SECOND POINT. One in four was tried first and measured: the surveyed
   run on the Sacramento is 31 km, and at one sample every 1.2 km that left
   TWELVE points to draw a line through — a chart too coarse to show the thing
   it exists to show. At one in two it is about 600 m between samples and the
   file is still small enough to ship. */
const EVERY = 2;

const KY = 110540;
const kx = lat => 111320 * Math.cos(lat * Math.PI / 180);

function rivers() {
  const src = readFileSync(APP, 'utf8');
  const start = src.indexOf('var RIVERS = [');
  let i = src.indexOf('[', start), depth = 0, end = -1;
  for (let k = i; k < src.length; k++) {
    if (src[k] === '[') depth++;
    else if (src[k] === ']') { depth--; if (!depth) { end = k + 1; break; } }
  }
  const PROV = { VERIFIED: 'verified', CORROBORATED: 'corroborated', FOUND: 'found' };
  return new Function('PROV', 'return ' + src.slice(i, end))(PROV);
}
function lines() {
  if (!existsSync(LINES_FILE)) return null;
  const src = readFileSync(LINES_FILE, 'utf8');
  return new Function(src + '; return typeof RIVER_LINES !== "undefined" ? RIVER_LINES : null;')();
}

async function ask(box) {
  const p = new URLSearchParams({
    f: 'json', where: 'FTYPE=' + FTYPE_STREAM_RIVER,
    outFields: 'OBJECTID', returnGeometry: 'true', outSR: '4326',
    geometryType: 'esriGeometryEnvelope', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', geometry: box.join(','),
    resultRecordCount: '200'
  });
  const r = await fetch(SERVICE + '/query?' + p, { signal: AbortSignal.timeout(180000) });
  if (!r.ok) throw new Error('USGS answered HTTP ' + r.status);
  const j = await r.json();
  if (j.error) throw new Error('USGS: ' + JSON.stringify(j.error).slice(0, 200));
  return j.features || [];
}

/* A GRID OF EDGES. The Sacramento's polygon is 135 rings and forty-nine
   thousand points; asking every edge about every cast is a hundred million
   tests and several minutes. Bucketing the edges by a hundredth of a degree
   turns each cast into a handful. */
function index(features) {
  const cell = 0.01, grid = new Map();
  let edges = 0;
  const put = (key, e) => { const b = grid.get(key); if (b) b.push(e); else grid.set(key, [e]); };
  for (const f of features)
    for (const ring of (f.geometry && f.geometry.rings) || [])
      for (let i = 0; i + 1 < ring.length; i++) {
        const a = ring[i], b = ring[i + 1];
        const e = { ax: a[0], ay: a[1], bx: b[0], by: b[1] };
        edges++;
        const x0 = Math.floor(Math.min(a[0], b[0]) / cell), x1 = Math.floor(Math.max(a[0], b[0]) / cell);
        const y0 = Math.floor(Math.min(a[1], b[1]) / cell), y1 = Math.floor(Math.max(a[1], b[1]) / cell);
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) put(x + ':' + y, e);
      }
  return { cell, grid, edges,
    near(x0, y0, x1, y1) {
      const out = new Set();
      const ax = Math.floor(Math.min(x0, x1) / cell), bx = Math.floor(Math.max(x0, x1) / cell);
      const ay = Math.floor(Math.min(y0, y1) / cell), by = Math.floor(Math.max(y0, y1) / cell);
      for (let x = ax; x <= bx; x++) for (let y = ay; y <= by; y++) {
        const b = grid.get(x + ':' + y);
        if (b) for (const e of b) out.add(e);
      }
      return out;
    } };
}

/* Where a segment crosses the cast, as a distance along it. Returns null when
   they do not cross. */
function cross(px, py, ux, uy, half, e) {
  const rx = ux * half, ry = uy * half;          /* the cast, from -1 to +1 of r */
  const sx = e.bx - e.ax, sy = e.by - e.ay;
  const d = rx * sy - ry * sx;
  if (!d) return null;
  const qpx = e.ax - px, qpy = e.ay - py;
  const t = (qpx * sy - qpy * sx) / d;           /* along the cast, -1..1       */
  const u = (qpx * ry - qpy * rx) / d;           /* along the edge, 0..1        */
  if (u < 0 || u > 1 || t < -1 || t > 1) return null;
  return t;
}

/* ---------------------------------------------------------------- check */
if (CHECK) {
  const fails = [];
  if (!existsSync(OUT)) {
    console.log('No public/river-widths.js. Run this without --check to make one.');
    process.exit(1);
  }
  const src = readFileSync(OUT, 'utf8');
  const meta = new Function(src + '; return typeof WIDTHS_META !== "undefined" ? WIDTHS_META : null;')();
  const w = new Function(src + '; return typeof RIVER_WIDTHS !== "undefined" ? RIVER_WIDTHS : null;')();
  const L = lines();
  if (!meta || !meta.fetchedAt) fails.push('no fetchedAt — nothing says when this was taken.');
  if (!meta || meta.source !== SERVICE)
    fails.push('the file names a different service than this generator asks: ' + (meta && meta.source));
  console.log('=== river widths, from USGS NHD ===\n');
  if (meta) console.log(`  fetched ${meta.fetchedAt}\n  from ${meta.source}\n`);
  let any = 0;
  for (const r of rivers()) {
    if (r.network) continue;
    const rows = (w && w[r.id]) || [];
    const line = L && L[r.id];
    if (!line) { fails.push(`${r.name}: no centreline to check the samples against.`); continue; }
    let measured = 0, refused = 0;
    for (const s of rows) {
      if (!Number.isInteger(s.i) || s.i < 0 || s.i >= line.length)
        fails.push(`${r.name}: a sample points at centreline index ${s.i}, which does not exist.`);
      if (s.m === null) { refused++; continue; }
      measured++;
      /* A WIDTH IS A WIDTH. Nothing on these rivers is two metres across or
         three kilometres, and a number outside that is the cast having found
         the wrong bank rather than a remarkable reach. */
      if (!(s.m > 5 && s.m <= MAX_HALF_M * 2))
        fails.push(`${r.name}: ${s.m} m at index ${s.i} is not a width of this river.`);
    }
    any += measured;
    console.log(`  ${r.name}: ${measured} measured, ${refused} refused (no single width there)`);
    /* A RIVER THAT MEASURES NOWHERE IS A FAILURE, not an empty result — it
       means the polygon and the centreline never agreed, and the app would
       show an empty chart with no explanation. */
    if (rows.length && !measured)
      fails.push(`${r.name}: every sample refused — the centreline and the polygon never agree.`);
  }
  if (!any) fails.push('not one width on any river — that is not a result, it is a failure.');
  if (fails.length) {
    console.log('\nFAILURES:'); fails.forEach(f => console.log('  ✗ ' + f));
    process.exit(1);
  }
  console.log('\nEvery sample points at a real place on the course and is a width or an honest refusal.');
  process.exit(0);
}

/* ---------------------------------------------------------------- fetch */
const L = lines();
if (!L) {
  console.log('public/river-lines.js is missing. Run tools/fetch-centrelines.mjs first —');
  console.log('the width is measured across the course, so there has to be a course.');
  process.exit(1);
}
const out = {};
for (const r of rivers()) {
  /* THE DELTA IS NOT MEASURED AND THE REASON IS THE FEATURE, NOT A GAP. It has
     no course to be perpendicular to: ninety-seven channels meet and part, and
     "the width of the Delta" is not a question with an answer. The app already
     refuses to profile down it for the same reason. */
  if (r.network) continue;
  const line = L[r.id];
  if (!line) { console.log(`  ${r.name}: no centreline, skipped.`); continue; }
  process.stdout.write(`  ${r.name}… `);
  const feats = await ask(r.bbox);
  const idx = index(feats);
  const rows = [];
  let measured = 0, outside = 0, uncapped = 0;
  for (let i = 0; i < line.length; i += EVERY) {
    const mid = line[i];
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    const k = kx(mid[0]);
    const dx = (b[1] - a[1]) * k, dy = (b[0] - a[0]) * KY;
    const len = Math.hypot(dx, dy);
    if (!len) { rows.push({ i, m: null }); continue; }
    /* The perpendicular, in metres, then back into degrees for the cast. */
    const ux = (-dy / len) / k, uy = (dx / len) / KY;
    const px = mid[1], py = mid[0];
    const x1 = px + ux * MAX_HALF_M, y1 = py + uy * MAX_HALF_M;
    const x0 = px - ux * MAX_HALF_M, y0 = py - uy * MAX_HALF_M;
    const cand = idx.near(x0, y0, x1, y1);
    let near = 0, far = 0, hits = 0;
    for (const e of cand) {
      const t = cross(px, py, ux, uy, MAX_HALF_M, e);
      if (t === null) continue;
      hits++;
      if (t > 0) { if (!far || t < far) far = t; }
      else if (t < 0) { if (!near || t > near) near = t; }
    }
    /* INSIDE OR NOTHING. A crossing on each side is what makes the point a
       point in a channel; one side empty means the cast started outside the
       mapped water, or ran to the cap without finding a bank. */
    if (!near || !far) { rows.push({ i, m: null }); (hits ? uncapped++ : outside++); continue; }
    const m = Math.round((far - near) * MAX_HALF_M);
    if (!(m > 5 && m <= MAX_HALF_M * 2)) { rows.push({ i, m: null }); uncapped++; continue; }
    rows.push({ i, m });
    measured++;
  }
  out[r.id] = rows;
  console.log(`${measured} measured, ${outside} outside the mapped water, ` +
    `${uncapped} with no single width — from ${idx.edges} polygon edges`);
}

const all = Object.values(out).flat().filter(s => s.m !== null).map(s => s.m);
const body = `/* GENERATED by tools/fetch-widths.mjs — do not edit.
 *
 * How wide each river is along its own course, measured across USGS's National
 * Hydrography Dataset polygon of the mapped water surface, compiled at
 * 1:24,000. Sampled every ${EVERY} points of the centreline in public/river-lines.js;
 * \`i\` is the index into that line and \`m\` is the width in metres.
 *
 * THIS IS THE MAPPED CHANNEL, NOT TODAY'S WATER. The river is wider in a flood
 * and narrower in a drought and this does not move with the stage. It is bank
 * to bank, so bars and shallow margins are inside it — the same relationship
 * the depth surveys have to navigable water, and the same reason neither is for
 * navigation.
 *
 * \`m: null\` is a REFUSAL, not a gap in the download: the cast either found no
 * far bank inside ${MAX_HALF_M} m — a confluence, a bypass, a junction, where "the
 * width here" has no single answer — or started outside the mapped polygon,
 * because the flowline and the area polygon are two USGS products and they do
 * not always agree.
 *
 * The Delta is absent on purpose. It has no course to be perpendicular to.
 */
var WIDTHS_META = {
  fetchedAt: '${new Date().toISOString()}',
  source: '${SERVICE}',
  every: ${EVERY},
  capM: ${MAX_HALF_M * 2},
  narrowest: ${Math.min(...all)},
  widest: ${Math.max(...all)}
};
var RIVER_WIDTHS = {
${Object.entries(out).map(([k, v]) =>
  `  ${k}: [\n` + v.map(s => '    ' + JSON.stringify(s)).join(',\n') + '\n  ]').join(',\n')}
};
`;
writeFileSync(OUT, body);
console.log(`\nWrote ${OUT} — ${(body.length / 1024).toFixed(1)} KB`);
