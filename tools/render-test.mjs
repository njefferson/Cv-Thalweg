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
/* Geolocation is granted here and a fixed position is set, because a locate
   button nobody has pressed is a button that has never been shown to work.
   The coordinate is Rio Vista's landing, roughly — it only has to be near
   this reach for the "how far are you" arithmetic to have something to say. */
const HERE = { latitude: 38.1554, longitude: -121.6910, accuracy: 65 };
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block',
  permissions: ['geolocation'], geolocation: HERE });

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
/* Every request the page makes, so "the position never leaves the device" can
   be asserted rather than asserted about. A count is not enough — when it
   fails, the name of what went out is the whole diagnosis. */
const netCalls = [];
ctx.on('request', r => netCalls.push(r.url()));
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

/* getSamples along a POLYLINE — what the profile is built on. A channel shape
   with a deep middle and shallow ends, and a real gap in it, because a survey
   that measured nothing at a spot must leave a hole rather than a reading at
   the surface. */
let profileCalls = 0;
await ctx.route('**/Bathy_TEST_SacramentoRvr/ImageServer/getSamples**', r => {
  const u = new URL(r.request().url());
  const g = JSON.parse(decodeURIComponent(u.searchParams.get('geometry')));
  if (!g.paths) return r.fallback();          /* the envelope form, used elsewhere */
  profileCalls++;
  const [a0, b0] = [g.paths[0][0], g.paths[0][g.paths[0].length - 1]];
  const n = Number(u.searchParams.get('sampleCount')) || 60;
  const samples = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const lon = a0[0] + (b0[0] - a0[0]) * t;
    const lat = a0[1] + (b0[1] - a0[1]) * t;
    /* Deepest in the middle: a channel, not a ramp. */
    const depth = -(4 + 26 * Math.sin(Math.PI * t));
    const hole = t > 0.42 && t < 0.5;         /* weed, dropped by the sounder */
    samples.push({ location: { x: lon, y: lat }, value: hole ? 'NoData' : depth.toFixed(2) });
  }
  return json(r, { samples });
});

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
/* 39 KB OF COORDINATES THAT ONLY THE PROFILE USES. Loading them at boot made
   every reader parse the whole main stem of four rivers before the map
   appeared, including readers who only wanted the water temperature. They are
   precached, so it is a read from the device and works offline — it is just
   not part of getting the map on screen. */
check('the river centrelines are not loaded at boot',
  await page.evaluate(() => typeof RIVER_LINES === 'undefined'),
  await page.evaluate(() => typeof RIVER_LINES));

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
/* The coordinate this used to assert — 38.1583 — was the fixture's own
   invention, served back to the app by the fixture and checked against itself.
   NOAA publishes 38.145 from both its index and its per-station endpoint. The
   app reads the baked file now, so the position is NOAA's; what this checks is
   that a declared station still resolves to its name and to somewhere real,
   and `fetch-stations --check` is what holds every baked station to having a
   position at all. */
check('the declared station still has its NOAA name and a real position',
  await page.evaluate(() => {
    const t = state.tides.sacramento || {};
    const st = (t.stations || []).filter(s => s.id === '9415316')[0];
    return !!st && st.name === 'Rio Vista' &&
           Number.isFinite(st.lat) && Number.isFinite(st.lon) &&
           st.lat > 37 && st.lat < 41;
  }));
/* And asking for the others is a deliberate act that then works. */
await page.evaluate(() => {
  const b = [...document.querySelectorAll('#panel-water button')]
    .find(x => /stations added since this build/.test(x.textContent));
  if (b) b.click();
});
await page.waitForTimeout(2500);
/* The button no longer downloads stations the app already ships — it asks
   whether NOAA has ADDED any since the build, so what it must surface is the
   one the fixture invented and the baked file has never heard of. */
check('the button asks NOAA once and surfaces only what is new',
  mdIndexHits === 1 &&
  await page.evaluate(() => { const s = document.querySelector('select[id^=tidestation]');
    return !!s && [...s.options].some(o => /Synthetic Mokelumne/.test(o.textContent)); }),
  'index fetched ' + mdIndexHits + ' time(s)');
/* IT USED TO VANISH THE MOMENT IT WAS PRESSED — it was only drawn when nothing
   had been stored yet — so a reader pressed a button, the button went away, and
   nothing said what it had found, whether anything was added, or whether this
   was permanent or had to be done again every visit. */
const disc = await page.evaluate(() => {
  const fold = document.querySelector('#panel-water details.foldbox');
  const btn = [...document.querySelectorAll('#panel-water button')]
    .find(x => /Check NOAA/.test(x.textContent));
  const panel = document.getElementById('panel-water').textContent;
  return { still: !!btn, label: btn ? btn.textContent.trim() : '',
           fold: !!fold, shut: fold ? !fold.open : null,
           summary: fold ? fold.querySelector('summary').textContent.trim() : '',
           said: /Last checked/.test(panel),
           permanence: /you do not need to (do this again|check again)|no need to check again/.test(panel),
           found: /NOAA had added/.test(panel) };
});
check('the stations button is still there after it has been used',
  disc.still, JSON.stringify(disc));
