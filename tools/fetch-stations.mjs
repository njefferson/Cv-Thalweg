#!/usr/bin/env node
/**
 * fetch-stations.mjs — bake NOAA's tide stations into the app, once.
 *
 * WHY THIS EXISTS. The app used to ask NOAA for its station list at RUN time,
 * from a reader's device, because no station coordinate is ever typed into this
 * app by hand. That rule is right and this keeps it: the numbers here are still
 * NOAA's, fetched from NOAA, never transcribed. What changes is WHEN.
 *
 * NOAA publishes the list as one two-megabyte file and will not filter it, so
 * paying that on a phone to find out where the tide stations are was a bad
 * trade — and it meant a reader who never pressed the button had no stations on
 * the map at all, including the one the app was reading the tide FROM.
 * Fetched once, here, the whole list ships with the app: on the map from first
 * load, correct offline, no download.
 *
 * WHAT THE BUTTON BECOMES. Not "look for stations" — they are already here — but
 * "has NOAA added any since this build". That is a real question with a small
 * honest answer, and it is the only thing left that needs the network.
 *
 *   node tools/fetch-stations.mjs            write public/tide-stations.js
 *   node tools/fetch-stations.mjs --check    verify the committed file
 *
 * `--check` does NOT re-fetch. It cannot: it runs in CI and on machines with no
 * route to NOAA, and a check that needs a third party to be up is a check that
 * goes red for reasons that are nobody's fault. It verifies the file is present,
 * parses, carries its provenance, and covers every river that declares tides.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

/* Node's own fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY is set, and it
   reads it at STARTUP. Without it this prints "NOAA answered 403" — which is
   the proxy's allowlist reply wearing NOAA's name, and reads exactly like the
   service refusing us. (Hub LESSONS §173.) */
if (!process.env.NODE_USE_ENV_PROXY &&
    (process.env.HTTPS_PROXY || process.env.https_proxy)) {
  const r = spawnSync(process.execPath, [import.meta.filename, ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(r.status === null ? 1 : r.status);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const appSource = () => readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');
const OUT = join(ROOT, 'public', 'tide-stations.js');
/* THE SAME URL THE APP USES, read out of it rather than restated here.
 *
 * The first version of this hard-coded the bare stations.json and baked THREE
 * stations for the Sacramento and NONE for the Mokelumne — whose declared
 * station works perfectly well. The app asks for `?type=tidepredictions`, which
 * is a far larger set including every subordinate station, and the bare
 * endpoint answers with the primary stations only. Two URLs for one fact, and
 * the generator had the wrong one. */
function indexUrl(src) {
  const m = /var COOPS_MD = '([^']+)'/.exec(src);
  if (!m) throw new Error('no COOPS_MD in public/index.html — cannot tell which list the app reads');
  return m[1];
}

/* The rivers, read out of the app rather than restated here — one source, so a
 * river added there cannot be silently missed here.
 *
 * EVALUATED, NOT PATTERN-MATCHED. The first version of this scraped the fields
 * out with a regex and got two of the four rivers, with `tidal` wrong on both,
 * because the pattern ran greedily across the boundary between one entry and
 * the next. A declaration is a declaration: take its text and let JavaScript
 * read it, which cannot disagree with what the app itself will do.
 *
 * The stubs are the constants an entry mentions. If a river ever references
 * something not stubbed here this throws, loudly, rather than quietly dropping
 * a river — which is the failure the regex version had. */
function rivers() {
  const src = appSource();
  const start = src.indexOf('var RIVERS = [');
  if (start < 0) throw new Error('no RIVERS declaration in public/index.html');
  let i = src.indexOf('[', start), depth = 0, end = -1;
  for (let k = i; k < src.length; k++) {
    if (src[k] === '[') depth++;
    else if (src[k] === ']') { depth--; if (!depth) { end = k + 1; break; } }
  }
  if (end < 0) throw new Error('RIVERS declaration is not balanced');
  const PROV = { VERIFIED: 'verified', CORROBORATED: 'corroborated', FOUND: 'found' };
  // eslint-disable-next-line no-new-func
  return new Function('PROV', 'return ' + src.slice(i, end))(PROV);
}

const metres = (aLat, aLon, bLat, bLon) => {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
};

if (process.argv.includes('--check')) {
  let src;
  try { src = readFileSync(OUT, 'utf8'); }
  catch {
    console.log('  FAIL  public/tide-stations.js is missing. Run the Tide stations workflow.');
    process.exit(1);
  }
  const fails = [];
  const stamp = /fetchedAt:\s*'([^']+)'/.exec(src);
  const source = /source:\s*'([^']+)'/.exec(src);
  if (!stamp) fails.push('no fetchedAt — the file does not say when NOAA was asked');
  if (!source || !source[1].includes('tidesandcurrents')) fails.push('no source — the file does not say where the numbers came from');
  /* The generator and the app must read the SAME list, or the button's diff is
     against a set the app never had. */
  else if (source[1] !== indexUrl(appSource()))
    fails.push('baked from ' + source[1] + ' but the app reads ' + indexUrl(appSource()));
  for (const r of rivers().filter((r) => r.tidal)) {
    const has = new RegExp(`${r.id}:\\s*\\[`).test(src);
    if (!has) fails.push(`${r.id} declares tides and has no baked stations`);
  }
  /* Every station must carry a position. A row without one cannot be drawn and
     cannot be ranked, which is the whole reason this file exists. */
  const rows = [...src.matchAll(/\{id:'[^']+',name:'[^']*',lat:(-?[\d.]+),lon:(-?[\d.]+)\}/g)];
  const bad = [...src.matchAll(/\{id:'[^']+'/g)].length - rows.length;
  if (bad > 0) fails.push(`${bad} station(s) without a usable position`);
  console.log(`=== baked tide stations · ${rows.length} station(s) ===`);
  if (stamp) console.log(`  fetched ${stamp[1]} from ${source ? source[1] : '?'}`);
  if (!fails.length) { console.log('\nEvery river that has tides has its stations, and every station has a place.\n'); process.exit(0); }
  for (const f of fails) console.log(`  FAIL  ${f}`);
  process.exit(1);
}

const INDEX = indexUrl(appSource());
console.log('asking ' + INDEX);
const res = await fetch(INDEX);
if (!res.ok) { console.error(`NOAA answered ${res.status}`); process.exit(1); }
const j = await res.json();
const all = j.stations || [];
if (!all.length) { console.error('NOAA returned no stations — refusing to write an empty file'); process.exit(1); }

const byRiver = {};
let kept = 0;
for (const r of rivers().filter((r) => r.tidal)) {
  const [w, s, e, n] = r.bbox;
  const inBox = all
    .map((x) => ({ id: String(x.id), name: String(x.name || ''), lat: Number(x.lat), lon: Number(x.lng) }))
    .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon))
    .filter((x) => x.lon >= w && x.lon <= e && x.lat >= s && x.lat <= n)
    .sort((a, b) => metres(r.center[0], r.center[1], a.lat, a.lon) -
                    metres(r.center[0], r.center[1], b.lat, b.lon));
  byRiver[r.id] = inBox;
  kept += inBox.length;
  console.log(`${r.id.padEnd(12)} ${String(inBox.length).padStart(3)} station(s) in the box`);
}

