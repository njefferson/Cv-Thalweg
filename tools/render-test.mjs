/* Render tests against the documented response shapes.
 *
 * These do NOT prove the services answer this way — only tools/verify.mjs
 * can say that, and only from a machine that can reach them. What they do
 * prove is that when a response of the documented shape arrives, the
 * parsers, the ribbon, the tide curve and the sounding renderer do the
 * right thing with it, including the awkward parts: a missing temperature,
 * a -999999, a null depth, a truncated feature query.
 *
 * Needs playwright-core and a server:  node tools/serve.mjs &
 *   node tools/render-test.mjs [http://127.0.0.1:8787]
 */
import { chromium } from 'playwright-core';
import { chromiumLaunch, OFFLINE_ARGS } from './lib-browser.mjs';
const BASE = process.argv[2] || 'http://127.0.0.1:8787';

const now = new Date();
const iso = d => d.toISOString().slice(0, 19) + '.000-07:00';
const coopsT = d => d.toISOString().slice(0, 16).replace('T', ' ');

function ts(code, name, lat, lon, param, value, unit) {
  return {
    sourceInfo: { siteName: name, siteCode: [{ value: code }],
      geoLocation: { geogLocation: { latitude: lat, longitude: lon } } },
    variable: { variableCode: [{ value: param }],
      unit: unit ? { unitCode: unit } : undefined },
    values: [{ value: [{ value: String(value), dateTime: iso(now) }] }]
  };
}
const USGS_BODY = { value: { timeSeries: [
  ts('11455420', 'SACRAMENTO R A RIO VISTA CA', 38.1583, -121.6853, '00060', 14200),
  ts('11455420', 'SACRAMENTO R A RIO VISTA CA', 38.1583, -121.6853, '00065', 4.12),
  ts('11455420', 'SACRAMENTO R A RIO VISTA CA', 38.1583, -121.6853, '00010', 21.4),
  ts('11447650', 'SACRAMENTO R A FREEPORT CA',  38.4558, -121.5000, '00060', 13100),
  ts('11447650', 'SACRAMENTO R A FREEPORT CA',  38.4558, -121.5000, '00010', 19.9),
  /* the no-reading sentinel: must show a dash, never a minus one million */
  ts('11425500', 'SACRAMENTO R A VERONA CA',    38.7844, -121.5983, '00060', 6120),
  ts('11425500', 'SACRAMENTO R A VERONA CA',    38.7844, -121.5983, '00010', -999999),
  /* Turbidity: one in the unit the app accepts, one in a unit it must refuse
     rather than convert by guesswork, and one gauge with no sensor at all. */
  ts('11455420', 'SACRAMENTO R A RIO VISTA CA', 38.1583, -121.6853, '63680', 67.4, 'FNU'),
  ts('11447650', 'SACRAMENTO R A FREEPORT CA',  38.4558, -121.5000, '63680', 2.0, 'NTU'),
  /* Velocity: Rio Vista's flow is positive above, so a NEGATIVE velocity
     there is two instruments disagreeing and must be reported as that rather
     than as a fact about the river. Verona's agrees, and its unit is wrong on
     purpose so the refusal is proved rather than assumed. */
  ts('11455420', 'SACRAMENTO R A RIO VISTA CA', 38.1583, -121.6853, '72255', -0.90, 'ft/sec'),
  ts('11447650', 'SACRAMENTO R A FREEPORT CA',  38.4558, -121.5000, '72255', 1.48, 'ft/sec'),
  ts('11425500', 'SACRAMENTO R A VERONA CA',    38.7844, -121.5983, '72255', 2.10, 'm/sec')
] } };

const hourly = [], hilo = [];
for (let i = -6; i < 30; i++) {
  const d = new Date(now.getTime() + i * 3600000);
  hourly.push({ t: coopsT(d), v: (2.5 + 1.8 * Math.sin(i / 3.9)).toFixed(3) });
  if (i % 6 === 0) hilo.push({ t: coopsT(d), v: (2.5 + 1.8 * Math.sin(i / 3.9)).toFixed(3),
    type: i % 12 === 0 ? 'H' : 'L' });
}