check('it says when it last checked and what it found',
  disc.said && disc.found, JSON.stringify(disc));
check('it says whether the result is kept or has to be done again',
  disc.permanence, JSON.stringify(disc));
check('and it offers to check again rather than pretending it is finished',
  /again/i.test(disc.label), disc.label);
/* IT WAS PUSHING THE TIDE OFF THE SCREEN — four sentences about NOAA's file
   sizes between the station picker and the first high or low. Folded shut, and
   its summary has to say what is inside without being opened. */
check('the NOAA block is folded shut rather than filling the panel',
  disc.fold && disc.shut === true, JSON.stringify(disc));
check('its summary says what is inside without opening it',
  /added since this build/i.test(disc.summary) && /found|none|not asked/i.test(disc.summary),
  disc.summary);
/* AND IT MUST NOT COUNT THE BAKED STATIONS AS NEW. Before the bake this button
   stored every station in the river's box; read back afterwards under the new
   question it reported forty-four "added since this build", which is the number
   that SHIP with it. A stored answer whose meaning changed is not stale, it is
   wrong. */
const stamped = await page.evaluate(() => {
  const raw = Object.keys(localStorage).filter(k => /tidestations/.test(k))
    .map(k => JSON.parse(localStorage.getItem(k)));
  return { any: raw.length, stamped: raw.every(r => typeof r.against === 'string'),
           against: raw[0] && raw[0].against,
           baked: (typeof TIDE_STATIONS_META === 'object' && TIDE_STATIONS_META.fetchedAt) || null };
});
check('a stored answer is stamped with the build it was measured against',
  stamped.any > 0 && stamped.stamped && stamped.against === stamped.baked,
  JSON.stringify(stamped));
const foreign = await page.evaluate(() => {
  const k = Object.keys(localStorage).find(x => /sacramento:tidestations/.test(x));
  const was = localStorage.getItem(k);
  const o = JSON.parse(was); o.against = 'an-older-build'; o.list = new Array(44).fill(0)
    .map((_, i) => ({ id: 'x' + i, name: 'Baked ' + i, lat: 38.1, lon: -121.6 }));
  localStorage.setItem(k, JSON.stringify(o));
  renderWater();
  const txt = document.getElementById('panel-water').textContent;
  localStorage.setItem(k, was);
  return { claims44: /added 44 station/.test(txt), saysNotAsked: /not asked/i.test(txt) };
});
check('an answer from an older build is not reported as new stations',
  !foreign.claims44 && foreign.saysNotAsked, JSON.stringify(foreign));

/* --- readings that have gone old ---------------------------------------
   The strip said they were old and nothing else: not when it last tried, not
   when it would try next, not how to ask now. All three were already true
   facts about the app and none was on screen. */
const stale = await page.evaluate(() => {
  const g = state.gauges[state.riverId];
  g.fetchedAt = Date.now() - 10 * 3600 * 1000;
  g.stale = true;
  renderWater();
  const t = document.getElementById('panel-water').textContent;
  return {
    saysOld: /Stored readings, \d+ h old/.test(t),
    saysWhenTried: /Last tried at/.test(t),
    saysNext: /every ten minutes|not trying|offline/.test(t),
    saysNoCooldown: /no waiting period/.test(t),
    button: !!document.getElementById('retrybtn')
  };
});
check('a stale reading says when the app last tried', stale.saysWhenTried, JSON.stringify(stale));
check('it says when it will try again on its own', stale.saysNext, JSON.stringify(stale));
check('it says there is no waiting period', stale.saysNoCooldown, JSON.stringify(stale));
check('and it offers a way to ask right now', stale.button, JSON.stringify(stale));

/* --- home ---------------------------------------------------------------
   The picker could always reach the landing, but a menu you have to open and
   find the right line in is not a way back. */
check('Home is offered once you are inside a river',
  await page.evaluate(() => !document.getElementById('homebtn').hidden));
await page.click('#homebtn');
await page.waitForTimeout(1500);
const home = await page.evaluate(() => ({
  river: document.getElementById('riverpick').value,
  hidden: document.getElementById('homebtn').hidden,
  allRivers: document.body.classList.contains('all-rivers')
}));
check('Home goes back to the page the app opens on',
  home.river === '' && home.allRivers, JSON.stringify(home));
check('and it stops being offered once you are already there',
  home.hidden, JSON.stringify(home));
await page.selectOption('#riverpick', 'sacramento');
await page.waitForTimeout(2000);

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

