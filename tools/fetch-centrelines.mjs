#!/usr/bin/env node
/* fetch-centrelines — the river's own line, baked at build time.
 *
 * The profile could only ever follow a line the READER drew, because this app
 * had no centreline and its standing rule is that no coordinate is invented
 * here. This fetches one, from USGS, once, and ships it — the same shape as
 * tools/fetch-stations.mjs: the reader pays nothing and it works with no
 * signal.
 *
 * WHY NHDPlus HIGH RESOLUTION AND NOT `nhd`. Both publish flowlines; only
 * NHDPlus carries the network attributes that turn a heap of segments into a
 * line. `nhd` layer 6 returns 2,848 features in one small box near Rio Vista
 * with nothing to order them by. NHDPlus layer 3 carries `levelpathi` (which
 * main stem a segment belongs to) and `pathlength` (how far its downstream end
 * is from the outlet), and those two answer both questions: which segments are
 * the river rather than its sloughs, and what order they go in.
 *
 * The Sacramento comes back as 917 segments under its own name, of which 719
 * share one levelpath and run 597.6 km. The other 198 are side channels
 * carrying the same name.
 *
 *   node tools/fetch-centrelines.mjs           # fetch and write
 *   node tools/fetch-centrelines.mjs --check   # verify what is committed
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const repo = (() => { const i = process.argv.indexOf('--repo');
  return i === -1 ? process.cwd() : process.argv[i + 1]; })();
const APP = join(repo, 'public', 'index.html');
const OUT = join(repo, 'public', 'river-lines.js');
const CHECK = process.argv.includes('--check');

const SERVICE = 'https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer/3';
/* Every 400 m. Fine enough to follow a bend on a river a few hundred metres
   wide, coarse enough that four rivers do not become a download. */
const SPACING_M = 400;

function appSource() { return readFileSync(APP, 'utf8'); }

/* The rivers, by evaluating the declaration rather than pattern-matching it —
   a regex over this array found two of four with the wrong flags when the
   station generator tried it. */
function rivers() {
  const src = appSource();
  const start = src.indexOf('var RIVERS = [');
  let i = src.indexOf('[', start), depth = 0, end = -1;
  for (let k = i; k < src.length; k++) {
    if (src[k] === '[') depth++;
    else if (src[k] === ']') { depth--; if (!depth) { end = k + 1; break; } }
  }
  const PROV = { VERIFIED: 'verified', CORROBORATED: 'corroborated', FOUND: 'found' };
  return new Function('PROV', 'return ' + src.slice(i, end))(PROV);
}