const FOLDER = { services: [
  { name: 'Bathymetry/Bathy_TEST_SacramentoRvr', type: 'ImageServer' },
  { name: 'Bathymetry/Bathy_TEST_Elsewhere',     type: 'ImageServer' }
] };
const merc = (lon, lat) => ({
  x: lon * Math.PI / 180 * 6378137,
  y: 6378137 * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))
});
function imgMeta(name, w, s, e, n) {
  const a = merc(w, s), b = merc(e, n);
  return { name, description: name + ' — synthetic fixture, not a real survey.',
    pixelSizeX: 0.3048, pixelSizeY: 0.3048,
    extent: { xmin: a.x, ymin: a.y, xmax: b.x, ymax: b.y,
      spatialReference: { wkid: 102100, latestWkid: 3857 } } };
}
const SBM_LAYERS = { layers: [
  { id: 31, name: 'i06_TEST_FeatherRiver_June2017', type: 'Feature Layer',
    description: 'Synthetic fixture standing in for a single beam survey.',
    extent: { xmin: -121.75, ymin: 38.75, xmax: -121.45, ymax: 39.45,
      spatialReference: { wkid: 4326 } },
    fields: [{ name: 'OBJECTID', type: 'esriFieldTypeOID' },
             { name: 'ELEVATION', type: 'esriFieldTypeDouble' }] },
  { id: 99, name: 'i06_TEST_NoDepthField', type: 'Feature Layer',
    extent: { xmin: -121.75, ymin: 38.75, xmax: -121.45, ymax: 39.45,
      spatialReference: { wkid: 4326 } },
    fields: [{ name: 'OBJECTID', type: 'esriFieldTypeOID' }] }
] };

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('PASS  ' + n))
                             : (fail++, console.log('FAIL  ' + n + (d ? ' — ' + d : '')));

const b = await chromium.launch({ ...chromiumLaunch({ args: OFFLINE_ARGS }) });
/* Service workers are blocked here: this file tests what the page does
   with a response, and a service worker sitting in front of the fixtures
   would be testing the worker instead. Offline behaviour is tools/a11y.mjs
   and the real thing. */
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });

const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

await ctx.route('**/nwis/iv/**', r => json(r, USGS_BODY));
await ctx.route('**/datagetter**', r =>
  json(r, { predictions: r.request().url().includes('interval=hilo') ? hilo : hourly }));
/* Two different NOAA endpoints behind one path. The per-station record is
   2.6KB and is what the app asks for on every load; the whole index is two
   megabytes and is only fetched when somebody presses the button, so the
   stub answers each by shape and the checks below tell them apart. */
const MD_STATIONS = [
  { id: '9415316', name: 'Rio Vista', lat: 38.1583, lng: -121.6853 },
  { id: '9415478', name: 'New Hope Bridge', lat: 38.2267, lng: -121.49 },
  { id: '9416174', name: 'Sacramento', lat: 38.5817, lng: -121.5061 },
  { id: '9415257', name: 'Terminous, South Fork', lat: 38.1103, lng: -121.5006 },
  { id: '9999999', name: 'Synthetic Mokelumne', lat: 38.15, lng: -121.40 }];
let mdIndexHits = 0;
await ctx.route('**/mdapi/**', r => {
  const m = /\/stations\/(\d+)\.json/.exec(r.request().url());
  if (m) return json(r, { stations: MD_STATIONS.filter(s => s.id === m[1]) });
  mdIndexHits++;
  return json(r, { stations: MD_STATIONS });
});
await ctx.route('**/arcgisimg/rest/services/Bathymetry?f=json', r => json(r, FOLDER));
await ctx.route('**/Bathy_TEST_SacramentoRvr/ImageServer?f=json', r =>
  json(r, imgMeta('Bathy_TEST_SacramentoRvr', -121.75, 38.30, -121.45, 38.65)));
await ctx.route('**/Bathy_TEST_Elsewhere/ImageServer?f=json', r =>
  json(r, imgMeta('Bathy_TEST_Elsewhere', 10.0, 50.0, 10.2, 50.2)));
await ctx.route('**/MapServer/layers?f=json', r => json(r, SBM_LAYERS));

/* The weirs. Nothing has been over its crest all summer, so the state that
   MATTERS cannot be verified against the live file — it is verified here
   instead: Tisdale over by 1.4 ft, Fremont blank (quiet), Colusa a value the
   file should never contain, and NWPS forecast rows above the measured ones
   that must not be read as measurements. */