/* --- nothing sweeps a basin unless it is asked to --- */
check('no basin sweep goes out on load',
  await page.evaluate(() => !(state.net || []).some(n => /bBox/.test(n.label || ''))),
  await page.evaluate(() => (state.net || []).map(n => n.label).join(', ')));

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
/* A STATION IS A PLACE AND BELONGS ON THE MAP. They were never drawn — not the
   ones the discovery button finds, and not even the declared one the tide is
   being read from — so the picker was a list of names with no way to find out
   where any of them is. And the gauge must still win the tap where the two sit
   at the same place, which Rio Vista does. */
check('tide stations are drawn on the map',
  await page.evaluate(() => state.tideLayer && state.tideLayer.getLayers().length > 0),
  'tide markers: ' + await page.evaluate(() => state.tideLayer ? state.tideLayer.getLayers().length : -1));
check('the one being read is drawn differently from the rest',
  await page.evaluate(() => {
    const t = state.tides[state.riverId];
    const live = state.tideLayer.getLayers()
      .filter(m => Math.abs(m.options.radius - 8) < 0.01);
    return !!t && live.length === 1;
  }));

check('the label carries the reading, not just the name',
  /cfs/i.test(await page.evaluate(() => {
    const el = document.querySelector('.leaflet-popup-content'); return el ? el.textContent : ''; })),
  await page.evaluate(() => { const el = document.querySelector('.leaflet-popup-content'); return el ? el.textContent : '(none)'; }));

/* --- where I am ---------------------------------------------------------
   The dot, the ring, and the two rules that make it honest: the ring is the
   browser's own accuracy to scale rather than decoration, and nothing about
   the position may reach the network. */
check('the map carries a locate control',
  await page.evaluate(() => !!document.getElementById('herebtn')));
check('the locate control is big enough for a thumb',
  await page.evaluate(() => {
    const r = document.getElementById('herebtn').getBoundingClientRect();
    return r.width >= 44 && r.height >= 44;
  }),
  await page.evaluate(() => {
    const r = document.getElementById('herebtn').getBoundingClientRect();
    return Math.round(r.width) + 'x' + Math.round(r.height);
  }));

const netBefore = netCalls.length;
await page.click('#herebtn');
await page.waitForFunction(() => window.state && window.state.here, null, { timeout: 10000 });
await page.waitForTimeout(600);

check('pressing it puts you on the map',
  await page.evaluate(() => state.hereLayer && state.hereLayer.getLayers().length > 0),
  'layers: ' + await page.evaluate(() => state.hereLayer ? state.hereLayer.getLayers().length : -1));
check('the position it drew is the position the browser gave',
  await page.evaluate(h => Math.abs(state.here.lat - h.latitude) < 1e-6 &&
                           Math.abs(state.here.lon - h.longitude) < 1e-6, HERE),
  await page.evaluate(() => JSON.stringify(state.here)));
/* A browser two kilometres sure of itself and one eight metres sure hand back
   the same shape of answer. Drawing both as a bare dot claims a precision only
   one of them has. */
check('an accuracy ring is drawn to scale, and does not take the tap',
  await page.evaluate(() => {
    const ring = state.hereLayer.getLayers().filter(l => typeof l.getRadius === 'function' &&
      l.options.interactive === false)[0];
    return !!ring && ring.getRadius() > 0;
  }),
  await page.evaluate(() => state.hereLayer.getLayers().map(l => l.options.interactive + ':' +
    (l.getRadius ? Math.round(l.getRadius()) : 'n/a')).join(' ')));
check('the map moved to where you are',
  await page.evaluate(h => {
    const c = state.map.getCenter();
    return Math.abs(c.lat - h.latitude) < 0.05 && Math.abs(c.lng - h.longitude) < 0.05;
  }, HERE),
  await page.evaluate(() => JSON.stringify(state.map.getCenter())));
/* YOUR COORDINATE NEVER LEAVES THE DEVICE — which is not the same claim as
   "nothing goes out", and the first version of this check made the stronger
   one and was wrong. Moving the map to you loads basemap tiles for that area,
   so something DOES go out; what must never go out is the position itself, in
   a query string, a path or a body. That is the sentence the About panel makes
   and this is what holds it. */
const after = netCalls.slice(netBefore);
const leaked = after.filter(u =>
  /38\.15|-?121\.69|38%2E15|121%2E69/.test(u) ||
  /lat|lon|lng|point|geometry/i.test(u));
check('locating never puts your coordinate in a request',
  leaked.length === 0, leaked.join(', '));
/* And the only thing it may cause is the basemap drawing where you now are. */
const notTiles = after.filter(u => !/arcgisonline\.com|basemaps|tile/i.test(u));
check('the only requests locating causes are basemap tiles',
  notTiles.length === 0, notTiles.join(', '));
/* A control sits on the map, so a press on it is also a press on the map, and
   a press on the map asks the survey how deep it is there. */