/* ASKED THE WAY THE APP USED TO ASK.
 *
 * The app took every station's name and position from the per-station endpoint,
 * not from the index, so the baked file is built from that same endpoint — the
 * point of this change is to move WHEN the question is asked, never what the
 * answer is. Sixty-odd requests, once a month, on a build machine: the cost
 * this whole change exists to keep off a reader's phone.
 *
 * MEASURED, because a comment here first claimed the index rounds and the
 * detail endpoint disagrees: for Rio Vista both say 38.145, -121.692, and the
 * same held for every station checked. So this is confirmation rather than
 * correction — worth keeping because it is the endpoint the app trusted, not
 * because a discrepancy is known.
 *
 * A station that will not answer is one this file does not get to guess about:
 * the run fails rather than shipping a position it could not confirm. */
const DETAIL = 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/';
const ids = [...new Set(Object.values(byRiver).flat().map((x) => x.id))];
console.log(`\nasking NOAA where each of ${ids.length} station(s) actually is`);
const precise = new Map();
for (let i = 0; i < ids.length; i += 6) {
  const batch = ids.slice(i, i + 6);
  const got = await Promise.all(batch.map(async (id) => {
    const r = await fetch(DETAIL + id + '.json');
    if (!r.ok) throw new Error(`NOAA answered ${r.status} for station ${id}`);
    const d = ((await r.json()).stations || [])[0];
    if (!d || !Number.isFinite(Number(d.lat)) || !Number.isFinite(Number(d.lng)))
      throw new Error(`no usable position for station ${id}`);
    return [id, { name: String(d.name || ''), lat: Number(d.lat), lon: Number(d.lng) }];
  }));
  got.forEach(([id, v]) => precise.set(id, v));
}
for (const list of Object.values(byRiver)) {
  for (const x of list) {
    const p = precise.get(x.id);
    x.name = p.name || x.name;
    x.lat = p.lat;
    x.lon = p.lon;
  }
}

const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const body = Object.entries(byRiver).map(([id, list]) =>
  `  ${id}: [\n` +
  list.map((x) => `    {id:'${esc(x.id)}',name:'${esc(x.name)}',lat:${x.lat},lon:${x.lon}}`).join(',\n') +
  `\n  ]`).join(',\n');

writeFileSync(OUT, `/* GENERATED by tools/fetch-stations.mjs — do not edit.
 *
 * NOAA's published tide stations, filtered to each river's bounding box and
 * ordered by distance from the middle of that reach. Fetched once and shipped,
 * so a reader has them on the map from first load, offline, without paying for
 * NOAA's two-megabyte index on a phone.
 *
 * These are NOAA's numbers. Nothing here was typed by hand, which is the same
 * rule as when the app fetched them at run time — only the moment changed. */
var TIDE_STATIONS_META = {
  fetchedAt: '${new Date().toISOString()}',
  source: '${INDEX}'
};
var TIDE_STATIONS = {
${body}
};
`);
console.log(`\nwrote public/tide-stations.js — ${kept} station(s) across ${Object.keys(byRiver).length} river(s)`);