const WEIR_CSV = [
  'WY 2026,MLW Daily Avg, MLW Ft above Crest, MLW Ft above/below Flood,' +
    'CLW Daily Avg, CLW Ft above Crest, CLW Ft above/below Flood,' +
    'TIS Daily Avg, TIS Ft above Crest, TIS Ft above/below Flood,' +
    'FRE Daily Avg, FRE Ft above Crest, FRE Ft above/below Flood',
  'NWPS Forecast 2026-09-01,76.10,9.9,,60.80,,,44.00,9.9,,16.85,9.9,',
  'NWPS Forecast 2026-08-31,76.10,9.9,,60.80,,,44.00,9.9,,16.85,9.9,',
  '2026-08-28,76.10,,,60.80,not-a-number,,45.40,1.4,,16.85,,',
  '2026-08-27,76.10,,,60.80,,,44.00,,,16.70,,',
  'Notes:'
].join('\n');
await ctx.route('**/alertsovertop.csv', r => r.fulfill({ status: 200,
  headers: { 'content-type': 'text/csv', 'access-control-allow-origin': '*' },
  body: WEIR_CSV }));

/* CDEC, with every awkward case it actually produces: the -9999 sentinel
   on rows that have not happened yet, a station with no temperature
   sensor, a unit that is not the one expected, and a timestamp with no
   offset that is Pacific by convention. */
const CDEC_ROWS = [
  { stationId:'GRL', durCode:'E', SENSOR_NUM:20, sensorType:'FLOW',
    obsDate:'2026-8-27 10:00', value:7000, dataFlag:' ', units:'CFS' },
  { stationId:'GRL', durCode:'E', SENSOR_NUM:20, sensorType:'FLOW',
    obsDate:'2026-8-27 11:00', value:7749, dataFlag:' ', units:'CFS' },
  { stationId:'GRL', durCode:'E', SENSOR_NUM:1,  sensorType:'RIV STG',
    obsDate:'2026-8-27 11:00', value:76.17, dataFlag:' ', units:'FEET' },
  { stationId:'GRL', durCode:'E', SENSOR_NUM:25, sensorType:'TEMP W',
    obsDate:'2026-8-27 11:00', value:65.1, dataFlag:' ', units:'DEG F' },
  /* a later row that has not been observed yet */
  { stationId:'GRL', durCode:'E', SENSOR_NUM:20, sensorType:'FLOW',
    obsDate:'2026-8-27 23:00', value:-9999, dataFlag:' ', units:'CFS' },
  { stationId:'GRL', durCode:'E', SENSOR_NUM:25, sensorType:'TEMP W',
    obsDate:'2026-8-27 23:00', value:-9999, dataFlag:' ', units:'DEG F' },
  /* the far end renumbers or re-scales a sensor: no reading, not a wrong one */
  { stationId:'GRL', durCode:'E', SENSOR_NUM:1,  sensorType:'RIV STG',
    obsDate:'2026-8-27 12:00', value:23.2, dataFlag:' ', units:'METERS' },
  /* FSB has no temperature sensor at all */
  { stationId:'FSB', durCode:'E', SENSOR_NUM:20, sensorType:'FLOW',
    obsDate:'2026-8-27 10:45', value:8806, dataFlag:' ', units:'CFS' },
  { stationId:'FSB', durCode:'E', SENSOR_NUM:1,  sensorType:'RIV STG',
    obsDate:'2026-8-27 10:45', value:31.84, dataFlag:' ', units:'FEET' }
];
await ctx.route('**/JSONDataServlet**', r => json(r, CDEC_ROWS));
await ctx.route('**/MapServer/31/query**', r => {
  const feats = [];
  for (let i = 0; i < 3000; i++) feats.push({
    attributes: { ELEVATION: i === 0 ? null : -(5 + (i % 40) * 0.5) },
    geometry: { x: -121.6 + (i % 60) * 0.0004, y: 38.9 + Math.floor(i / 60) * 0.0004 } });
  return json(r, { features: feats, exceededTransferLimit: true });
});
await ctx.route('**/exportImage**', r => r.fulfill({ status: 200, contentType: 'image/png',
  headers: { 'access-control-allow-origin': '*' },
  body: Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080600000' +
    '01f15c4890000000a49444154789c6300010000050001' +
    '0d0a2db40000000049454e44ae426082', 'hex') }));