check('pressing it does not also ask for a depth',
  !(await page.evaluate(() => !!document.querySelector('.leaflet-popup') &&
    /deep|depth|survey/i.test(document.querySelector('.leaflet-popup').textContent))));
check('the dot says when the fix was taken and that it is not kept',
  await page.evaluate(() => {
    const dot = state.hereLayer.getLayers().filter(l => l.options.interactive !== false)[0];
    if (!dot) return '';
    const n = dot.getPopup().getContent();
    return typeof n === 'string' ? n : n.textContent;
  }).then(t => /taken at/.test(t) && /not saved/.test(t) && /not sent anywhere/.test(t)),
  await page.evaluate(() => {
    const dot = state.hereLayer.getLayers().filter(l => l.options.interactive !== false)[0];
    if (!dot) return '(no dot)';
    const n = dot.getPopup().getContent();
    return typeof n === 'string' ? n : n.textContent;
  }));

/* A browser that hands back accuracy 0 is not one that is perfectly sure — it
   is one that did not answer. The first version stored that as a number and
   the dot said "good to about 0 m", which is the most confident lie the app
   could tell. No ring, and it says so in words. */
const vague = await page.evaluate(() => {
  state.here = { lat: 38.1554, lon: -121.6910, acc: 0, at: Date.now() };
  drawHere(false);
  const rings = state.hereLayer.getLayers().filter(l => l.options.interactive === false);
  const dot = state.hereLayer.getLayers().filter(l => l.options.interactive !== false)[0];
  const n = dot && dot.getPopup().getContent();
  return { rings: rings.length, text: n ? (typeof n === 'string' ? n : n.textContent) : '' };
});
check('an accuracy of zero draws no ring and claims no precision',
  vague.rings === 0 && /did not say how accurate/.test(vague.text) && !/about 0/.test(vague.text),
  JSON.stringify(vague));

/* --- what changed, after an update -------------------------------------
   The strip that offers an update belongs to the OLD build and has never heard
   of the release it is offering, so the only moment anything in this app knows
   what changed is after the reload. That dialog was wired at boot and had no
   check on it at all: it opened the whole About panel at its top, which is
   "What Thalweg is" — so the one thing a reader had just asked for was several
   screens down under everything they already knew. */
const news = await page.evaluate(() => {
  showWhatsNew();
  const d = document.getElementById('whatsnew');
  const body = document.getElementById('newbody');
  return {
    open: d.open,
    title: document.getElementById('newtitle').textContent,
    items: [...body.querySelectorAll('li')].map(li => li.textContent),
    focused: document.activeElement && document.activeElement.id,
    older: !!document.getElementById('newolder'),
    aboutOpen: document.getElementById('about').open
  };
});
check('an update opens a dialog that leads with what changed',
  news.open && !news.aboutOpen, JSON.stringify({ open: news.open, aboutOpen: news.aboutOpen }));
check('it names the version you just got',
  news.title.includes(await page.evaluate(() => VERSION)), news.title);
check('it lists this version\u2019s changes, and only this version\u2019s',
  news.items.length === await page.evaluate(() =>
    RELEASES.filter(r => r.v === VERSION)[0].changes.length),
  news.items.length + ' shown');
check('the first thing in it is a change, not the front of the About panel',
  news.items.length > 0 && !/What Thalweg is/.test(news.items[0] || ''), news.items[0]);
check('the whole history is one press away rather than in your way', news.older);
check('the dialog takes focus when it opens', news.focused === 'newtitle', news.focused);
/* Patch notes are for the reader. This is the app's own copy asserted against
   the same closed vocabulary tools/notes-check.mjs holds the source to, so a
   note that reaches the screen cannot be machinery even if it got past the
   file gate some other way. */
check('nothing on that screen is written at the developer',
  !/\b(endpoint|bounding box|JSON|regex|callback|z-index|service worker|cached?|identifier)\b/i
    .test(news.items.join(' ')),
  news.items.join(' ').slice(0, 200));
await page.evaluate(() => document.getElementById('whatsnew').close());

/* --- the tide is predicted at ONE place ---------------------------------
   A reader who has not been told assumes a tide is a property of the river. On
   this water it is not: high water at Rio Vista and at Freeport are hours
   apart. The picker said "Station" and nothing else, so a chart could be read
   against the wrong place with nothing on screen to suggest it was a choice. */
const tideCopy = await page.evaluate(() => {
  const p = document.getElementById('panel-water').textContent;
  const lab = [...document.querySelectorAll('#panel-water label')]
    .map(l => l.textContent.trim());
  return { saysOnePlace: /not for the river/.test(p),
           saysDiffers: /turns at different times along it/.test(p),
           saysPickNearest: /nearest where you will actually be/.test(p),
           label: lab.find(l => /Predicted at|Station/.test(l)) || '' };
});
check('the tide says it is predicted at one place, not for the river',
  tideCopy.saysOnePlace, JSON.stringify(tideCopy));