const R = 6371000;
const rad = d => d * Math.PI / 180;
function metres(a, b) {
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function ask(params) {
  const url = SERVICE + '/query?' + new URLSearchParams(params);
  const r = await fetch(url, { signal: AbortSignal.timeout(240000) });
  if (!r.ok) throw new Error('USGS answered HTTP ' + r.status);
  const j = await r.json();
  if (j.error) throw new Error('USGS: ' + JSON.stringify(j.error).slice(0, 200));
  return j;
}

/* Which levelpath IS the river. The one carrying the most length under this
   name — side channels share the name and are shorter. */
async function mainStem(name) {
  const j = await ask({ f: 'json', where: `gnis_name='${name.replace(/'/g, "''")}'`,
    outFields: 'levelpathi,lengthkm', returnGeometry: 'false', resultRecordCount: '4000' });
  const by = {};
  (j.features || []).forEach(f => {
    const a = f.attributes;
    if (a.levelpathi == null) return;
    by[a.levelpathi] = (by[a.levelpathi] || 0) + (a.lengthkm || 0);
  });
  const rows = Object.entries(by).sort((a, b) => b[1] - a[1]);
  if (!rows.length) throw new Error('no flowline named ' + name);
  return { path: rows[0][0], km: rows[0][1], candidates: rows.length,
           segments: (j.features || []).length };
}

async function stemGeometry(name, levelpath) {
  const j = await ask({ f: 'json',
    where: `gnis_name='${name.replace(/'/g, "''")}' AND levelpathi=${levelpath}`,
    outFields: 'pathlength', returnGeometry: 'true', outSR: '4326',
    resultRecordCount: '4000' });
  const segs = (j.features || []).map(f => ({
    at: f.attributes.pathlength,
    pts: ((f.geometry && f.geometry.paths) || []).flat().map(p => [p[1], p[0]])
  })).filter(s => s.pts.length > 1 && s.at != null);
  /* Mouth first, because this app draws rivers with downstream on the left and
     the profile has to agree with the ribbon above it. pathlength is measured
     to the outlet, so ascending IS downstream-first. */
  segs.sort((a, b) => a.at - b.at);
  return segs;
}

/* Chain them, choosing each segment's direction by which of its ends is nearer
   the line so far. NHD digitises in the direction of flow, so a run ordered
   from the mouth has every segment pointing the wrong way — rather than assume
   that, each is turned whichever way actually joins. */
function chain(segs) {
  if (!segs.length) return { line: [], runs: [], worst: 0, cuts: 0 };
  let run = segs[0].pts.slice();
  if (segs[1] && metres(run[0], segs[1].pts[0]) < metres(run[run.length - 1], segs[1].pts[0]))
    run.reverse();
  const runs = [];
  let worst = 0, cuts = 0;
  for (let i = 1; i < segs.length; i++) {
    const end = run[run.length - 1];
    const p = segs[i].pts;
    const fwd = metres(end, p[0]), rev = metres(end, p[p.length - 1]);
    const join = Math.min(fwd, rev);
    const use = fwd <= rev ? p : p.slice().reverse();
    if (join > MAX_JOIN_M) {
      /* Not a bend. A different channel. */
      runs.push(run); run = use.slice(); cuts++;
      worst = Math.max(worst, join);
      continue;
    }
    run = run.concat(use.slice(1));
  }
  runs.push(run);
  const best = runs.slice().sort((a, b) => b.length - a.length)[0];
  return { line: best, runs, worst, cuts,
           dropped: runs.reduce((n, r) => n + r.length, 0) - best.length };
}

/* A LINE THAT TELEPORTS IS NOT A RIVER. The Mokelumne came back with all 326
   of its segments under one levelpath and a 12.4 km jump in the middle of the
   chain — it forks in the Delta, so "the main stem" spans two channels that do
   not touch. Sorting by distance-to-outlet cannot see that, and neither can
   any single number: what shows it is the join itself being impossible.
   So the chain is cut wherever a join is longer than a river bend could be,
   and the longest continuous run is what ships. The rest is reported, not
   silently dropped — the profile of a line that jumps a bend would read as a
   channel that is not there. */
const MAX_JOIN_M = 800;

/* One point every SPACING_M along the chain, so the file is a river rather
   than a transcript of somebody's digitising. */
function thin(line, spacing) {
  if (line.length < 2) return line;
  const out = [line[0]];
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    acc += metres(line[i - 1], line[i]);
    if (acc >= spacing) { out.push(line[i]); acc = 0; }
  }
  const last = line[line.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/* NO BBOX CLIP. Filtering points to the app's box saved a few kilobytes and
   introduced exactly the defect this generator refuses everywhere else: where
   a river leaves the box and comes back, the points between it are dropped and
   the survivors join in a straight line across the bend — a 2.5 km chord on
   the Mokelumne where the river had actually gone somewhere. The whole main
   stem ships instead. It is a river; it costs what it costs. */

function round(p) { return [Number(p[0].toFixed(5)), Number(p[1].toFixed(5))]; }

/* ---------------------------------------------------------------- check */
if (CHECK) {
  const fails = [];
  if (!existsSync(OUT)) {
    console.log('No public/river-lines.js. Run this without --check to make one.');
    process.exit(1);
  }
  const src = readFileSync(OUT, 'utf8');
  const meta = new Function(src + '; return typeof RIVER_LINES_META !== "undefined" ? RIVER_LINES_META : null;')();
  const lines = new Function(src + '; return typeof RIVER_LINES !== "undefined" ? RIVER_LINES : null;')();
  if (!meta || !meta.fetchedAt) fails.push('no fetchedAt — nothing says when this was taken.');
  if (!meta || meta.source !== SERVICE)
    fails.push('the file names a different service than this generator asks: ' + (meta && meta.source));
  const rs = rivers();
  console.log(`=== river centrelines · ${Object.keys(lines || {}).length} river(s) ===\n`);
  if (meta) console.log(`  fetched ${meta.fetchedAt}\n  from ${meta.source}\n`);
  rs.forEach(r => {
    const L = lines && lines[r.id];
    if (!L || !L.length) return fails.push(`${r.name}: no centreline.`);
    const bad = L.filter(p => !Array.isArray(p) || p.length !== 2 ||
      !isFinite(p[0]) || !isFinite(p[1]));
    if (bad.length) fails.push(`${r.name}: ${bad.length} point(s) are not a position.`);
    let worst = 0;
    for (let i = 1; i < L.length; i++) worst = Math.max(worst, metres(L[i - 1], L[i]));
    /* A jump means the chain broke and the "river" teleports — which would
       draw a profile straight across country. */
    if (worst > SPACING_M * 8)
      fails.push(`${r.name}: a ${Math.round(worst)} m jump between two points — the line is not continuous.`);
    console.log(`  ${r.name}: ${L.length} points, longest step ${Math.round(worst)} m`);
  });
  if (fails.length) {
    console.log('\nFAILURES:'); fails.forEach(f => console.log('  ✗ ' + f));
    process.exit(1);
  }
  console.log('\nEvery river has a continuous line, and it says where it came from.');
  process.exit(0);
}

/* ---------------------------------------------------------------- fetch */
const rs = rivers();
const out = {};
const report = [];
for (const r of rs) {
  const name = r.nhdName || r.name;
  process.stdout.write(`  ${name}… `);
  const stem = await mainStem(name);
  const segs = await stemGeometry(name, stem.path);
  const { line, worst, cuts, dropped } = chain(segs);
  const thinned = thin(line, SPACING_M).map(round);
  out[r.id] = thinned;
  report.push({ name, segments: stem.segments, onStem: segs.length,
                km: stem.km, cuts, dropped, points: thinned.length });
  console.log(`${segs.length} of ${stem.segments} segments on the main stem, ` +
    `${stem.km.toFixed(0)} km → ${thinned.length} points` +
    (cuts ? `  [cut at ${cuts} impossible join(s), worst ${Math.round(worst)} m; ` +
            `${dropped} points on other channels left out]` : ''));
}

const body = `/* GENERATED by tools/fetch-centrelines.mjs — do not edit.
 *
 * Each river's main stem, from USGS NHDPlus High Resolution, ordered from the
 * mouth upwards and thinned to a point every ${SPACING_M} m. Fetched once and
 * shipped, so the profile can follow the river with no signal and without this
 * app inventing a line down the middle of anything.
 *
 * These are USGS's coordinates. Nothing here was typed by hand.
 */
var RIVER_LINES_META = {
  fetchedAt: '${new Date().toISOString()}',
  source: '${SERVICE}',
  spacingMetres: ${SPACING_M}
};
var RIVER_LINES = {
${Object.entries(out).map(([k, v]) =>
  `  ${k}: [${v.map(p => `[${p[0]},${p[1]}]`).join(',')}]`).join(',\n')}
};
`;
writeFileSync(OUT, body);
console.log(`\nWrote ${OUT} — ${(body.length / 1024).toFixed(1)} KB`);