await ctx.route('**/tile/**', r => r.abort());
await ctx.route('**/cartocdn.com/**', r => r.abort());
await ctx.route('**/tileservice.charts.noaa.gov/**', r => r.abort());

const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(BASE + '/', { waitUntil: 'load' });
await page.waitForTimeout(3000);
await page.evaluate(() => { const d = document.getElementById('welcome'); if (d.open) d.querySelector('button').click(); });
await page.waitForTimeout(1500);

/* The app opens on All rivers. These checks are about one river's data, so
   pick one; the All view has its own checks at the end. */
check('a first run opens on All rivers',
  await page.evaluate(() => document.getElementById('riverpick').value) === '',
  await page.evaluate(() => document.getElementById('riverpick').value));
await page.selectOption('#riverpick', 'sacramento');
await page.waitForTimeout(2000);

/* --- gauges and the ribbon --- */
const water = (await page.textContent('#panel-water')).replace(/\s+/g, ' ');
check('site name comes from the API', water.includes('SACRAMENTO R A RIO VISTA CA'), water.slice(0, 200));
check('celsius is shown in fahrenheit', water.includes('70.5'), water.slice(0, 400));
check('a -999999 temperature shows a dash, not a number',
  /VERONA[^]*?6,?120|6120/.test(water) && !water.includes('-999999') && !water.includes('-1799998'), water.slice(0, 600));
check('an unconfirmed id that returned nothing says so',
  water.includes('no data returned for this identifier'), water.slice(0, 900));
check('temperature reading sentence appears', /fish moving|workable|holding deep|stressed/.test(water));
const note = await page.textContent('#ribbonnote');
check('ribbon plots the gauges that had positions', /3 gauges plotted/.test(note), note);
check('ribbon dots drawn', await page.evaluate(() => document.querySelectorAll('#ribbon circle').length) === 3);

/* --- tide --- */
check('tide curve drawn', await page.evaluate(() => !!document.querySelector('#tidechart path')));
check('high and low table populated', /High ·|Low ·/.test(water), water.slice(0, 300));
/* The whole station index is two megabytes and NOAA ignores every filter, so
   it must not be fetched to read a station this app already names. It was
   being fetched once per tidal river on every cold open — four of the five
   and a half megabytes a first-time reader paid. */
check('the two-megabyte station index is not fetched on load',
  mdIndexHits === 0, 'index fetched ' + mdIndexHits + ' time(s)');
check('the declared station still has its NOAA name and position',
  await page.evaluate(() => {
    const t = state.tides.sacramento || {};
    const st = (t.stations || []).filter(s => s.id === '9415316')[0];
    return !!st && st.name === 'Rio Vista' && Math.abs(st.lat - 38.1583) < 0.001;
  }));
/* And asking for the others is a deliberate act that then works. */
await page.evaluate(() => {
  const b = [...document.querySelectorAll('#panel-water button')]
    .find(x => /Look for other stations/.test(x.textContent));
  if (b) b.click();
});
await page.waitForTimeout(2500);
check('pressing the button fetches the index once and offers the extra station',
  mdIndexHits === 1 &&
  await page.evaluate(() => { const s = document.querySelector('select[id^=tidestation]');
    return !!s && [...s.options].some(o => /Synthetic Mokelumne/.test(o.textContent)); }),
  'index fetched ' + mdIndexHits + ' time(s)');

/* --- layers --- */
await page.click('#tab-layers'); await page.waitForTimeout(1200);
let layers = (await page.textContent('#panel-layers')).replace(/\s+/g, ' ');
check('a survey inside the river box is offered', layers.includes('Bathy_TEST_SacramentoRvr'), layers.slice(0, 400));
check('a survey outside it is not', !layers.includes('Bathy_TEST_Elsewhere'), layers.slice(0, 400));
check('a layer with no depth attribute says so',
  layers.includes('no depth attribute could be identified'), layers.slice(0, 900));
check('vegetation gap note present', layers.includes('missing data, not flat bottom'));

/* the Feather has a single beam layer and no raster: it must say so */
await page.selectOption('#riverpick', 'feather'); await page.waitForTimeout(2500);