check('it says the tide turns at different times along the river',
  tideCopy.saysDiffers, JSON.stringify(tideCopy));
check('it tells you to pick the one nearest you',
  tideCopy.saysPickNearest, JSON.stringify(tideCopy));
check('the picker is labelled with what it does, not just "Station"',
  /Predicted at/.test(tideCopy.label), tideCopy.label);
/* And once the app knows where you are, it stops making you solve it — with no
   help from this test. The first version re-rendered the panel here and passed,
   which proved only that the section CAN draw the offer; the app was not
   redrawing it when a position arrived, so a reader pressed Where I am and the
   tide panel went on saying nothing. */
const nearest = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('#panel-water button')]
    .find(b => /^Use .+ from you$/.test(b.textContent.trim()));
  const said = /nearest station to where you are/.test(document.getElementById('panel-water').textContent);
  return { offered: !!btn, label: btn ? btn.textContent.trim() : '', alreadyNearest: said,
           here: state.here || null,
           stations: (state.tides[state.riverId] || {}).stations
             ? (state.tides[state.riverId].stations || []).length : -1 };
});
check('knowing where you are, it names the nearest station or says you are on it',
  nearest.offered || nearest.alreadyNearest, JSON.stringify(nearest));

/* --- the key ------------------------------------------------------------
   Gauges, tide stations, marks and your own position are four different dots,
   and the only way to find out which was which was to tap one. The two
   tide-station sizes in particular looked deliberate without saying why. */
const key = await page.evaluate(() => {
  const d = document.getElementById('maplegend');
  const rows = [...d.querySelectorAll('.keyrow')].map(r => r.textContent.trim());
  return { rows, swatches: d.querySelectorAll('.keyrow i.sw').length,
           head: !!d.querySelector('.keyhead') };
});
check('the map has a key', key.head && key.rows.length > 0, JSON.stringify(key));
check('it says what a gauge dot is',
  key.rows.some(r => /gauge/i.test(r)), key.rows.join(' | '));
check('it distinguishes the tide station being read from the others',
  key.rows.some(r => /being read/i.test(r)) && key.rows.some(r => /Other tide station/i.test(r)),
  key.rows.join(' | '));
check('it says what your own position looks like',
  key.rows.some(r => /^You\b/.test(r)), key.rows.join(' | '));
/* A key whose dot is merely dot-shaped teaches a symbol the map does not use. */
check('every entry carries a swatch drawn to the marker geometry',
  key.swatches === key.rows.length, key.swatches + ' swatches for ' + key.rows.length + ' rows');
/* IT MUST NEVER NAME A SYMBOL THAT IS NOT ON THE MAP. */
const honest = await page.evaluate(() => {
  const marks = state.markLayer.getLayers().length;
  const rows = [...document.querySelectorAll('#maplegend .keyrow')].map(r => r.textContent);
  return { marks, claimsMarks: rows.some(r => /Your mark/.test(r)) };
});
check('it does not name a mark type when no mark is drawn',
  honest.marks > 0 || !honest.claimsMarks, JSON.stringify(honest));
/* A KEY IS INFORMATION, NOT A TARGET. Sitting on the map it covers pins, and
   the first version made every pin beneath it untappable — caught by the
   marker-at-the-edge check, which simply stopped opening. This pans a gauge
   under the key and taps it there. */
const under = await tapAndMeasure(() => {
  const m = state.gaugeLayer.getLayers()[0];
  const d = document.getElementById('maplegend').getBoundingClientRect();
  const map = document.getElementById('map').getBoundingClientRect();
  const p = state.map.latLngToContainerPoint(m.getLatLng());
  state.map.panBy([p.x - (d.left - map.left + d.width / 2),
                   p.y - (d.top - map.top + d.height / 2)], { animate: false });
});
check('a pin underneath the key can still be tapped',
  under.open, JSON.stringify(under));

/* On a phone the map is small, so it can be put away — and it comes back. */
await page.evaluate(() => document.querySelector('#maplegend .keyhead button').click());
check('the key can be hidden, leaving a way back to it',
  await page.evaluate(() => !!document.getElementById('keyopen') &&
    !document.querySelector('#maplegend .keyrow')));
await page.evaluate(() => document.getElementById('keyopen').click());
check('and reopening it brings every entry back',
  await page.evaluate(() => document.querySelectorAll('#maplegend .keyrow').length) === key.rows.length);

/* --- the profile --------------------------------------------------------
   The app is named after the deepest line in a channel and could not draw one.
   A point says how deep it is where you stand; a line says where the channel
   runs and which side of it you are on. */
