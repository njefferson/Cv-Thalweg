/* Thalweg endpoint verification.
 *
 * Every network call the app makes, executed for real, with the three
 * things that matter reported separately: does it answer, will a browser
 * be allowed to read it, and is the response the shape the code expects.
 *
 *   node tools/verify.mjs              everything
 *   node tools/verify.mjs --only=usgs  one group (usgs, tide, dwr, base, worker)
 *   node tools/verify.mjs --json       machine-readable
 *
 * Exits non-zero if any required check fails.
 *
 * If you are behind a proxy that Node's fetch ignores, run it as
 *   NODE_USE_ENV_PROXY=1 node tools/verify.mjs
 */
import { RIVERS, bathyProxy } from './lib-rivers.mjs';

const args = process.argv.slice(2);
const only = (args.find(a => a.startsWith('--only=')) || '').split('=')[1] || '';
const asJson = args.includes('--json');
const TIMEOUT = 90000;

/* DWR reflects the requesting origin rather than sending a wildcard, so a
   request with no Origin header comes back with no CORS header at all and
   the check reads as a failure when nothing is wrong. Every probe below
   sends one, which is what a browser would do. */
const ORIGIN = 'https://cv-thalweg.pages.dev';

const results = [];
function record(group, name, ok, detail, extra) {
  results.push({ group, name, ok, detail: detail || '', ...(extra || {}) });
  if (!asJson) {
    const tag = ok === true ? 'PASS' : ok === false ? 'FAIL' : 'INFO';
    console.log(`${tag}  [${group}] ${name}${detail ? ' — ' + detail : ''}`);
  }
}

async function hit(url, { expect = 'json', label = '' } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow',
      headers: { Origin: ORIGIN } });
    const acao = res.headers.get('access-control-allow-origin');
    const ct = res.headers.get('content-type') || '';
    let body = null;
    if (expect === 'json') {
      const text = await res.text();
      try { body = JSON.parse(text); }
      catch { return { res, acao, ct, err: 'response was not JSON: ' + text.slice(0, 160) }; }
    } else {
      const buf = await res.arrayBuffer();
      body = { bytes: buf.byteLength };
    }
    return { res, acao, ct, body };
  } catch (e) {
    return { err: String(e && e.message || e) };
  } finally { clearTimeout(t); }
}

function corsNote(acao) {
  if (!acao) return 'NO Access-Control-Allow-Origin — a browser cannot read this';
  if (acao === '*' || acao === ORIGIN) return `CORS allow-origin: ${acao}`;
  return `CORS allow-origin: ${acao} — that is not this app's origin`;
}

/* ------------------------------------------------------------------ */
async function checkUsgs() {
  const P = '00060,00065,00010';
  for (const river of RIVERS) {
    const ids = river.gauges.map(g => g.id);
    if (ids.length) {
      const url = `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${ids.join(',')}&parameterCd=${P}&siteStatus=all`;
      const r = await hit(url);
      if (r.err) { record('usgs', `${river.id} declared sites`, false, r.err); }
      else if (!r.res.ok) { record('usgs', `${river.id} declared sites`, false, `HTTP ${r.res.status}`); }
      else {
        const ts = r.body?.value?.timeSeries;
        record('usgs', `${river.id} declared sites`, Array.isArray(ts),
          `${Array.isArray(ts) ? ts.length : 0} timeSeries; ${corsNote(r.acao)}`);
        const seen = new Map();
        for (const t of ts || []) {
          const code = t.sourceInfo?.siteCode?.[0]?.value;
          if (code) seen.set(code, t.sourceInfo.siteName);
        }
        for (const g of river.gauges) {
          const name = seen.get(g.id);
          record('usgs', `  site ${g.id} (${g.status})`, !!name,
            name ? `answers as "${name}"` : `NO DATA — recalled as "${g.hint || ''}"; replace or remove it`);
        }
      }
    }
    const bb = river.bbox.map(v => v.toFixed(3)).join(',');
    const durl = `https://waterservices.usgs.gov/nwis/iv/?format=json&bBox=${bb}&parameterCd=${P}&siteStatus=active`;
    const d = await hit(durl);
    if (d.err || !d.res?.ok) {
      record('usgs', `${river.id} bBox sweep`, false, d.err || `HTTP ${d.res.status}`);
    } else {
      const re = river.discover ? new RegExp(river.discover.match, 'i') : null;
      const found = new Map();
      for (const t of d.body?.value?.timeSeries || []) {
        const code = t.sourceInfo?.siteCode?.[0]?.value;
        const name = t.sourceInfo?.siteName || '';
        if (code && (!re || re.test(name))) found.set(code, name);
      }
      record('usgs', `${river.id} bBox sweep`, true,
        `${found.size} site(s) whose name matches /${river.discover?.match}/i`);
      for (const [code, name] of found) record('usgs', `  found ${code}`, null, name);
    }
  }
}

