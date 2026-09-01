#!/usr/bin/env node
/* fetch-ramps — where you can put a boat in, baked at build time.
 *
 * THIS FILE EXISTS BECAUSE THE APP SPENT ITS WHOLE LIFE SAYING THIS DATA DID
 * NOT EXIST. The Layers panel said, in as many words, that no published list of
 * boat ramps for these rivers could be found. That sentence was written on
 * evidence gathered through a firewall: six of the hosts that publish it were
 * refused by the container's egress and never reached, and a refusal and an
 * absence look identical from inside. (Hub LESSONS §188.)
 *
 * What is actually published: CDFW's own `FishingGuide` feature service, the
 * one behind the department's Fishing Guide web map. Layer 0 is `FGuideBoating`
 * — 677 boating facilities statewide, each with a `Water_Body` naming the water
 * it is on, the facility type, who owns it, whether the public may use it, and
 * how many ramp lanes are usable at one time.
 *
 * TWO THINGS THIS DATA IS NOT, and both must reach the reader.
 *
 * ONE: it is an INTERVIEW RECORD, not a survey of what is there today.
 * Somebody visited and wrote it down, and where a row carries the date of that
 * visit it runs from 2006 to 2014. A ramp that has closed since is still in
 * here. So the year ships with every facility that has one and the app prints
 * it — a ramp that is not there when you arrive towing a boat is a worse
 * failure than a missing depth.
 *
 * AND ONLY 237 OF THE 677 CARRY A DATE AT ALL. The first version of this
 * generator dropped the other 440, on a rule that every facility must say when
 * it was last seen — which threw away nearly two thirds of the data, real ramps
 * among them, to keep a rule this file had invented. Undated rows are KEPT and
 * marked as undated, because this app's standing answer to a missing figure is
 * to say it is missing rather than to show a zero or drop the row. The split is
 * printed on every run so the proportion cannot quietly change.
 *
 * TWO: it is not a judgement about whether you can launch TODAY. Low water
 * takes ramps out of use for whole seasons and nothing here knows the stage.
 * The app says that and does not guess.
 *
 * ASSIGNED BY DISTANCE TO THE RIVER'S OWN COURSE, not by a bounding box, for
 * the same reason `fetch-access.mjs` is: these boxes are hundreds of kilometres
 * across and a place only has to clip a corner. CDFW's own `Water_Body` string
 * is kept verbatim beside it, so the reader sees the department's naming and
 * the app's filing and can tell when they disagree.
 *
 *   node tools/fetch-ramps.mjs           # fetch and write
 *   node tools/fetch-ramps.mjs --check   # verify what is committed
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/* Node's own fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY is set, and it
   reads it at STARTUP. Without it this prints "CDFW answered HTTP 403" — the
   proxy's allowlist reply wearing the department's name. (Hub LESSONS §173.) */