await page.click('#tab-layers');
await page.waitForTimeout(1200);
check('the Layers panel offers a profile, and says whose line it is',
  await page.evaluate(() => {
    const t = document.getElementById('panel-layers').textContent;
    return /Depth along a line/.test(t) && /USGS national hydrography/.test(t) &&
           /no coordinate down the middle of these rivers was invented here/.test(t);
  }),
  (await page.textContent('#panel-layers')).slice(0, 200));
/* The pointerless route: two taps on a map is a finger's job, and the same
   question has to be askable without one. */
/* Over water the survey actually covers. A line drawn across the whole basin
   at zoom 9 leaves the surveyed reach entirely, and "no published survey covers
   this line" would be the correct answer to the wrong question. */
await page.evaluate(() => state.map.setView([38.45, -121.60], 13));
await page.waitForTimeout(600);
const before = profileCalls;
await page.click('#panel-layers button:text-is("Cross-section across the river here")');
await page.waitForTimeout(3000);

const prof = await page.evaluate(() => {
  const svg = document.getElementById('profsvg');
  const t = svg.querySelector('title');
  const p = state.profile || {};
  return {
    shown: !document.getElementById('profile').hidden,
    paths: svg.querySelectorAll('path').length,
    note: document.getElementById('profnote').textContent,
    title: t ? t.textContent : null,
    none: p.none || null,
    deepest: p.deepest,
    bands: p.bands ? p.bands.length : 0,
    onMap: state.profLayer.getLayers().length
  };
});
check('the line found a survey to ask', !prof.none, JSON.stringify(prof).slice(0, 240));
check('a profile is drawn', prof.shown && prof.paths > 0, JSON.stringify(prof));
check('one request per survey, not one per sample',
  profileCalls - before === 1, 'calls: ' + (profileCalls - before));
check('the line it profiled is on the map too', prof.onMap >= 2, JSON.stringify(prof));
check('it reports the deepest sounding it actually found',
  Math.abs(Math.abs(prof.deepest) - 30) < 1.5, String(prof.deepest));
check('the sentence names the survey and the depth',
  /deepest published sounding is/.test(prof.note) &&
  /TEST Sacramento Rvr/.test(prof.note),
  prof.note.slice(0, 220));
/* AND IT SAYS WHEN YOU ARE NOT ON IT. A profile with no marker and no sentence
   leaves a reader assuming the line is where they are standing. */
check('it says plainly when you are nowhere near the line you drew',
  /you are not marked on it/.test(prof.note), prof.note.slice(0, 240));
/* THE PICTURE IS STRETCHED VERTICALLY AND MUST SAY SO. A mile of river against
   thirty feet of water drawn true to scale is a flat line; the shape is what
   this is for, and a reader must not read a slope off it. */
check('it says the vertical scale is stretched',
  /vertical scale is stretched/.test(prof.note), prof.note.slice(-160));
check('the drawing carries the same sentence for a screen reader',
  prof.title === prof.note, prof.title.slice(0, 100));
/* A GAP IS NOT A BOTTOM. Weed defeats the sounder and DWR drops those cells;
   a line drawn straight across invents a bed between two places nobody
   measured, so the run must be broken. */
check('missing data breaks the line rather than being drawn through',
  await page.evaluate(() => {
    const ps = [...document.querySelectorAll('#profsvg path')].filter(p => p.getAttribute('stroke'));
    return ps.length >= 2;
  }),
  await page.evaluate(() => [...document.querySelectorAll('#profsvg path')]
    .map(p => p.getAttribute('stroke') || 'fill').join(',')));
/* Zoom is scroll, so a finger already knows how to use it. */
const w0 = await page.evaluate(() => document.getElementById('profsvg').getBoundingClientRect().width);
await page.click('#profin');
await page.waitForTimeout(400);
const w1 = await page.evaluate(() => document.getElementById('profsvg').getBoundingClientRect().width);
check('stretching the profile makes it wider so it can be scrolled', w1 > w0 * 1.3,
  Math.round(w0) + ' -> ' + Math.round(w1));
/* --- where the depth actually is ---------------------------------------
   The surveys are a few reaches of hundreds of kilometres, the app opens on the
   whole basin, and nothing marked them — so "I cannot see where the depth is"
   was a correct reading of the map. */
await page.click('#tab-layers');
await page.waitForTimeout(1000);
/* DEPTH FIRST, BASEMAP LAST. The panel used to open with three radio buttons
   for which picture to draw the water on, so somebody looking for depth met a
   preference and two orange boxes before anything about the bottom. */
const order = await page.evaluate(() => {
  const t = document.getElementById('panel-layers').textContent;
  return { where: t.indexOf('where the depth is'), base: t.indexOf('Basemap'),
           hasWhere: /Bathymetry — where the depth is/.test(t) };
});
check('the panel leads with where the depth is', order.hasWhere, JSON.stringify(order));
/* THE PROFILE IS WHAT GETS HUNTED FOR, so it comes before depth-at-a-point. */
check('the profile is above the single-point reading',
  await page.evaluate(() => {
    const t = document.getElementById('panel-layers').textContent;
    return t.indexOf('Depth along a line') > -1 &&
           t.indexOf('Depth along a line') < t.indexOf('Depth at a point');
  }));
