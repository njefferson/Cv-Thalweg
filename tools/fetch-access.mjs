#!/usr/bin/env node
/* fetch-access — where a person is allowed to be, baked at build time.
 *
 * NOT BOAT RAMPS, and the app must never call them that. There is no published
 * boat-ramp dataset for these rivers that this session could reach: the state's
 * open-data portal returns nothing for boating facilities or launch ramps, and
 * the one "Public Access Points" service is coastal beaches — 1,500 of them
 * across the coastal counties and ZERO inside any of these four river boxes.
 *
 * What does exist is CDFW's own lands: places the department owns or operates
 * and says you may go. On these rivers that is 32 sites typed "Public Access"
 * plus wildlife areas, ecological reserves and hatcheries. It answers "where am
 * I allowed to be", which is a different question from "where can I launch" and
 * is the one this data can honestly answer.
 *
 * THE PIN IS THE MIDDLE OF A PROPERTY, NOT A SPOT ON THE BANK. These are
 * polygons and what ships is each one's centroid, so a large wildlife area's
 * pin can sit well back from the water — and for an awkward shape a centroid
 * can fall outside the property altogether. The app says so rather than letting
 * a dot imply a parking space.
 *
 *   node tools/fetch-access.mjs           # fetch and write
 *   node tools/fetch-access.mjs --check   # verify what is committed
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const repo = (() => { const i = process.argv.indexOf('--repo');
  return i === -1 ? process.cwd() : process.argv[i + 1]; })();
const APP = join(repo, 'public', 'index.html');
const OUT = join(repo, 'public', 'access-lands.js');
const CHECK = process.argv.includes('--check');

const SERVICE = 'https://services2.arcgis.com/Uq9r85Potqm3MfRV/arcgis/rest/services/biosds3077_fpu/FeatureServer/0';

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

async function ask(box) {
  const p = new URLSearchParams({
    f: 'json', where: '1=1',
    outFields: 'PROP_NAME,PROP_TYPE,ACCESS,LINK',
    returnGeometry: 'true', returnCentroid: 'true', outSR: '4326',
    geometryType: 'esriGeometryEnvelope', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', geometry: box.join(','),
    resultRecordCount: '400'
  });
  const r = await fetch(SERVICE + '/query?' + p, { signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error('CDFW answered HTTP ' + r.status);
  const j = await r.json();
  if (j.error) throw new Error('CDFW: ' + JSON.stringify(j.error).slice(0, 200));
  return j.features || [];
}

const round = n => Number(Number(n).toFixed(5));

const R = 6371000, rad = d => d * Math.PI / 180;
function metres(a, b) {
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/* A BOUNDING BOX IS TOO CRUDE TO SAY WHICH RIVER A PLACE IS ON. Every one of
   these rivers has a box hundreds of kilometres across, and a property only has
   to clip a corner of it to be listed — which put the Yolo Bypass Wildlife Area
   under the American River, and two Yuba County properties under the Feather.
   The centreline is already baked in, so the question can be asked properly:
   how far is this place from THIS river's own course. */
const NEAR_RIVER_M = 12000;
function riverLines(repoDir) {
  const f = join(repoDir, 'public', 'river-lines.js');
  if (!existsSync(f)) return null;
  const src = readFileSync(f, 'utf8');
  return new Function(src + '; return typeof RIVER_LINES !== "undefined" ? RIVER_LINES : null;')();
}
function metresToLine(line, lat, lon) {
  let best = Infinity;
  for (let i = 0; i < line.length; i++) {
    const d = metres([lat, lon], line[i]);
    if (d < best) best = d;
  }
  return best;
}