if (!process.env.NODE_USE_ENV_PROXY &&
    (process.env.HTTPS_PROXY || process.env.https_proxy)) {
  const r = spawnSync(process.execPath, [import.meta.filename, ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(r.status === null ? 1 : r.status);
}

const repo = (() => { const i = process.argv.indexOf('--repo');
  return i === -1 ? process.cwd() : process.argv[i + 1]; })();
const APP = join(repo, 'public', 'index.html');
const OUT = join(repo, 'public', 'ramps.js');
const CHECK = process.argv.includes('--check');

const SERVICE = 'https://services2.arcgis.com/Uq9r85Potqm3MfRV/arcgis/rest/services/FishingGuide/FeatureServer/0';

/* A RAMP IS ON THE WATER OR IT IS NOT A RAMP. The access lands take 12 km,
   because a wildlife area's middle can sit well back from the bank and still be
   the place you go. A launch cannot: it is a concrete slope into this river. A
   kilometre is generous for a point position on a meandering channel and still
   refuses a facility on the next watershed over. */
const NEAR_RIVER_M = 1000;

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

const FIELDS = ['Facility_Name', 'Water_Body', 'County', 'Facility_Type', 'Owner',
  'Type_of_Ownership_Gov_or_Non', 'Facility_Users', 'NO_OF_RAMP_LANE_USE_ONE_TIME',
  'NO_OF_PARK_SPACES_CAR_W_TRAILER', 'RESTROOMS', 'FISH_CLEANING',
  'Phone_Num', 'Website', 'Interview_Date', 'Latitude', 'Longitude'].join(',');

async function ask(box) {
  const p = new URLSearchParams({
    f: 'json', where: '1=1', outFields: FIELDS,
    returnGeometry: 'true', outSR: '4326',
    geometryType: 'esriGeometryEnvelope', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', geometry: box.join(','),
    resultRecordCount: '2000'
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
function riverLines(repoDir) {
  const f = join(repoDir, 'public', 'river-lines.js');
  if (!existsSync(f)) return null;
  const src = readFileSync(f, 'utf8');
  const lines = new Function(src + '; return typeof RIVER_LINES !== "undefined" ? RIVER_LINES : null;')();
  if (!lines) return null;
  const d = join(repoDir, 'public', 'delta.js');
  if (existsSync(d)) {
    const dsrc = readFileSync(d, 'utf8');
    const delta = new Function(dsrc + '; return typeof DELTA !== "undefined" ? DELTA : null;')();
    if (delta && delta.channels && delta.channels.length)
      lines.delta = delta.channels.reduce((all, c) => all.concat(c.pts), []);
  }
  return lines;
}
function metresToLine(line, lat, lon) {
  let best = Infinity;
  for (let i = 0; i < line.length; i++) {
    const d = metres([lat, lon], line[i]);
    if (d < best) best = d;
  }
  return best;
}

/* A YEAR, NOT A TIMESTAMP. The reader needs to know this is old; the exact day
   somebody knocked on the door in 2011 is precision the record does not earn. */
function year(ms) {
  if (!isFinite(ms)) return null;
  const y = new Date(ms).getUTCFullYear();
  return y > 1990 && y < 2100 ? y : null;
}
/* CDFW writes these as free text: "2", "2 lanes", "" and "0" all appear. Only a
   number this app is willing to print is kept, and anything else becomes null
   so the app says nothing rather than repeating a string it cannot read. */
function count(v) {
  if (v === null || v === undefined) return null;
  const m = /^\s*(\d+)/.exec(String(v));
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}
const yes = v => /^\s*(y|yes|true|1)\s*$/i.test(String(v || ''));

/* ---------------------------------------------------------------- check */
if (CHECK) {
  const fails = [];
  if (!existsSync(OUT)) {
    console.log('No public/ramps.js. Run this without --check to make one.');
    process.exit(1);
  }
  const src = readFileSync(OUT, 'utf8');
  const meta = new Function(src + '; return typeof RAMPS_META !== "undefined" ? RAMPS_META : null;')();
  const ramps = new Function(src + '; return typeof RAMPS !== "undefined" ? RAMPS : null;')();
  if (!meta || !meta.fetchedAt) fails.push('no fetchedAt — nothing says when this was taken.');
  if (!meta || meta.source !== SERVICE)
    fails.push('the file names a different service than this generator asks: ' + (meta && meta.source));
  console.log('=== CDFW boating facilities ===\n');
  if (meta) console.log(`  fetched ${meta.fetchedAt}\n  from ${meta.source}\n`);
  let total = 0, dated = 0, undated = 0;
  rivers().forEach(r => {
    const L = (ramps && ramps[r.id]) || [];
    total += L.length;
    L.forEach(s => {
      if (!s.name) fails.push(`${r.name}: a facility with no name.`);
      if (!isFinite(s.lat) || !isFinite(s.lon))
        fails.push(`${r.name}: "${s.name}" has no position.`);
      if (!s.type) fails.push(`${r.name}: "${s.name}" has no facility type.`);
      /* `seen` is a year or an explicit null. UNDEFINED is the failure — that
         is a facility the app would render with no idea whether it is dated,
         and the age is the whole caveat of this dataset. */
      if (!('seen' in s)) fails.push(`${r.name}: "${s.name}" does not say whether it has a date.`);
      else if (s.seen === null) undated++;
      else if (!(s.seen > 1990 && s.seen < 2100))
        fails.push(`${r.name}: "${s.name}" has an impossible year ${s.seen}.`);
      else dated++;
      if (!isFinite(s.km))
        fails.push(`${r.name}: "${s.name}" does not say how far from the river it is.`);
      else if (s.km * 1000 > NEAR_RIVER_M + 200)
        fails.push(`${r.name}: "${s.name}" is ${s.km} km from this river — too far to be on it.`);
      if (s.users && s.users !== 'Public')
        fails.push(`${r.name}: "${s.name}" is not marked public — this app must not send anyone to it.`);
      /* A one-way `also` would have the app claim a listing that is not there. */
      if (s.also) {
        if (!Array.isArray(s.also) || !s.also.length)
          fails.push(`${r.name}: "${s.name}" has an empty also.`);
        else s.also.forEach(o => {
          const there = ((ramps && ramps[o]) || []).some(x => x.name === s.name &&
            (x.also || []).includes(r.id));
          if (!there) fails.push(`${r.name}: "${s.name}" says it is also on ${o}, and ${o} does not say so back.`);
        });
      }
    });
    console.log(`  ${r.name}: ${L.length} facility(ies)`);
  });
  if (!total) fails.push('not one facility on any river — that is not a result, it is a failure.');
  console.log(`\n  ${dated} carry the year they were last seen; ${undated} carry none and say so.`);
  /* If CDFW ever dates all of them this line stops being interesting; if the
     dated share collapses, this is where it shows. */
  if (total && !dated)
    fails.push('not one facility carries a date — the age is the caveat and it has vanished.');
  if (fails.length) {
    console.log('\nFAILURES:'); fails.forEach(f => console.log('  ✗ ' + f));
    process.exit(1);
  }
  console.log(`Every facility has a name, a place, a kind, and either a year or an honest blank.`);
  process.exit(0);
}

/* ---------------------------------------------------------------- fetch */
const LINES = riverLines(repo);
if (!LINES) {
  console.log('public/river-lines.js is missing. Run tools/fetch-centrelines.mjs first —');
  console.log('without a course to measure against there is no way to tell which river a');
  console.log('launch is on, and a bounding box is not good enough.');
  process.exit(1);
}
const out = {};
let privateDropped = 0, undatedKept = 0;
for (const r of rivers()) {
  process.stdout.write(`  ${r.name}… `);
  const feats = await ask(r.bbox);
  const rows = [];
  for (const f of feats) {
    const a = f.attributes || {};
    const g = f.geometry || {};
    const lat = isFinite(g.y) ? g.y : a.Latitude;
    const lon = isFinite(g.x) ? g.x : a.Longitude;
    if (!a.Facility_Name || !isFinite(lat) || !isFinite(lon)) continue;
    /* NEVER SEND ANYBODY TO A FACILITY THE PUBLIC MAY NOT USE. CDFW records
       this per facility; anything not positively marked public is dropped
       rather than shown with a caveat. */
    if (String(a.Facility_Users || '').trim() !== 'Public') { privateDropped++; continue; }
    const seen = year(a.Interview_Date);
    if (seen === null) undatedKept++;
    rows.push({
      name: String(a.Facility_Name).trim(),
      type: String(a.Facility_Type || '').trim(),
      /* CDFW's own name for the water, kept verbatim beside this app's own
         filing so a disagreement between the two is visible rather than
         resolved silently. */
      water: String(a.Water_Body || '').trim(),
      county: String(a.County || '').trim(),
      owner: String(a.Owner || '').trim(),
      gov: String(a.Type_of_Ownership_Gov_or_Non || '').trim() === 'Government',
      users: 'Public',
      lanes: count(a.NO_OF_RAMP_LANE_USE_ONE_TIME),
      trailerSpaces: count(a.NO_OF_PARK_SPACES_CAR_W_TRAILER),
      restrooms: yes(a.RESTROOMS),
      fishCleaning: yes(a.FISH_CLEANING),
      phone: String(a.Phone_Num || '').trim(),
      site: /^https?:\/\//i.test(String(a.Website || '').trim()) ? String(a.Website).trim() : '',
      seen,
      lat: round(lat), lon: round(lon)
    });
  }

  const line = LINES[r.id];
  if (!line) throw new Error('no centreline for ' + r.name +
    ' — run tools/fetch-centrelines.mjs first; without it a launch cannot be told which river it is on');
  const near = [];
  let far = 0;
  for (const s of rows) {
    const d = metresToLine(line, s.lat, s.lon);
    if (d > NEAR_RIVER_M) { far++; continue; }
    s.km = Number((d / 1000).toFixed(2));
    near.push(s);
  }
  /* Sorted by name rather than by distance: every one of these is on the water,
     so distance does not rank them, and a reader looking for one they know the
     name of should not have to hunt. */
  near.sort((a, b) => a.name.localeCompare(b.name));
  out[r.id] = near;
  console.log(`${near.length} public facility(ies) within ${NEAR_RIVER_M} m of the course ` +
    `(${far} dropped as too far)`);
}
console.log(`  ${privateDropped} dropped as not public. ${undatedKept} of those kept carry no ` +
  `interview date and are marked as undated rather than dropped.`);

/* A FACILITY AT A CONFLUENCE IS ON BOTH RIVERS, AND THAT IS NOT A MISTAKE.
   Discovery Park is a launch on the American and on the Sacramento; a marina on
   the lower Sacramento is on Delta water too. Each river is asked
   independently, so those land in both lists — which is right, because somebody
   fishing the American wants to know about Discovery Park. What would be wrong
   is letting it look like two places. Every row that appears under more than
   one river carries the others by name, and the app says so. */
const byName = {};
for (const [id, list] of Object.entries(out))
  for (const s of list) (byName[s.name] = byName[s.name] || []).push(id);
let shared = 0;
for (const [id, list] of Object.entries(out))
  for (const s of list) {
    const others = byName[s.name].filter(x => x !== id);
    if (others.length) { s.also = others; shared++; }
  }
console.log(`  ${shared} row(s) are one facility listed under more than one river, ` +
  `each naming the others.`);

const years = Object.values(out).flat().map(s => s.seen).filter(y => y !== null);
const body = `/* GENERATED by tools/fetch-ramps.mjs — do not edit.
 *
 * Public boating facilities on these rivers, from CDFW's own FishingGuide
 * service — the data behind the department's Fishing Guide map. Fetched once
 * and shipped, so they are on the map with no signal and nothing to download.
 *
 * EVERY ROW IS AN INTERVIEW RECORD. Somebody visited each facility and wrote
 * it down; the dated visits in this file run from ${Math.min(...years)} to ${Math.max(...years)}, and a ramp
 * closed since is still here. Where CDFW recorded no date the row says so
 * rather than being dropped or shown as current — two thirds of the department's
 * facilities carry no date, and dropping them would lose real ramps to keep a
 * tidier rule.
 *
 * NOTHING HERE KNOWS TODAY'S WATER. Low water takes a ramp out of use for a
 * whole season, and this file has no idea what the stage is.
 *
 * Only facilities CDFW marks as usable by the public are kept. Each is filed
 * under the river whose own course it is nearest, and CDFW's own name for the
 * water is kept beside it so the two can be compared.
 *
 * These are CDFW's coordinates and CDFW's words. Nothing here was typed by hand.
 */
var RAMPS_META = {
  fetchedAt: '${new Date().toISOString()}',
  source: '${SERVICE}',
  seenFrom: ${Math.min(...years)},
  seenTo: ${Math.max(...years)}
};
var RAMPS = {
${Object.entries(out).map(([k, v]) =>
  `  ${k}: [\n` + v.map(s => '    ' + JSON.stringify(s)).join(',\n') + '\n  ]').join(',\n')}
};
`;
writeFileSync(OUT, body);
console.log(`\nWrote ${OUT} — ${(body.length / 1024).toFixed(1)} KB`);