check('and its heading says the word people are looking for',
  /Depth along a line — the profile/.test(await page.textContent('#panel-layers')));
check('and the basemap chooser is below it, not above',
  order.where > -1 && order.base > order.where, JSON.stringify(order));
check('the surveyed reaches are drawn on the map',
  await page.evaluate(() => state.surveyLayer && state.surveyLayer.getLayers().length > 0),
  'boxes: ' + await page.evaluate(() => state.surveyLayer ? state.surveyLayer.getLayers().length : -1));
/* Context, never a target: a footprint must not swallow a tap meant for a pin. */
check('a survey outline never takes a tap',
  await page.evaluate(() => state.surveyLayer.getLayers()
    .every(l => l.options.interactive === false)));
/* THE PROPERTY IS "you can see the surveyed water", not "the map zoomed in".
   The first version asserted the span got smaller, which is only true when you
   happen to be zoomed out at the time — it failed the moment a previous check
   left the map close in over the river, which is exactly when a reader would
   press this. */
await page.click('#panel-layers button:text-is("Take me to the surveyed water")');
await page.waitForTimeout(1200);
const shown = await page.evaluate(() => {
  const river = byId(state.riverId);
  const s = surveyBounds(river);
  const b = state.map.getBounds();
  return { has: b.contains(s),
           /* and not so far out that the surveys are a speck */
           tight: (b.getNorth() - b.getSouth()) < (s.getNorth() - s.getSouth()) * 6 };
});
check('one press shows you the whole of the surveyed water',
  shown.has, JSON.stringify(shown));
check('and does not leave it as a speck in the middle of the state',
  shown.tight, JSON.stringify(shown));

/* --- a cross-section is perpendicular to the river ----------------------
   This used to draw a line between the left and right edges of the screen,
   which at the zoom the app opens on is a line across the state. */
const beforeX = profileCalls;
await page.click('#tab-layers');
await page.waitForTimeout(800);
await page.click('#panel-layers button:text-is("Cross-section across the river here")');
await page.waitForTimeout(3000);
const xs = await page.evaluate(() => {
  const p = state.profile || {};
  return { none: p.none || null, len: p.length,
           note: document.getElementById('profnote').textContent,
           cross: !!state.profCross,
           width: state.profCross ? state.profCross.width : 0 };
});
check('the cross-section is a river\u2019s width, not a screen\u2019s',
  xs.cross && xs.width <= 700 && xs.len < 700,
  JSON.stringify({ width: xs.width, metres: Math.round(xs.len || 0) }));
check('and it says it cut at right angles to the river',
  /cut at right angles to the river/.test(xs.note), xs.note.slice(0, 160));
await page.click('#profclear');
await page.waitForTimeout(400);

/* --- getting to a place the app already knows --------------------------- */
await page.click('#tab-water');
await page.waitForTimeout(1200);
check('every gauge with a position offers to show itself on the map',
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#panel-water .rdg')];
    const withGo = rows.filter(r => r.querySelector('.gobtn')).length;
    return withGo > 0;
  }),
  await page.evaluate(() => document.querySelectorAll('#panel-water .gobtn').length + ' go buttons'));
const wasCentre = await page.evaluate(() => JSON.stringify(state.map.getCenter()));
await page.click('#panel-water .gobtn');
await page.waitForTimeout(1000);
check('pressing it moves the map there',
  await page.evaluate(() => JSON.stringify(state.map.getCenter())) !== wasCentre);

/* --- getting to the water ----------------------------------------------
   NOT BOAT RAMPS, and the app must never call them that: no published ramp
   dataset for these rivers could be reached, and the one candidate is coastal
   beaches with none on this water. What CDFW publishes is its own lands. */
await page.click('#tab-layers');
await page.waitForTimeout(1000);
const acc = await page.evaluate(() => {
  const t = document.getElementById('panel-layers').textContent;
  return {
    heading: /Getting to the water/.test(t),
    saysNotRamps: /THEY ARE NOT BOAT RAMPS/.test(t),
    saysCentroid: /middle of a property rather than a spot on the bank/.test(t),
    onMap: state.accessLayer ? state.accessLayer.getLayers().length : -1,
    baked: (ACCESS_LANDS.sacramento || []).length,
    source: /wildlife\.ca\.gov|arcgis/.test(ACCESS_META.source)
  };
});
check('the panel offers a way to the water', acc.heading, JSON.stringify(acc));
check('and never calls it a boat ramp', acc.saysNotRamps, JSON.stringify(acc));
check('it says the pin is the middle of a property, not the bank',
  acc.saysCentroid, JSON.stringify(acc));