/* --- CDEC --- */
const feather = await page.evaluate(() => (state.gauges.feather.rows || [])
  .filter(r => r.source === 'CDEC')
  .map(r => ({ id:r.id, flow:r.flow, stage:r.stage, tempF:r.tempF, at:r.at })));
const grl = feather.find(r => r.id === 'GRL') || {};
const fsb = feather.find(r => r.id === 'FSB') || {};
check('CDEC gives the latest real reading, not the first',
  grl.flow === 7749, JSON.stringify(grl));
check('the -9999 sentinel is discarded, not shown',
  grl.flow === 7749 && grl.tempF === 65.1, JSON.stringify(grl));
check('a reading in the wrong unit is refused, not converted by guesswork',
  grl.stage === 76.17, JSON.stringify(grl));
check('a station with no temperature sensor reports none',
  fsb.flow === 8806 && fsb.tempF === null, JSON.stringify(fsb));
check('a CDEC timestamp is read as Pacific, not as the device zone',
  grl.at === '2026-08-27T18:00:00.000Z', grl.at);
check('CDEC readings reach the panel',
  /Feather River near Gridley/.test((await page.textContent('#panel-water'))),
  (await page.textContent('#panel-water')).slice(0, 200));
layers = (await page.textContent('#panel-layers')).replace(/\s+/g, ' ');
/* --- turbidity --- */
{
  /* The panel showing at this point is the Feather's; these are the
     Sacramento's readings, so ask for that river before reading the page. */
  await page.selectOption('#riverpick', 'sacramento');
  await page.waitForTimeout(2500);
  const rows = await page.evaluate(() => (window.state.gauges.sacramento?.rows || [])
    .map(r => [r.id, r.turb]));
  const water = (await page.textContent('#panel-water')).replace(/\s+/g, ' ');
  check('turbidity in FNU reaches the panel',
    rows.some(r => r[0] === '11455420' && r[1] === 67.4), JSON.stringify(rows));
  /* A parameter code is not a unit. The same code in NTU is a different
     measurement wearing the same number, and converting by guesswork is how
     a plausible wrong reading gets on screen. */
  check('the same parameter in another unit is refused, not converted',
    rows.some(r => r[0] === '11447650' && (r[1] === null || r[1] === undefined)),
    JSON.stringify(rows));
  check('and the reading is described in words as well as a number',
    /stained/.test(water) && /67\.4/.test(water), water.slice(0, 400));
  /* A dash here would say the water is unmeasurably clear rather than that
     nobody is measuring it. */
  check('a gauge with no turbidity sensor shows no turbidity column',
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#panel-water .rdg')];
      const verona = rows.find(r => /VERONA/.test(r.textContent));
      return !!verona && !/FNU/.test(verona.textContent);
    }));
  await page.selectOption('#riverpick', 'feather');
  await page.waitForTimeout(2500);
}

/* --- velocity, and what its sign is allowed to claim --- */
{
  await page.selectOption('#riverpick', 'sacramento');
  await page.waitForTimeout(2500);
  const rows = await page.evaluate(() => (window.state.gauges.sacramento?.rows || [])
    .map(r => [r.id, r.vel, r.flow]));
  const water = (await page.textContent('#panel-water')).replace(/\s+/g, ' ');
  check('velocity in ft/sec reaches the panel',
    rows.some(r => r[0] === '11447650' && r[1] === 1.48), JSON.stringify(rows));
  check('velocity in another unit is refused, not converted',
    rows.some(r => r[0] === '11425500' && (r[1] === null || r[1] === undefined)),
    JSON.stringify(rows));
  check('a positive velocity is called downstream, and said to be measured',
    /running downstream — measured, not predicted/.test(water), water.slice(0, 500));
  /* Two instruments at one gauge disagreeing is not a fact about the river,
     and picking the likelier one would be inventing the answer. */
  check('a velocity that disagrees with its own discharge says so rather than choosing',
    /disagree about which way this water is going/.test(water) &&
    !/Rio Vista[\s\S]{0,200}running upstream/.test(water), water.slice(0, 700));
  await page.selectOption('#riverpick', 'feather');
  await page.waitForTimeout(2500);
}