/* ---------------------------------------------------------------- check */
if (CHECK) {
  const fails = [];
  if (!existsSync(OUT)) {
    console.log('No public/access-lands.js. Run this without --check to make one.');
    process.exit(1);
  }
  const src = readFileSync(OUT, 'utf8');
  const meta = new Function(src + '; return typeof ACCESS_META !== "undefined" ? ACCESS_META : null;')();
  const lands = new Function(src + '; return typeof ACCESS_LANDS !== "undefined" ? ACCESS_LANDS : null;')();
  if (!meta || !meta.fetchedAt) fails.push('no fetchedAt — nothing says when this was taken.');
  if (!meta || meta.source !== SERVICE)
    fails.push('the file names a different service than this generator asks: ' + (meta && meta.source));
  console.log('=== CDFW access lands ===\n');
  if (meta) console.log(`  fetched ${meta.fetchedAt}\n  from ${meta.source}\n`);
  let total = 0;
  rivers().forEach(r => {
    const L = (lands && lands[r.id]) || [];
    total += L.length;
    L.forEach(s => {
      if (!s.name) fails.push(`${r.name}: a site with no name.`);
      if (!isFinite(s.lat) || !isFinite(s.lon))
        fails.push(`${r.name}: "${s.name}" has no position.`);
      if (!s.type) fails.push(`${r.name}: "${s.name}" has no type — a reader must be told what kind of place it is.`);
      /* Listed under a river it is nowhere near is worse than not listed. */
      if (!isFinite(s.km))
        fails.push(`${r.name}: "${s.name}" does not say how far from the river it is.`);
      else if (s.km * 1000 > NEAR_RIVER_M + 500)
        fails.push(`${r.name}: "${s.name}" is ${s.km} km from this river — too far to be on it.`);
    });
    const types = {};
    L.forEach(s => { types[s.type] = (types[s.type] || 0) + 1; });
    console.log(`  ${r.name}: ${L.length} site(s) — ` +
      (Object.entries(types).map(([k, v]) => k + ' x' + v).join(', ') || 'none'));
  });
  if (!total) fails.push('not one site on any river — that is not a result, it is a failure.');
  if (fails.length) {
    console.log('\nFAILURES:'); fails.forEach(f => console.log('  ✗ ' + f));
    process.exit(1);
  }
  console.log('\nEvery site has a name, a place and a kind, and says where it came from.');
  process.exit(0);
}

/* ---------------------------------------------------------------- fetch */
const LINES = riverLines(repo);
if (!LINES) {
  console.log('public/river-lines.js is missing. Run tools/fetch-centrelines.mjs first —');
  console.log('without a course to measure against, a bounding box is the only way to');
  console.log('decide which river a place is on, and it is not good enough.');
  process.exit(1);
}
const out = {};
for (const r of rivers()) {
  process.stdout.write(`  ${r.name}… `);
  const fs = await ask(r.bbox);
  const rows = fs.map(f => {
    const a = f.attributes || {};
    const c = f.centroid || {};
    return {
      name: a.PROP_NAME || '',
      type: a.PROP_TYPE || '',
      /* CDFW's own words about whether you may go, kept verbatim. */
      access: a.ACCESS || '',
      link: a.LINK || '',
      lat: isFinite(c.y) ? round(c.y) : null,
      lon: isFinite(c.x) ? round(c.x) : null
    };
  }).filter(s => s.name && s.lat !== null && s.lon !== null);

  const line = LINES && LINES[r.id];
  if (!line) throw new Error('no centreline for ' + r.name +
    ' — run tools/fetch-centrelines.mjs first; without it a place cannot be told which river it is on');
  const near = [];
  let dropped = 0;
  rows.forEach(s => {
    const d = metresToLine(line, s.lat, s.lon);
    if (d > NEAR_RIVER_M) { dropped++; return; }
    /* How far from the water, because "public access" on a property whose
       middle is eight kilometres from the river is a different proposition
       from one on the bank, and the reader should be told which. */
    s.km = Number((d / 1000).toFixed(1));
    near.push(s);
  });
  near.sort((a, b) => a.km - b.km);
  out[r.id] = near;
  const types = {};
  near.forEach(s => { types[s.type] = (types[s.type] || 0) + 1; });
  console.log(`${near.length} site(s) within ${NEAR_RIVER_M / 1000} km of the river ` +
    `(${dropped} dropped as too far) — ` +
    Object.entries(types).map(([k, v]) => k + ' x' + v).join(', '));
}

const body = `/* GENERATED by tools/fetch-access.mjs — do not edit.
 *
 * CDFW's own lands inside each river's box: places the department owns or
 * operates and says the public may go. Fetched once and shipped, so they are on
 * the map with no signal and nothing to download.
 *
 * THESE ARE NOT BOAT RAMPS and nothing here should call them that. No published
 * boat-ramp dataset for these rivers could be reached; the state's one "public
 * access points" service is coastal beaches with none on this water. This
 * answers "where am I allowed to be", which is a different question.
 *
 * EACH POSITION IS THE CENTROID OF A PROPERTY, not a spot on the bank. A large
 * wildlife area's pin can sit well back from the water.
 *
 * These are CDFW's coordinates and CDFW's words. Nothing here was typed by hand.
 */
var ACCESS_META = {
  fetchedAt: '${new Date().toISOString()}',
  source: '${SERVICE}'
};
var ACCESS_LANDS = {
${Object.entries(out).map(([k, v]) =>
  `  ${k}: [\n` + v.map(s =>
    '    ' + JSON.stringify(s)).join(',\n') + '\n  ]').join(',\n')}
};
`;
writeFileSync(OUT, body);
console.log(`\nWrote ${OUT} — ${(body.length / 1024).toFixed(1)} KB`);