check('the sites are baked in and say where they came from',
  acc.baked > 10 && acc.source, JSON.stringify(acc));
check('and they are drawn on the map', acc.onMap === acc.baked, JSON.stringify(acc));
/* EVERY SITE IS ON THE RIVER IT IS FILED UNDER. A bounding box put the Yolo
   Bypass under the American; the centreline answers it properly. */
check('no site is filed under a river it is nowhere near',
  await page.evaluate(() => Object.keys(ACCESS_LANDS).every(k =>
    ACCESS_LANDS[k].every(s => typeof s.km === 'number' && s.km <= 12.5))),
  await page.evaluate(() => {
    const bad = [];
    Object.keys(ACCESS_LANDS).forEach(k => ACCESS_LANDS[k]
      .filter(s => !(s.km <= 12.5)).forEach(s => bad.push(k + ':' + s.name)));
    return bad.join(', ') || 'none';
  }));
/* Context, and reachable: a place you can stand is worth tapping, but the
   reading still wins where they overlap. */
check('a public-land pin can be tapped and says what kind of place it is',
  await page.evaluate(() => {
    const m = state.accessLayer.getLayers()[0];
    if (!m) return false;
    const n = m.getPopup().getContent();
    const t = typeof n === 'string' ? n : n.textContent;
    return /km to the river/.test(t) && /not a boat ramp/.test(t);
  }));
const accBefore = await page.evaluate(() => state.accessLayer.getLayers().length);
await page.click('#panel-layers button:text-is("Show them on the map")');
await page.waitForTimeout(600);
check('they can be turned off',
  await page.evaluate(() => state.accessLayer.getLayers().length) === 0,
  'was ' + accBefore);
await page.click('#panel-layers button:text-is("Show them on the map")');
await page.waitForTimeout(600);
check('and back on',
  await page.evaluate(() => state.accessLayer.getLayers().length) === accBefore);

/* --- the river's own line -----------------------------------------------
   A profile "of the river" means the river's line, not one somebody drew down
   the middle by eye. USGS publishes it; tools/fetch-centrelines.mjs bakes it
   in. The whole main stem is 598 km and the state has surveyed a few reaches
   of it, so profiling the river must give the surveyed stretch and SAY that,
   rather than spreading ninety samples over six hundred kilometres of water
   nobody measured. */
await page.click('#tab-layers');
await page.waitForTimeout(1000);
check('the controls are offered whether or not the centreline has loaded',
  await page.evaluate(() => !![...document.querySelectorAll('#panel-layers button')]
    .find(b => /Profile down the river itself/.test(b.textContent))));
check('the panel says the line is USGS\u2019s and not this app\u2019s',
  /USGS national hydrography/.test(await page.textContent('#panel-layers')));
const beforeRiver = profileCalls;
await page.click('#panel-layers button:text-is("Profile down the river itself")');
await page.waitForTimeout(4000);
check('pressing it fetches the centreline and it is USGS\u2019s',
  await page.evaluate(() => Array.isArray(RIVER_LINES.sacramento) &&
    RIVER_LINES.sacramento.length > 100 &&
    /nationalmap/.test(RIVER_LINES_META.source)),
  await page.evaluate(() => typeof RIVER_LINES === 'object'
    ? (RIVER_LINES.sacramento || []).length + ' points' : 'not loaded'));
const riv = await page.evaluate(() => {
  const p = state.profile || {};
  return { none: p.none || null, len: p.length, bands: p.bands ? p.bands.length : 0,
           note: document.getElementById('profnote').textContent,
           whole: !!state.profWhole,
           of: state.profWhole ? state.profWhole.of : 0,
           used: state.profWhole ? state.profWhole.to - state.profWhole.from : 0 };
});
check('profiling the river draws something', !riv.none, JSON.stringify(riv).slice(0, 200));
check('it profiles the surveyed stretch rather than the whole 600 km',
  riv.whole && riv.used < riv.of && riv.len < 120000,
  JSON.stringify({ of: riv.of, used: riv.used, metres: Math.round(riv.len) }));
check('and the sentence says that is what it did',
  /Down the river\u2019s own line, along the .* the state has surveyed/.test(riv.note),
  riv.note.slice(0, 160));
check('it still costs one request per survey',
  profileCalls - beforeRiver === 1, 'calls: ' + (profileCalls - beforeRiver));

await page.click('#profclear');
await page.waitForTimeout(400);
check('clearing it takes the line off the map as well as the drawing',
  await page.evaluate(() => document.getElementById('profile').hidden &&
    state.profLayer.getLayers().length === 0));

await page.screenshot({ path: '/tmp/thalweg-fixtures.png' });
check('no page errors', errs.length === 0, errs.join(' | '));
console.log(`\n${pass} passed, ${fail} failed.`);
await b.close();
process.exit(fail ? 1 : 0);