/* --- the weirs --- */
{
  await page.selectOption('#riverpick', 'sacramento');
  await page.waitForTimeout(3000);
  const w = await page.evaluate(() => {
    const x = state.weirs.sacramento || {};
    return { at:x.at, over:(x.over||[]).map(o => o.w.code + ':' + o.ft),
             quiet:(x.quiet||[]).map(o => o.code), unknown:(x.unknown||[]).map(o => o.code),
             text: document.getElementById('panel-water').innerText.replace(/\s+/g, ' ') };
  });
  /* A model of a weir going over is not a weir going over. */
  check('the forecast rows are not read as measurements',
    w.at === '2026-08-28', JSON.stringify({ at: w.at }));
  check('a weir over its crest is named, with how far over and where the water goes',
    w.over.join() === 'TIS:1.4' && /Tisdale Weir is 1.4 ft over its crest/.test(w.text) &&
    /the Sutter Bypass/.test(w.text), JSON.stringify({ over: w.over }));
  check('a blank column is a quiet weir, not a missing one',
    w.quiet.indexOf('FRE') !== -1 && w.quiet.indexOf('MLW') !== -1, JSON.stringify(w.quiet));
  /* A value that is not a number is unknown. Reading it as zero would say a
     weir is quiet on the strength of a parse failure. */
  check('an unreadable value is unknown rather than quiet',
    w.unknown.join() === 'CLW' && /unknown rather than quiet/.test(w.text),
    JSON.stringify({ unknown: w.unknown }));
  /* And the standing indicator, which is the point of loading this at all:
     an alert that appears only once you have already picked the river is an
     alert for people who did not need it. */
  const strip = await page.evaluate(() => {
    const el = document.getElementById('weirstrip');
    return { hidden: el.hidden, text: el.innerText.replace(/\s+/g, ' ').trim(),
             role: el.getAttribute('role') };
  });
  check('a weir over its crest raises a standing indicator outside the panel',
    strip.hidden === false && /Tisdale Weir is 1.4 ft over its crest/.test(strip.text) &&
    /Sutter Bypass/.test(strip.text) && strip.role === 'status', JSON.stringify(strip));
  /* It is about the river, not about the app, and must not read as an update
     notice — different ground, and the update strip stays where it was. */
  check('the weir strip is not the update strip',
    await page.evaluate(() => {
      const w = document.getElementById('weirstrip'), u = document.getElementById('updatestrip');
      return u.hidden === true && w.className.indexOf('weir') !== -1 &&
        getComputedStyle(w).backgroundColor !== getComputedStyle(u).backgroundColor;
    }));
  /* It says it on the landing too, where the reader has not picked a river. */
  check('and it is raised on All rivers, not only on the river it belongs to',
    await page.evaluate(async () => {
      document.getElementById('riverpick').value = '';
      document.getElementById('riverpick').dispatchEvent(new Event('change', { bubbles:true }));
      await new Promise(r => setTimeout(r, 1200));
      return document.getElementById('weirstrip').hidden === false;
    }));
  await page.selectOption('#riverpick', 'feather');
  await page.waitForTimeout(2500);
}

/* --- the link-preview card --- */
/* A link to this app shared anywhere showed nothing: no image, no card. And
   the image must NOT be in the precache — half a megabyte that only an
   unfurler asks for is not part of what an angler downloads to work offline. */
{
  const meta = await page.evaluate(() => {
    const g = n => (document.querySelector('meta[property="' + n + '"]') || {}).content || '';
    return { img: g('og:image'), title: g('og:title'), url: g('og:url'),
             alt: g('og:image:alt'),
             card: (document.querySelector('meta[name="twitter:card"]') || {}).content || '' };
  });
  check('a shared link has a preview image, a title and an alt',
    /social-preview\.png$/.test(meta.img) && /Thalweg/.test(meta.title) &&
    meta.alt.length > 20 && meta.card === 'summary_large_image', JSON.stringify(meta));
  check('the preview image is not in what the app downloads to work offline',
    !(await page.evaluate(async () => {
      const t = await (await fetch('sw.js')).text();
      const m = /var PRECACHE = \[([\s\S]*?)\]/.exec(t);
      return !m || /social-preview/.test(m[1]);
    })));
}

check('a reach with no multibeam says so plainly',
  layers.includes('No published multibeam survey for this reach'), layers.slice(0, 600));
/* The control carries the readable name now and the machine name sits under
   it, so a reader choosing between twenty surveys is not reading identifiers
   while the catalogue can still be matched to what is on screen. */