/* ------------------------------------------------------------------ */
async function checkTide() {
  const today = new Date();
  const ymd = d => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const end = new Date(today); end.setDate(end.getDate() + 3);

  for (const river of RIVERS.filter(r => r.tidal)) {
    for (const st of river.tideStations) {
      for (const interval of ['hilo', 'h']) {
        const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=thalweg&begin_date=${ymd(today)}&end_date=${ymd(end)}&datum=MLLW&station=${st.id}&time_zone=lst_ldt&units=english&interval=${interval}&format=json`;
        const r = await hit(url);
        if (r.err || !r.res?.ok) { record('tide', `${st.id} interval=${interval}`, false, r.err || `HTTP ${r.res.status}`); continue; }
        const preds = r.body?.predictions;
        const first = Array.isArray(preds) && preds[0];
        const got = Array.isArray(preds) && preds.length > 0;
        /* Highs and lows are required — every prediction station has them.
           The hourly curve is not: a subordinate station answers interval=h
           with an error, and the app is built to say so rather than draw an
           interpolated line through water nobody published. */
        record('tide', `${st.id} interval=${interval}`, interval === 'hilo' ? got : (got ? true : null),
          (first ? `first ${first.t} = ${first.v}${first.type ? ' ' + first.type : ''}; `
                 : (interval === 'h'
                    ? 'no hourly curve at this station — highs and lows only, which the app states on screen; '
                    : (r.body?.error?.message || 'no predictions; '))) + corsNote(r.acao));
      }
    }
    const murl = 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions&units=english';
    const m = await hit(murl);
    if (m.err || !m.res?.ok) { record('tide', `${river.id} station discovery`, false, m.err || `HTTP ${m.res.status}`); continue; }
    const b = river.bbox;
    const inBox = (m.body?.stations || []).filter(s =>
      Number(s.lng) >= b[0] && Number(s.lng) <= b[2] &&
      Number(s.lat) >= b[1] && Number(s.lat) <= b[3]);
    record('tide', `${river.id} station discovery`, true,
      `${inBox.length} prediction station(s) in the river box; ${corsNote(m.acao)}`);
    for (const s of inBox) record('tide', `  station ${s.id}`, null, `${s.name} (${s.lat}, ${s.lng})`);
  }
  /* One tile over the lower Sacramento near Rio Vista. */
  const chart = 'https://tileservice.charts.noaa.gov/tiles/50000_1/12/663/1577.png';
  const c = await hit(chart, { expect: 'bin' });
  record('tide', 'NOAA raster chart tile', !c.err && c.res?.ok && /image/.test(c.ct || ''),
    (c.err ? c.err + ' — if this host is unreachable from here the app switches the layer off by itself'
           : `HTTP ${c.res?.status} ${c.ct} ${c.body?.bytes ?? 0} bytes; ${corsNote(c.acao)}`));
}

/* ------------------------------------------------------------------ */
async function checkDwr() {
  const base = bathyProxy() || 'https://gis.water.ca.gov';
  const folder = `${base}/arcgisimg/rest/services/Bathymetry?f=json`;
  const f = await hit(folder);
  if (f.err || !f.res?.ok) {
    record('dwr', 'bathymetry folder', false, f.err || `HTTP ${f.res.status}`);
  } else {
    const svcs = (f.body?.services || []).filter(s => s.type === 'ImageServer');
    record('dwr', 'bathymetry folder', svcs.length > 0,
      `${svcs.length} ImageServer(s); ${corsNote(f.acao)}`);
    let sample = null;
    for (const s of svcs) {
      const u = `${base}/arcgisimg/rest/services/${s.name}/ImageServer?f=json`;
      const m = await hit(u);
      if (m.err || !m.res?.ok || !m.body?.extent) {
        record('dwr', `  ${s.name}`, false, m.err || 'no extent in metadata');
        continue;
      }
      const e = m.body.extent;
      const wkid = e.spatialReference?.latestWkid || e.spatialReference?.wkid;
      const rivers = placeExtent(e, wkid);
      record('dwr', `  ${s.name}`, null,
        `wkid ${wkid}; ${rivers.length ? 'intersects ' + rivers.join(', ') : 'no river box matched (or projection not converted here)'}`);
      if (!sample && rivers.length) sample = { name: s.name, extent: e, wkid };
    }
    if (sample) {
      const c = centreOf(sample.extent, sample.wkid);
      if (c) {
        const bbox = [c.x - 300, c.y - 300, c.x + 300, c.y + 300].join(',');
        const plain = `${base}/arcgisimg/rest/services/${sample.name}/ImageServer/exportImage?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=64,64&format=png32&transparent=true&f=image`;
        const p = await hit(plain, { expect: 'bin' });
        record('dwr', 'exportImage (no rendering rule)',
          !p.err && p.res?.ok && /image/.test(p.ct || ''),
          p.err || `HTTP ${p.res?.status} ${p.ct} ${p.body?.bytes ?? 0} bytes; ${corsNote(p.acao)}`);
        const rule = encodeURIComponent(JSON.stringify({
          rasterFunction: 'Stretch',
          rasterFunctionArguments: { StretchType: 6, DRA: true, UseGamma: false },
          variableName: 'Raster'
        }));
        const r = await hit(plain + '&renderingRule=' + rule, { expect: 'bin' });
        record('dwr', 'exportImage (colour ramp)',
          !r.err && r.res?.ok && /image/.test(r.ct || ''),
          r.err || `HTTP ${r.res?.status} ${r.ct} ${r.body?.bytes ?? 0} bytes — if this fails the app hides the ramp toggle by itself`);
      }
    }
  }

  const layersUrl = `${base}/arcgis/rest/services/Elevation/i06_Singlebeam_Bathymetry/MapServer/layers?f=json`;
  const l = await hit(layersUrl);
  if (l.err || !l.res?.ok) {
    record('dwr', 'singlebeam layers', false, l.err || `HTTP ${l.res.status}`);
    return;
  }
  const layers = (l.body?.layers || []).filter(x => x.type !== 'Group Layer');
  record('dwr', 'singlebeam layers', layers.length > 0,
    `${layers.length} layer(s); ${corsNote(l.acao)}`);
  let probed = false;
  for (const lay of layers) {
    const wkid = lay.extent?.spatialReference?.latestWkid || lay.extent?.spatialReference?.wkid;
    const rivers = lay.extent ? placeExtent(lay.extent, wkid) : [];
    const depth = (lay.fields || []).map(f => f.name).find(n => /^z$|elev|depth|bed|bottom|sounding/i.test(n));
    record('dwr', `  layer ${lay.id} ${lay.name}`, null,
      `wkid ${wkid}; ${rivers.length ? 'intersects ' + rivers.join(', ') : 'no river box matched'}; depth field ${depth || 'NOT IDENTIFIED'}`);
    if (!probed && rivers.length) {
      probed = true;
      const geo = geoExtent(lay.extent, wkid);
      const env = [geo.w, geo.s, Math.min(geo.e, geo.w + 0.01), Math.min(geo.n, geo.s + 0.01)].join(',');
      const q = `${base}/arcgis/rest/services/Elevation/i06_Singlebeam_Bathymetry/MapServer/${lay.id}/query?f=json&where=1%3D1&geometry=${encodeURIComponent(env)}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=${encodeURIComponent(depth || '*')}&returnGeometry=true&outSR=4326&resultRecordCount=50`;
      const qr = await hit(q);
      if (qr.err || !qr.res?.ok) record('dwr', `  layer ${lay.id} bounded query`, false, qr.err || `HTTP ${qr.res.status}`);
      else if (qr.body?.error) record('dwr', `  layer ${lay.id} bounded query`, false, qr.body.error.message);
      else {
        const fs = qr.body?.features || [];
        const g0 = fs[0]?.geometry;
        record('dwr', `  layer ${lay.id} bounded query`, Array.isArray(fs),
          `${fs.length} feature(s)${g0 ? `, first at ${g0.y}, ${g0.x}` : ''}; ${corsNote(qr.acao)}`);
      }
    }
  }
}

function invMerc(x, y) {
  const R = 6378137;
  return { lon: x / R * 180 / Math.PI, lat: (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI };
}
function geoExtent(e, wkid) {
  if (wkid === 4326 || wkid === 4269) return { w: e.xmin, s: e.ymin, e: e.xmax, n: e.ymax };
  if (wkid === 3857 || wkid === 102100 || wkid === 900913) {
    const a = invMerc(e.xmin, e.ymin), b = invMerc(e.xmax, e.ymax);
    return { w: a.lon, s: a.lat, e: b.lon, n: b.lat };
  }
  return null;
}
function placeExtent(e, wkid) {
  const g = geoExtent(e, wkid);
  if (!g) return [];
  return RIVERS.filter(r => !(g.e < r.bbox[0] || g.w > r.bbox[2] || g.n < r.bbox[1] || g.s > r.bbox[3]))
    .map(r => r.id);
}
function centreOf(e, wkid) {
  if (wkid === 3857 || wkid === 102100 || wkid === 900913)
    return { x: (e.xmin + e.xmax) / 2, y: (e.ymin + e.ymax) / 2 };
  const g = geoExtent(e, wkid);
  if (!g) return null;
  const lon = (g.w + g.e) / 2, lat = (g.s + g.n) / 2, R = 6378137;
  return { x: lon * Math.PI / 180 * R,
           y: R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) };
}

/* ------------------------------------------------------------------ */
async function checkBase() {
  const tiles = [
    ['Esri imagery', 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/10/396/166'],
    ['Esri topo', 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/10/396/166'],
    ['CARTO dark', 'https://basemaps.cartocdn.com/dark_all/10/166/396.png']
  ];
  for (const [name, url] of tiles) {
    const r = await hit(url, { expect: 'bin' });
    record('base', name, !r.err && r.res?.ok && /image/.test(r.ct || ''),
      r.err || `HTTP ${r.res?.status} ${r.ct} ${r.body?.bytes ?? 0} bytes`);
  }
}

/* ------------------------------------------------------------------ */
async function checkWorker() {
  const p = bathyProxy();
  if (!p) { record('worker', 'BATHY_PROXY', null, 'empty — the app talks to DWR directly; nothing to check'); return; }
  const ok = await hit(`${p}/arcgisimg/rest/services/Bathymetry?f=json`);
  record('worker', 'allowed path', !ok.err && ok.res?.ok,
    ok.err || `HTTP ${ok.res.status}; ${corsNote(ok.acao)}; cache ${ok.res.headers.get('x-thalweg-cache')}`);
  const bad = await hit(`${p}/arcgis/rest/services/Boundaries/MapServer?f=json`);
  record('worker', 'refuses everything else', bad.res?.status === 403,
    bad.err || `HTTP ${bad.res?.status} (403 expected)`);
  /* fetch() normalises "/../" before it leaves, so the escape has to be
     sent percent-encoded to reach the Worker at all. */
  const trav = await hit(`${p}/arcgisimg/rest/services/Bathymetry/%2e%2e/%2e%2e/admin?f=json`);
  record('worker', 'refuses encoded traversal', trav.res?.status === 403,
    trav.err || `HTTP ${trav.res?.status} (403 expected)`);
}

/* ------------------------------------------------------------------ */
/* CDEC — the Feather River's gauges.
 *
 * No USGS site on the Feather mainstem publishes instantaneous values, so
 * the only live readings for that river are DWR's, on CDEC. Two things
 * here are worth failing on rather than merely reporting: whether the two
 * declared stations still answer, and whether the units are still the
 * units the parser accepts. A sensor re-scaled at the far end should stop
 * the reading, not change it.
 *
 * CDEC sends no Access-Control-Allow-Origin, which is why the app reads it
 * through its own proxy and not directly. That is checked too.
 */
async function checkCdec() {
  const base = 'https://cdec.water.ca.gov';
  const want = {
    20: { type: 'FLOW',    units: 'CFS'   },
    1:  { type: 'RIV STG', units: 'FEET'  },
    25: { type: 'TEMP W',  units: 'DEG F' }
  };

  for (const river of RIVERS.filter(r => (r.cdecGauges || []).length)) {
    for (const g of river.cdecGauges) {
      const url = `${base}/dynamicapp/req/JSONDataServlet?Stations=${g.id}` +
        `&SensorNums=1,20,25&dur_code=E&Start=${isoDaysAgo(1)}&End=${isoDaysAgo(-1)}`;
      const r = await hit(url);
      if (r.err || !r.res?.ok) { record('cdec', `${g.id} answers`, false, r.err || `HTTP ${r.res.status}`); continue; }
      const rows = Array.isArray(r.body) ? r.body : null;
      if (!rows) { record('cdec', `${g.id} answers`, false, 'the response was not an array'); continue; }

      /* Readings only: the sentinel rows are not data. */
      const live = rows.filter(x => Number(x.value) > -9998);
      record('cdec', `${g.id} answers`, live.length > 0,
        `${rows.length} row(s), ${live.length} with a reading; ${corsNote(r.acao)}`);

      const seen = new Map();
      for (const x of live) if (!seen.has(x.SENSOR_NUM)) seen.set(x.SENSOR_NUM, x);
      for (const [num, spec] of Object.entries(want)) {
        const got = seen.get(Number(num));
        if (!got) {
          /* A station that never had the sensor is not a failure; the app
             shows a dash. It is recorded so a sensor that disappears is
             visible in the diff. */
          record('cdec', `  ${g.id} sensor ${num} (${spec.type})`, null, 'not reported by this station');
          continue;
        }
        record('cdec', `  ${g.id} sensor ${num} (${spec.type})`,
          String(got.units).toUpperCase() === spec.units,
          `${got.sensorType} = ${got.value} ${got.units} @ ${got.obsDate}` +
          (String(got.units).toUpperCase() === spec.units ? '' : ` — expected ${spec.units}; the app will refuse this rather than convert it`));
      }
    }
  }

  /* The reason the proxy exists. */
  const cors = await hit(`${base}/dynamicapp/req/JSONDataServlet?Stations=GRL&SensorNums=20&dur_code=E&Start=${isoDaysAgo(1)}&End=${isoDaysAgo(-1)}`);
  record('cdec', 'CDEC sends no CORS header, so the proxy is required',
    !cors.acao, cors.acao ? `it now sends ${cors.acao} — the app could read it directly` : 'confirmed');
}
function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
const groups = { usgs: checkUsgs, tide: checkTide, dwr: checkDwr, cdec: checkCdec, base: checkBase, worker: checkWorker };
for (const [name, fn] of Object.entries(groups)) {
  if (only && only !== name) continue;
  if (!asJson) console.log(`\n=== ${name} ===`);
  try { await fn(); }
  catch (e) { record(name, 'group crashed', false, String(e && e.stack || e)); }
}

const failed = results.filter(r => r.ok === false);
if (asJson) console.log(JSON.stringify({ results, failed: failed.length }, null, 2));
else {
  console.log(`\n${results.filter(r => r.ok === true).length} passed, ${failed.length} failed, ${results.filter(r => r.ok === null).length} informational.`);
  if (failed.length) console.log('Anything marked FAIL is something the app currently claims and cannot do.');
}
process.exit(failed.length ? 1 : 0);