check('a reach with single beam still offers it, by a readable name',
  layers.includes('TEST Feather River June2017'), layers.slice(0, 600));
check('and the machine name is still there to match the catalogue by',
  layers.includes('i06_TEST_FeatherRiver_June2017'), layers.slice(0, 600));

/* --- soundings, with the cap hit and a null depth in the set --- */
await page.evaluate(() => window.state.map.setView([38.90, -121.59], 14));
await page.waitForTimeout(600);
await page.click('#panel-layers button:has-text("TEST Feather River June2017")');
await page.waitForTimeout(3000);
layers = (await page.textContent('#panel-layers')).replace(/\s+/g, ' ');
check('the cap is announced when it truncates', layers.includes('cap truncated this view'), layers.slice(0, 900));
check('soundings drawn on the map',
  await page.evaluate(() => window.state.soundingLayer.getLayers().length) > 100);
check('a null depth did not become a zero',
  await page.evaluate(() => window.state.soundingRange && window.state.soundingRange[1] < 0));

/* --- a tapped pin must show its whole label, wherever the pin is --- */
/* A tooltip is drawn beside its marker and left there: it is neither
   panned into view nor flipped, so a pin near an edge — which on a phone,
   where the map is half a screen tall, is most of them — put its label
   outside the map frame, where the container's overflow cut it off.
   Tapping the pin looked like it did nothing. */
await page.selectOption('#riverpick', 'sacramento');
await page.waitForTimeout(2500);
async function tapAndMeasure(place) {
  await page.evaluate(() => { const p = document.querySelector('.leaflet-popup-close-button'); if (p) p.click(); });
  await page.evaluate(place);
  await page.waitForTimeout(500);
  const pt = await page.evaluate(() => {
    const m = state.gaugeLayer.getLayers()[0];
    const p = state.map.latLngToContainerPoint(m.getLatLng());
    const r = document.getElementById('map').getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  });
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(700);
  return await page.evaluate(() => {
    const el = document.querySelector('.leaflet-popup');
    if (!el) return { open: false };
    const t = el.getBoundingClientRect(), m = document.getElementById('map').getBoundingClientRect();
    return { open: true, inside: t.top >= m.top && t.bottom <= m.bottom &&
                                 t.left >= m.left && t.right <= m.right,
             rect: { t: Math.round(t.top), b: Math.round(t.bottom), l: Math.round(t.left), r: Math.round(t.right) },
             map:  { t: Math.round(m.top), b: Math.round(m.bottom), l: Math.round(m.left), r: Math.round(m.right) } };
  });
}
for (const [where, place] of [
  ['in the middle', () => { const m = state.gaugeLayer.getLayers()[0]; state.map.setView(m.getLatLng(), 11); }],
  ['at the top edge', () => { const m = state.gaugeLayer.getLayers()[0];
    const p = state.map.latLngToContainerPoint(m.getLatLng()); state.map.panBy([0, p.y - 8], { animate: false }); }],
  ['at the left edge', () => { const m = state.gaugeLayer.getLayers()[0];
    const p = state.map.latLngToContainerPoint(m.getLatLng()); state.map.panBy([p.x - 6, 0], { animate: false }); }],
  ['at the bottom edge', () => { const m = state.gaugeLayer.getLayers()[0];
    const p = state.map.latLngToContainerPoint(m.getLatLng());
    const h = document.getElementById('map').getBoundingClientRect().height;
    state.map.panBy([0, p.y - (h - 10)], { animate: false }); }]
]) {
  const r = await tapAndMeasure(place);
  check(`a pin ${where} shows its whole label`, r.open && r.inside, JSON.stringify(r));
}
check('the label carries the reading, not just the name',
  /cfs/i.test(await page.evaluate(() => {
    const el = document.querySelector('.leaflet-popup-content'); return el ? el.textContent : ''; })),
  await page.evaluate(() => { const el = document.querySelector('.leaflet-popup-content'); return el ? el.textContent : '(none)'; }));

await page.screenshot({ path: '/tmp/thalweg-fixtures.png' });
check('no page errors', errs.length === 0, errs.join(' | '));
console.log(`\n${pass} passed, ${fail} failed.`);
await b.close();
process.exit(fail ? 1 : 0);
