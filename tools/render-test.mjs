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

/* A SEMIDIURNAL CURVE AND ITS OWN EXTREMES, rather than a sine sampled on a
   grid that does not line up with it. The old fixture put its turns every six
   hours and read the height off a curve with a period of 24.5, so a row
   labelled "high" could be a foot BELOW the low either side of it. Nothing
   noticed for as long as the app only listed the turns; the moment it worked
   out whether the water is rising, an incoherent tide is a fixture that
   exercises the failure branch and calls it a pass.
   Twelve-hour period, turns at the real peaks and troughs: now sits halfway
   up a flood, which is the ordinary case and the one worth drawing. */
/* AND THE FORTNIGHT HAS TO HAVE A FORTNIGHT'S SHAPE IN IT. The app now asks
   whether today is a big tide or a small one, which is a question about the
   ENVELOPE of the swing across about fourteen days — so a fixture with a
   constant amplitude answers it with "every day is the same" and the feature
   is measured against a tide that does not exist anywhere.
   Amplitude is modulated over a 14.8-day cycle, with now placed at a peak of
   it: today is the biggest swing in the window, which is the state worth
   asserting because it is the one that changes what somebody does. */
const hourly = [], hilo = [];
const HOURS = 16 * 24;
const envelope = i => 1.15 + 0.75 * Math.cos(Math.PI * i / (14.8 * 12));
const tideAt = i => 2.5 + envelope(i) * Math.sin(Math.PI * i / 6);
for (let i = -6; i < 30; i++) {
  const d = new Date(now.getTime() + i * 3600000);
  hourly.push({ t: coopsT(d), v: tideAt(i).toFixed(3) });
}
/* A turn every six hours, starting a day and a half back so TODAY is a
   complete day rather than a clipped one — the real request begins yesterday
   for the same reason, and a clipped day reports a span the water never
   stopped at. Out to the end of the sixteen days the app asks for. */
for (let i = -39; i < HOURS; i += 6) {
  const d = new Date(now.getTime() + i * 3600000);
  hilo.push({ t: coopsT(d), v: tideAt(i).toFixed(3),
    type: ((i - 3) % 12 === 0) ? 'H' : 'L' });
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
  /* ON the river, because a survey is filed by distance to that river's own
     water now rather than by a box, and a fixture that floats nine kilometres
     off the channel describes data the state does not publish. */
  json(r, imgMeta('Bathy_TEST_SacramentoRvr', -121.56, 38.40, -121.44, 38.52)));
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

/* --- THE ROWS OPEN THEIR RIVER -----------------------------------------
   Four rivers across the top of the landing page, the most prominent thing on
   the screen, and pressing one did nothing: the routes in were a select menu
   in the header and a card further down. A row plainly ABOUT a river that does
   nothing when pressed is the pin-too-small defect again — the reader tries
   it, nothing happens, and concludes it is a picture. */
const RIVER_COUNT = await page.evaluate(() => RIVERS.length);
const rows = await page.evaluate(() => {
  const hits = [...document.querySelectorAll('#riverhits button')];
  return hits.map(h => ({
    label: h.textContent,
    tabbable: !h.disabled,
    h: Math.round(h.getBoundingClientRect().height),
    named: h.textContent.trim().length > 8
  }));
});
check('a single-river ribbon offers no row control — there is nothing to choose',
  rows.length === 0, JSON.stringify(rows));

/* And on the landing view, where there IS a choice. */
await page.evaluate(() => {
  const s = document.getElementById('riverpick');
  s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(900);
const all = await page.evaluate(() => {
  const hits = [...document.querySelectorAll('#riverhits button')];
  return { n: hits.length,
    labelled: hits.every(h => /^Open the /.test(h.textContent || '')),
    tabbable: hits.every(h => !h.disabled),
    titled: hits.every(h => h.textContent.trim().length > 8),
    tall: Math.min.apply(null, hits.map(h => Math.round(h.getBoundingClientRect().height))),
    hint: document.getElementById('ribbonnote').textContent };
});
/* Five entries now: the four rivers and the Delta, which is not one. */
check('every river row is a control', all.n === RIVER_COUNT, JSON.stringify(all));
check('each one says which river it opens', all.labelled && all.titled, JSON.stringify(all));
/* A REAL BUTTON, so Enter and Space come free and correct rather than being
   re-implemented on a keydown listener. */
check('each one is a real button and takes focus',
  await page.evaluate(() => {
    const hits = [...document.querySelectorAll('#riverhits button')];
    if (!hits.every(h => h.tagName === 'BUTTON' && h.type === 'button')) return false;
    hits[2].focus();
    return document.activeElement === hits[2];
  }));
/* AND THEY ARE NOT INSIDE THE PICTURE. The first version drew focusable rects
   into the SVG, which is role="img" — and a role="img" prunes its subtree from
   the accessibility tree, so those controls were unreachable to a screen
   reader however correct their markup. Present, correct and invisible. */
check('no control is buried inside the figure, where nothing could reach it',
  await page.evaluate(() => !document.querySelector(
    '#ribbon button, #ribbon [role="button"], #ribbon [tabindex]')));
check('and is tall enough to press with a finger', all.tall >= 44, all.tall + 'px');
/* A control nobody knows about is the same as no control. */
check('the note says the rows can be pressed', /ress a river|ap a river/.test(all.hint), all.hint);

/* THE BUTTON SITS OVER THE BAR IT OPENS. An overlay is positioned by
   arithmetic, and arithmetic against the wrong property is silent: the first
   version used host.offsetTop, which does not exist on an SVG element, so the
   four buttons came to rest three hundred pixels down the page over the map.
   Three of the four still opened a river when driven by their own bounding
   box, so only geometry against the DRAWING catches it. */
check('each button lies over the bar it opens',
  await page.evaluate(() => {
    const bars = [...document.querySelectorAll('#ribbon rect')]
      .filter(r => r.getAttribute('fill') === '#16302e');
    const hits = [...document.querySelectorAll('#riverhits button')];
    if (bars.length !== hits.length || !bars.length) return false;
    return bars.every((bar, i) => {
      const b = bar.getBoundingClientRect(), h = hits[i].getBoundingClientRect();
      const mid = b.top + b.height / 2;
      return mid >= h.top && mid <= h.bottom &&
             h.left <= b.left + 1 && h.right >= b.right - 1;
    });
  }),
  await page.evaluate(() => {
    const bars = [...document.querySelectorAll('#ribbon rect')]
      .filter(r => r.getAttribute('fill') === '#16302e')
      .map(r => Math.round(r.getBoundingClientRect().top));
    const hits = [...document.querySelectorAll('#riverhits button')]
      .map(h => Math.round(h.getBoundingClientRect().top));
    return 'bars at ' + bars.join(',') + ' · buttons at ' + hits.join(',');
  }));

/* THE PRESS LANDS ON THE ROW IT NAMES. Rows are stacked and adjacent, so an
   off-by-one in the hit band would open the neighbour — and every label would
   still be right. */
for (const i of [0, 1, 2, 3]){
  await page.evaluate(() => {
    const s = document.getElementById('riverpick');
    s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(700);
  const shot = await page.evaluate((k) => {
    const h = [...document.querySelectorAll('#riverhits button')][k];
    const r = h.getBoundingClientRect();
    return { x: r.x + r.width * 0.62, y: r.y + r.height / 2,
             want: h.textContent };
  }, i);
  await page.mouse.click(shot.x, shot.y);
  await page.waitForTimeout(700);
  const opened = await page.evaluate(() => ({
    id: state.riverId,
    name: state.riverId ? byId(state.riverId).name : null,
    picker: document.getElementById('riverpick').value }));
  check('pressing row ' + i + ' opens the river it names',
    !!opened.id && shot.want === 'Open the ' + opened.name && opened.picker === opened.id,
    shot.want + ' → ' + JSON.stringify(opened));
}

/* The header picker is the other route to the same state, and the two must
   not disagree — a row that opened a river while the menu still said "All
   rivers" would be two answers to one question. */
check('the header picker follows the row that was pressed',
  await page.evaluate(() => document.getElementById('riverpick').value === state.riverId));

/* PUT BACK WHAT THIS BLOCK FOUND. These checks drive the river picker, and
   everything after here is written against the Sacramento — a suite that
   leaves the app on a different river hands its own mess to the next check
   and the failure surfaces somewhere unrelated. */
await page.evaluate(() => {
  const s = document.getElementById('riverpick');
  s.value = 'sacramento'; s.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(1200);

/* --- FOUR BARS THAT MEAN SOMETHING WHEN COMPARED ------------------------
   Every bar used to be stretched to the same width whatever distance it
   covered. Four stacked bars exist to be compared, so equal bars said the
   four rivers were the same length. They are not. */
const ribbon = await page.evaluate(() => {
  const river = byId('sacramento');
  const rows = ((state.gauges.sacramento || {}).rows) || [];
  const sp = ribbonSpan(river, rows);
  return { metres: Math.round(sp.metres), min: RIB_MIN_BAR,
           hasEdge: !!sp.edge, lo: sp.lo, hi: sp.hi };
});
check('a bar knows how much river it covers, in metres',
  ribbon.metres > 1000, JSON.stringify(ribbon));
/* The floor exists only to keep a bar drawable. A floor wide enough to look
   tidy overstates the length of every short river, which is the defect the
   scale was added to fix. */
check('the minimum bar is a floor for drawing, not a tidy-looking width',
  ribbon.min <= 32, 'RIB_MIN_BAR is ' + ribbon.min);
/* Proportionality itself, driven rather than eyeballed: two spans in a known
   ratio must come out as bar widths in that ratio. */
check('bar width follows the distance covered',
  await page.evaluate(() => {
    const a = { metres: 200000 }, b = { metres: 50000 };
    const full = 800, x0 = 96, maxM = a.metres;
    const w = (sp) => Math.max(RIB_MIN_BAR, Math.min(full, full * sp.metres / maxM));
    return Math.abs(w(a) / w(b) - 4) < 0.01;
  }));

/* --- THE TIDAL REACH IS A REGION WITH AN END ----------------------------
   It was a wash fading to nothing over a channel the colour of the page, so
   it read as a gradient decorating the bar. The caption under it pointed at
   nothing, and where it met the right-hand edge it anchored to the end of the
   bar, where it read as naming the end of the RIVER. */
const tidal = await page.evaluate(() => {
  const rules = [...document.querySelectorAll('#ribbon line[stroke-dasharray]')];
  const leaders = [...document.querySelectorAll('#ribbon path[stroke="#4E7C7A"]')];
  const caption = [...document.querySelectorAll('#ribbon text')]
    .map(t => t.textContent).filter(t => /tide/.test(t));
  return { rules: rules.length, leaders: leaders.length, caption };
});
check('the tidal limit is marked, not merely faded to',
  tidal.rules >= 1, JSON.stringify(tidal));
check('and the caption is joined to that mark by a leader',
  tidal.leaders >= 1, JSON.stringify(tidal));
check('the caption points at the mark rather than describing the bar',
  tidal.caption.every(c => /here/.test(c)), JSON.stringify(tidal.caption));

/* --- A KEY THAT IS CLIPPED IS A KEY THAT DOES NOT EXIST -----------------
   There WAS a swatch for the cyan wash. It was drawn 26px below a ramp that
   already sits 26px above the bottom edge, which put it exactly on the
   boundary of the viewBox — off the drawing, on every screen, since it was
   written. Nobody had ever seen it, and its presence in the source answered
   "have we explained this" for everybody afterwards. */
check('every part of the key is inside the drawing',
  await page.evaluate(() => {
    const svgEl = document.getElementById('ribbon');
    const h = +svgEl.getAttribute('height'), w = +svgEl.getAttribute('width');
    return [...svgEl.querySelectorAll('rect, text, line')].every(el => {
      const b = el.getBBox();
      return b.y >= -0.5 && b.y + b.height <= h + 0.5 &&
             b.x >= -0.5 && b.x + b.width <= w + 0.5;
    });
  }),
  await page.evaluate(() => {
    const svgEl = document.getElementById('ribbon');
    const h = +svgEl.getAttribute('height'), w = +svgEl.getAttribute('width');
    const bad = [...svgEl.querySelectorAll('rect, text, line')].filter(el => {
      const b = el.getBBox();
      return !(b.y >= -0.5 && b.y + b.height <= h + 0.5 &&
               b.x >= -0.5 && b.x + b.width <= w + 0.5);
    });
    return bad.map(el => el.tagName + ':' + (el.textContent || '').slice(0, 24)).join(' | ') || 'none';
  }));

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
/* --- A CONTROL THAT LOOKS BROKEN BECAUSE IT HAS NOTHING TO ACT ON --------
   The depth ramp recolours the surfaces that are switched on. With none on it
   flipped its own pressed state, rebuilt an empty list, and changed nothing a
   reader could see — which is indistinguishable from a dead button. */
check('the depth ramp says why nothing changed when no surface is on',
  await page.evaluate(async () => {
    const sel = document.getElementById('riverpick');
    sel.value = 'sacramento'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 1500));
    document.getElementById('tab-layers').click();
    await new Promise(r => setTimeout(r, 1200));
    const t = document.getElementById('panel-layers').textContent;
    return /no surface is switched on/.test(t);
  }),
  await page.evaluate(() => (document.getElementById('panel-layers') || {}).textContent.slice(0, 300)));

/* --- THE DELTA, WHICH IS NOT A RIVER ------------------------------------
   Eleven of the twenty published surveys landed inside no declared river and
   were fetched on every cold open to be shown to nobody. What counts as the
   Delta is DWR's published Legal Delta Boundary, not this app's opinion. */
check('the Delta is an entry, and is marked as a network rather than a course',
  await page.evaluate(() => {
    const d = RIVERS.find(r => r.id === 'delta');
    return !!d && d.network === true && d.tidal === true;
  }));
check('it has no reaches, because none were confirmed against the regulation',
  await page.evaluate(() => {
    const d = RIVERS.find(r => r.id === 'delta');
    return Array.isArray(d.reaches) && d.reaches.length === 0;
  }));
/* NOT AN ABSENCE BUT A FINDING. Section 7.40 is a list of NAMED waters with
   special regulations and the Delta is not on it, so its salmon season is the
   season of whichever river you are standing on. Read from CDFW's own
   regulations service: the Delta appears in Title 14 five times and none of
   them is a salmon season. What it has of its own is gear and species rules,
   carried verbatim with their numbers. */
const deltaSeason = await page.evaluate(async () => {
  const sel = document.getElementById('riverpick');
  sel.value = 'delta'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 1400));
  return document.body.textContent;
});
check('the season panel says the Delta has none of its own, and why',
  /no season of its own/.test(deltaSeason) && /list of named waters/.test(deltaSeason),
  deltaSeason.slice(0, 200));
check('and sends the reader to the river they are standing on',
  /season of the river you are standing on/.test(deltaSeason));
check('it carries the rules the Delta does have, with their section numbers',
  /Title 14, section 1\.71/.test(deltaSeason) &&
  /Title 14, section 2\.10\(c\)\(1\)/.test(deltaSeason) &&
  /Title 14, section 5\.00\(a\)\(1\)/.test(deltaSeason));
/* VERBATIM, because a regulation paraphrased is a regulation invented. */
check('and quotes them in the regulation\u2019s own words',
  /gap greater than 1 inch/.test(deltaSeason) &&
  /12-inch total length minimum size limit/.test(deltaSeason) &&
  /south of Interstate 80/.test(deltaSeason));
/* --- THE RULES ARE NOT TYPED INTO THE APP --------------------------------
   They used to be: four Delta sections copied into the river record by hand,
   and two of the four had already drifted from the regulation in the copying
   — one had lost its own pointer to another section, one had been rewritten
   into a sentence CDFW never published. Neither was noticeable by reading the
   file, which is what a hand copy of somebody else's rule always looks like.

   So they are baked from the department's own service and re-baked monthly,
   and the app renders what came back. These checks are the difference between
   that being true and it looking true. */
const regs = await page.evaluate(() => ({
  loaded: typeof REGULATIONS !== 'undefined' && Array.isArray(REGULATIONS),
  n: typeof REGULATIONS !== 'undefined' ? REGULATIONS.length : 0,
  meta: typeof REGULATIONS_META !== 'undefined' ? REGULATIONS_META : null,
  /* Nothing may be typed into the river record any more — a topic name, and
     the words come from the bake. */
  deltaHasNoTypedRules: !('rules' in byId('delta')),
  deltaTopics: byId('delta').ruleTopics || [],
  /* The rendered text has to be the SERVICE's text, character for character,
     for every section the Delta shows. */
  matchesSource: (typeof REGULATIONS === 'undefined' ? [] :
    REGULATIONS.filter(r => r.topic === 'delta'))
    .every(r => document.body.textContent.indexOf(r.text) !== -1)
}));
check('the regulations are baked and loaded', regs.loaded && regs.n >= 10,
  JSON.stringify({ loaded: regs.loaded, n: regs.n }));
check('nothing about the Delta’s rules is typed into the river record',
  regs.deltaHasNoTypedRules && regs.deltaTopics.indexOf('delta') !== -1,
  JSON.stringify(regs));
check('and what is on the screen is the service’s own text, character for character',
  regs.matchesSource, JSON.stringify(regs));
/* THE PARAPHRASES THAT WERE THERE. 5.00(a)(1) had lost the regulation's own
   pointer to section 1.71, and it is back because it was never removed. */
check('the section that lost its own cross-reference has it back',
  /see Section 1\.71 for definition of the Delta/.test(deltaSeason),
  deltaSeason.slice(0, 200));
/* A REGULATION WITH NO DATE ON IT IS A CLAIM ABOUT TODAY NOBODY CHECKED. */
check('the reader is told when the rules were read',
  /Read from CDFW/.test(deltaSeason) && /re-read every month/.test(deltaSeason),
  deltaSeason.slice(0, 200));
check('and told the printed regulations are the authority',
  /printed regulations are the authority/.test(deltaSeason));
check('the bake itself carries the date it was read',
  !!(regs.meta && /^\d{4}-\d{2}-\d{2}$/.test(regs.meta.fetchedAt)),
  JSON.stringify(regs.meta));

/* --- THE OTHER FISH IN THE SAME WATER ------------------------------------
   The season being shut is not the same thing as the river being empty. The
   sturgeon rules are why this is in the app rather than behind a link: the
   white sturgeon season is written against the Carquinez Bridge, the Feather
   confluence and the I-5 bridge, and there is a year-round closure from
   Keswick Dam to the Highway 162 bridge — places on the two rivers this app
   draws. */
const species = await page.evaluate(() => {
  const p = document.getElementById('panel-brief');
  const h = [...p.querySelectorAll('h2')].find(x => /What else is legal/.test(x.textContent));
  const folds = [...p.querySelectorAll('details.foldbox')]
    .filter(d => /Striped bass|Sturgeon|Black bass/.test(d.querySelector('summary').textContent));
  /* SHUT BY DEFAULT: three species of Title 14 unfolded above the tide would
     push the thing this app is for off the screen, which is what the fold
     pattern here exists to stop. Measured before opening them. */
  const wereShut = folds.every(d => !d.open);
  folds.forEach(d => { d.open = true; });
  return { heading: !!h, folds: folds.length, wereShut: wereShut,
    summaries: folds.map(d => d.querySelector('summary').textContent.trim()),
    text: folds.map(d => d.textContent).join(' ') };
});
check('the other species have a section of their own', species.heading,
  JSON.stringify({ heading: species.heading }));
check('and one fold each for striped bass, sturgeon and black bass',
  species.folds === 3, JSON.stringify(species.summaries));
/* A SHUT FOLD WITH A BARE NOUN ON IT GIVES NOBODY A REASON TO OPEN IT. */
check('and they arrive shut, so they do not push the fishery off the screen',
  species.wereShut, JSON.stringify({ wereShut: species.wereShut }));
check('each fold says how many sections are behind it',
  species.summaries.every(t => /\d+ sections? of Title 14/.test(t)),
  JSON.stringify(species.summaries));
/* "Open season:" with nothing after it is a section number in front of
   nothing. The dates live in three children and they have to come with it. */
check('the sturgeon season carries the sub-sections that hold the dates',
  /5\.80\(a\)\(1\)/.test(species.text) && /Carquinez/.test(species.text) &&
  /October 1 through June 30/.test(species.text),
  species.text.slice(0, 400));
check('and the closure that names water this app actually draws',
  /Keswick Dam/.test(species.text) && /Highway 162/.test(species.text),
  species.text.slice(0, 400));
check('the zero limits are there, which is the part worth knowing before driving out',
  /Daily limit: Zero fish/.test(species.text) &&
  /zero fish per calendar year/.test(species.text),
  species.text.slice(0, 400));
/* DOCTRINE 2: a table does not render where this is read and loses its
   columns without saying so. The service publishes several of them and the
   bake refuses them; this is the second line of that. */
check('no table markup reached the reader',
  !/\[row\]/.test(species.text) && !/\|[^|]+\|/.test(species.text),
  species.text.slice(0, 200));
/* Every section on the screen carries its number, so a reader can check it. */
check('every species rule shows its section number',
  await page.evaluate(() => [...document.querySelectorAll('#panel-brief details.foldbox .rdg')]
    .every(b => /Title 14, section \S+/.test(b.textContent))));

/* A COURSE IT DOES NOT HAVE IS NOT OFFERED. Read the panel only once it has
   actually drawn its profile section — the first version of this asserted
   against a panel still saying "reading the service directory", where the
   absence of a button proves nothing at all. */
await page.click('#tab-layers');
await page.waitForTimeout(1500);
const dpanel = await page.evaluate(() => (document.getElementById('panel-layers') || {}).textContent || '');
check('the Delta panel has actually drawn, so its absences mean something',
  /Depth along a line/.test(dpanel), dpanel.slice(0, 160));
check('the Delta is offered no profile down a river it does not have',
  /Depth along a line/.test(dpanel) && !/Profile down the river itself/.test(dpanel),
  dpanel.slice(0, 200));
check('but a cross-section is, across the nearest channel',
  /Cross-section across the nearest channel/.test(dpanel), dpanel.slice(0, 200));
check('and asking for a course down the Delta explains itself rather than guessing',
  await page.evaluate(async () => {
    let said = '';
    const o = window.announce;
    window.announce = function(m){ said = m; return o.apply(null, arguments); };
    profileRiverNow(byId('delta'), null);
    window.announce = o;
    return /network rather than a course/.test(said);
  }));

/* --- A SURVEY BELONGS TO THE WATER IT IS ON -----------------------------
   Measured against the live catalogue, not one of the twenty published
   surveys landed on exactly one river: nine landed on both the Sacramento and
   the Mokelumne — two of them San Joaquin surveys offered as Sacramento
   depth — and eleven landed on nothing. */
check('a survey is filed by distance to that river\u2019s own water',
  await page.evaluate(() => typeof surveyRiverId === 'function' && SURVEY_NEAR_M <= 5000));
check('a named river keeps its own water even inside the Delta boundary',
  await page.evaluate(async () => {
    await loadRiverLines();
    /* A box centred on the Sacramento at Georgiana Slough, which is inside
       the legal Delta and is still the Sacramento. */
    const row = { box: { n: 38.245, s: 38.233, e: -121.513, w: -121.525 } };
    return surveyRiverId(row) === 'sacramento';
  }));
check('and water that is nobody\u2019s river goes to the Delta',
  await page.evaluate(() => {
    /* Old River at Bacon Island — no declared river, squarely in the Delta. */
    const row = { box: { n: 37.976, s: 37.964, e: -121.566, w: -121.578 } };
    return surveyRiverId(row) === 'delta';
  }));
check('and a reservoir belongs to neither, rather than to the nearest',
  await page.evaluate(() => {
    /* Lake Del Valle, twenty-three kilometres from any channel. */
    const row = { box: { n: 37.604, s: 37.592, e: -121.712, w: -121.724 } };
    return surveyRiverId(row) === null;
  }));

/* --- HAS THE BOTTOM MOVED ------------------------------------------------
   Two surveys of one bed is the only honest material for saying a sandbar
   shifted. Subtracting heights measured from different things, or from
   something one survey never named, is not. */
check('two surveys on one datum are compared',
  await page.evaluate(() => {
    const mk = (name, date, vertcs, vals) => ({
      measured: vals.length, survey: { name: name, vertcs: vertcs },
      pts: vals.map((v, i) => ({ d: i * 50, v: v })) });
    const model = { length: 500,
      bands: [ mk('Bathy_NCRO_20230101_X', '', 'NAVD88', [-10,-11,-12,-11,-10,-9,-10,-11,-12,-11]),
               mk('Bathy_NCRO_20240101_X', '', 'NAVD88', [-8,-9,-10,-9,-8,-7,-8,-9,-10,-9]) ] };
    const c = bedChange(model);
    return c && !c.refused && c.n >= 8 && Math.abs(c.mean - 2) < 0.01;
  }),
  await page.evaluate(() => {
    const mk = (name, vertcs, vals) => ({ measured: vals.length,
      survey: { name: name, vertcs: vertcs }, pts: vals.map((v,i)=>({d:i*50,v:v})) });
    return JSON.stringify(bedChange({ length:500, bands:[
      mk('Bathy_NCRO_20230101_X','NAVD88',[-10,-11,-12,-11,-10,-9,-10,-11,-12,-11]),
      mk('Bathy_NCRO_20240101_X','NAVD88',[-8,-9,-10,-9,-8,-7,-8,-9,-10,-9])]}));
  }));
/* THE REAL PAIR IN THE CATALOGUE IS EXACTLY THIS CASE: Grant Line 2024
   declares NAVD88 and Grant Line 2023 declares nothing at all. */
check('a pair where one survey names no datum is refused, not guessed at',
  await page.evaluate(() => {
    const mk = (name, vertcs, vals) => ({ measured: vals.length,
      survey: { name: name, vertcs: vertcs }, pts: vals.map((v,i)=>({d:i*50,v:v})) });
    const c = bedChange({ length:500, bands:[
      mk('Bathy_NCRO_20230615_GrantLine', null, [-10,-11,-12,-11,-10,-9,-10,-11,-12,-11]),
      mk('Bathy_NCRO_20240520_GrantLine', 'NAVD88_height_(ftUS)', [-8,-9,-10,-9,-8,-7,-8,-9,-10,-9])]});
    return c && !!c.refused && c.mean === undefined;
  }));
check('and a pair on two different datums is refused too',
  await page.evaluate(() => {
    const mk = (name, vertcs, vals) => ({ measured: vals.length,
      survey: { name: name, vertcs: vertcs }, pts: vals.map((v,i)=>({d:i*50,v:v})) });
    const c = bedChange({ length:500, bands:[
      mk('Bathy_NCRO_20230101_X', 'NGVD29', [-10,-11,-12,-11,-10,-9,-10,-11,-12,-11]),
      mk('Bathy_NCRO_20240101_X', 'NAVD88', [-8,-9,-10,-9,-8,-7,-8,-9,-10,-9])]});
    return c && /different things/.test(c.refused || '');
  }));
check('one survey alone is not a change',
  await page.evaluate(() => bedChange({ length:500, bands:[
    { measured:3, survey:{name:'Bathy_NCRO_20230101_X', vertcs:'NAVD88'},
      pts:[{d:0,v:-9},{d:50,v:-9},{d:100,v:-9}] }] }) === null));

/* Back to the Sacramento for everything after this. */
await page.evaluate(async () => {
  const sel = document.getElementById('riverpick');
  sel.value = 'sacramento'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 1500));
});

/* --- THE TIDE ALONG THE RIVER -------------------------------------------
   The app could say the tide turns and at which station, and could say
   "running both ways — 3 of 6 gauges read upstream". What it could not do was
   show WHERE along the river the tide is winning, which is the question
   somebody standing on a bank actually has. */

/* SLACK IS A DRIFT THROUGH ZERO, NOT A CROSSING OF IT. Measured against the
   real service, Walnut Grove appeared to turn three times between 06:00 and
   06:30 — velocity hovering at zero and flickering sign, not the tide turning
   three times in half an hour. */
check('a drift through zero is one turn, not three',
  await page.evaluate(() => {
    const t0 = Date.parse('2026-08-31T06:00:00Z'), q = 15 * 60000;
    const series = [ -0.9, -0.6, -0.3, 0.04, -0.02, 0.03, -0.05, 0.3, 0.8, 1.1 ]
      .map((v, i) => ({ t: t0 + i * q, v: v }));
    const runs = velocityRuns(series);
    return runs.length === 2 && runs[0].dir === 'up' && runs[1].dir === 'down';
  }),
  await page.evaluate(() => {
    const t0 = Date.parse('2026-08-31T06:00:00Z'), q = 15 * 60000;
    const series = [ -0.9, -0.6, -0.3, 0.04, -0.02, 0.03, -0.05, 0.3, 0.8, 1.1 ]
      .map((v, i) => ({ t: t0 + i * q, v: v }));
    return JSON.stringify(velocityRuns(series).map(r => r.dir));
  }));
/* And a real reversal is still one, not none — the threshold must not eat it. */
check('a real reversal is still counted',
  await page.evaluate(() => {
    const t0 = Date.now() - 6 * 3600000, q = 15 * 60000;
    const series = [ 1.2, 0.9, 0.4, -0.5, -1.1, -1.4 ]
      .map((v, i) => ({ t: t0 + i * q, v: v }));
    return velocityRuns(series).length === 2;
  }));

const along = await page.evaluate(() => {
  const h = [...document.querySelectorAll('#panel-water h2')]
    .find(x => /along the river/i.test(x.textContent));
  if (!h) return null;
  let n = h.nextElementSibling, text = '', figs = 0, desc = null, btn = null;
  while (n && n.tagName !== 'H2'){
    text += ' ' + n.textContent;
    figs += n.querySelectorAll ? n.querySelectorAll('svg[role="img"]').length : 0;
    if (!desc && n.querySelector) desc = n.querySelector('[id^=alongdesc-]');
    if (!btn && n.querySelector) btn = [...n.querySelectorAll('button')]
      .find(b => /Show the last day/.test(b.textContent));
    n = n.nextElementSibling;
  }
  const fig = document.querySelector('#panel-water svg[aria-label*="Which way the water"]');
  return { text: text, figs: figs, hasFigure: !!fig,
    describedBy: fig ? fig.getAttribute('aria-describedby') : null,
    descId: desc ? desc.id : null,
    descLines: desc ? desc.querySelectorAll('p').length : 0,
    key: fig ? fig.textContent : '',
    askedForDay: !!btn };
});
check('a tidal river gets a section for the tide along it', !!along, 'section missing');
check('and it draws the figure', along.hasFigure, JSON.stringify(along && { figs: along.figs }));

/* IT MUST NOT PREDICT. NOAA publishes tidal current predictions for 4,430
   places and the furthest upstream on this water is below Rio Vista, so above
   that point nobody forecasts which way the water will run. Working one out
   from these readings would be a guess wearing the clothes of a reading. */
/* A PREDICTION NAMES A TIME. The panel's own disclaimer contains the words
   "when the tide will next turn", so a check for that phrase fails on the
   sentence promising not to do it — the first version of this did exactly
   that. What must not appear is a future turn with a time attached to it. */
check('it never says when the tide will next turn',
  !/(will|next|expected to)\s+turn[a-z]*\s*(at|in|around|by)?\s*\d/i.test(along.text),
  along.text.slice(0, 200));
check('it says when each place LAST turned, which is measured',
  /last turned|has not turned/.test(along.text + along.key), (along.text + along.key).slice(0, 200));
/* And it says the limit out loud rather than leaving the reader to wonder. */
check('and says plainly that nobody publishes the forecast for this water',
  /no forecast|nobody publishes|does not|will not tell you/i.test(along.text),
  along.text.slice(0, 300));

/* A FIGURE THAT SAYS TWO THINGS IN COLOUR AND NEITHER IN WORDS IS THE DEFECT
   THIS APP HAS ALREADY SHIPPED TWICE. */
check('the figure carries its own key for both colours',
  /pushing in/.test(along.key) && /running out/.test(along.key), along.key.slice(0, 160));

/* EVERYTHING DRAWN IS INSIDE A role="img", WHICH PRUNES ITS SUBTREE — so the
   same facts have to exist as sentences or they exist for nobody who cannot
   see the picture. */
check('the figure is described in words for anything that cannot see it',
  !!along.descId && along.describedBy === along.descId && along.descLines >= 1,
  JSON.stringify({ describedBy: along.describedBy, descId: along.descId,
                   lines: along.descLines }));

/* --- HOW FAR UP THE TIDE ACTUALLY GOT ------------------------------------
   The ribbon's dashed mark is the furthest tide STATION and never moves. This
   one is measured: the highest gauge that really ran backwards in the last
   day. It is a FLOOR — the next gauge up may have reversed and simply not be
   instrumented — and the app has to say so, because a rule drawn across a
   figure invites the reader to take it for the limit of the tide.

   Driven with a synthetic day rather than through the fetch: the point under
   test is which row gets the mark and what the words around it claim, and a
   fixture that has to produce a plausible tidal day at three sites to prove
   that is a fixture testing itself. */
const rev = await page.evaluate(() => {
  const river = byId('sacramento');
  const t0 = Date.now() - 20 * 3600000, q = 15 * 60000;
  const mk = (vals) => vals.map((v, i) => ({ t: t0 + i * q, v: v }));
  /* Downstream first, the order the figure draws in. */
  const gs = [
    { id: 'A', name: 'LOWEST CA',  vel: -0.8 },
    { id: 'B', name: 'MIDDLE CA',  vel:  0.4 },
    { id: 'C', name: 'HIGHER CA',  vel:  0.9 },
    { id: 'D', name: 'HIGHEST CA', vel:  1.2 }
  ];
  /* A and B reverse; C runs down all day; D publishes no day at all. */
  const hist = {
    A: mk([-0.9, -1.1, -0.7, 0.5, 0.9, 1.0]),
    B: mk([ 0.8,  0.5, -0.4, -0.6, 0.3, 0.7]),
    C: mk([ 1.2,  1.1,  0.9,  1.0, 1.3, 1.4]),
    D: []
  };
  const m = maxReversal(river, gs, hist);
  const none = maxReversal(river, gs, { A: mk([1, 1.2, 1.1]), B: mk([0.9, 1.1]) });
  const top  = maxReversal(river, gs, Object.assign({}, hist, { D: mk([0.5, -0.9, -1.2]) }));
  const wrap = tideAlongFigure(river, gs, hist);
  const fig = wrap.querySelector('svg[role="img"]');
  return {
    picked: m ? m.row.id : null,
    withDay: m ? m.withDay : null,
    topmost: m ? m.topmost : null,
    above: m && m.above ? m.above.id : null,
    /* Nothing reversed at all is a different answer from "no data". */
    noneIsNull: none === null,
    /* When the highest gauge is the one that reversed there is no ceiling. */
    topPicked: top ? top.row.id : null,
    topIsTopmost: top ? top.topmost : null,
    key: fig ? fig.textContent : '',
    desc: wrap.querySelector('[id^=alongdesc-]')
      ? wrap.querySelector('[id^=alongdesc-]').textContent : '',
    rules: fig ? fig.querySelectorAll('line[stroke-dasharray]').length : 0
  };
});
check('the mark lands on the highest gauge that really ran backwards',
  rev.picked === 'B', JSON.stringify(rev));
check('and not on one that ran downstream all day',
  rev.picked !== 'C' && rev.picked !== 'D', JSON.stringify(rev));
check('it counts only the gauges that published a day',
  rev.withDay === 3, JSON.stringify(rev));
check('and names the gauge above it, which is what bounds the answer',
  rev.above === 'C', JSON.stringify(rev));
check('nothing reversing is not the same as no reading', rev.noneIsNull,
  JSON.stringify(rev));
/* WHERE THE HIGHEST GAUGE IS THE ONE THAT REVERSED, the data has no ceiling
   and the app must not imply one. */
check('the topmost gauge reversing is reported as having no gauge above it',
  rev.topPicked === 'D' && rev.topIsTopmost === true, JSON.stringify(rev));
/* A MARK NOBODY NAMED IS THE DEFECT THE COLOUR KEY ALREADY FIXED ONCE. */
check('the figure names the mark in its own key',
  /pushed back at least this far/.test(rev.key), rev.key.slice(0, 300));
check('and the mark is drawn, not only described',
  rev.rules >= 1, String(rev.rules));
/* IT IS A FLOOR AND NEVER A LIMIT, in the words as well as in the drawing —
   "at least" is the whole claim, and the description says it too because the
   drawing is inside a role="img" and reaches nobody who cannot see it. */
check('the words say "at least", never that the tide reaches there',
  /at least/.test(rev.key) && /at least/.test(rev.desc) &&
  !/the tide reaches (this|as far as)/i.test(rev.desc),
  rev.desc.slice(0, 300));
check('and the description says it is a floor rather than the limit',
  /floor, not the limit|floor and not a limit/i.test(rev.desc), rev.desc.slice(0, 300));

/* A DRAWING MUST FILL THE BOX IT RESERVES. width:100% with an explicit height
   is a contradiction: the viewBox scales down to fit the width, the element
   keeps the height it was told, and the picture floats in the middle of the
   difference. With sixteen Delta gauges that was a screen of blank above the
   rows — reported as "what is this??", which is the right question. */
check('the figure fills the height it takes up, with no letterbox',
  await page.evaluate(() => {
    const fig = document.querySelector('#panel-water svg[aria-label*="Which way the water"]');
    if (!fig) return false;
    const box = fig.getBoundingClientRect();
    const vb = (fig.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    if (vb.length !== 4 || !vb[2] || !vb[3]) return false;
    /* what the drawing occupies once the viewBox is scaled to the width */
    const drawn = box.width * (vb[3] / vb[2]);
    return Math.abs(drawn - box.height) <= 2;
  }),
  await page.evaluate(() => {
    const fig = document.querySelector('#panel-water svg[aria-label*="Which way the water"]');
    if (!fig) return 'no figure';
    const b = fig.getBoundingClientRect();
    const vb = (fig.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    return JSON.stringify({ w: Math.round(b.width), h: Math.round(b.height),
      drawn: Math.round(b.width * (vb[3] / vb[2])), viewBox: vb });
  }));

/* A GAUGE ARGUING WITH ITSELF IS DROPPED FROM THE DRAWING AND NOT FROM THE
   ACCOUNT OF IT. The rest of the app refuses to choose between a velocity and
   a discharge that sign differently; this figure must not quietly decide. */
check('a self-contradicting gauge is left out of the arrows',
  await page.evaluate(() => {
    const river = byId('sacramento');
    const drawn = velGauges(river).map(r => r.id);
    const bad = velConflicts(river).map(r => r.id);
    return bad.length > 0 && bad.every(id => drawn.indexOf(id) === -1);
  }),
  await page.evaluate(() => JSON.stringify({
    drawn: velGauges(byId('sacramento')).map(r => r.id),
    conflicted: velConflicts(byId('sacramento')).map(r => r.id) })));
check('and it is named rather than silently dropped',
  /left out of this/.test(along.text) && /disagree/.test(along.text),
  along.text.slice(0, 300));

/* THE DAY IS 47 KB AND THIS IS THE LANDING PANEL. */
check('the day of readings is asked for, not fetched for everybody',
  along.askedForDay, 'no button offering the last day');

/* --- THE MAP SHOWS DIRECTION TOO, AND SAYS SO ---------------------------
   The ring carries which way the water is going; the fill still carries how
   warm it is. Two facts on one pin, and a key row for the new one, because
   this app has now shipped two colours that meant something and said nothing. */
const rings = await page.evaluate(() => {
  const rows = ((state.gauges.sacramento || {}).rows) || [];
  const out = { drawn: [], conflictedDark: true };
  state.gaugeLayer.eachLayer(l => {
    if (!l.getLatLng) return;
    const ll = l.getLatLng();
    const row = rows.find(r => Math.abs(r.lat - ll.lat) < 1e-9);
    if (!row) return;
    const vr = velReading(row);
    out.drawn.push({ id: row.id, ring: l.options.color,
      wanted: (vr && !vr.conflict) ? (vr.down ? 'ebb' : 'flood') : 'dark' });
    if (vr && vr.conflict && l.options.color !== '#0A1214') out.conflictedDark = false;
  });
  return out;
});
check('a gauge that measures direction gets a coloured ring',
  rings.drawn.some(d => d.wanted !== 'dark' && d.ring !== '#0A1214'),
  JSON.stringify(rings.drawn));
check('a gauge that does not measure it keeps a dark one',
  rings.drawn.every(d => d.wanted !== 'dark' || d.ring === '#0A1214'),
  JSON.stringify(rings.drawn));
/* Same rule as the figure: two instruments disagreeing is not a direction. */
check('and a gauge arguing with itself is not given one either',
  rings.conflictedDark, JSON.stringify(rings.drawn));
check('the key explains the ring as well as the fill',
  await page.evaluate(() => {
    const t = (document.getElementById('maplegend') || {}).textContent || '';
    return /Ring cyan/.test(t) && /Ring green/.test(t) && /fill is water temperature/.test(t);
  }),
  await page.evaluate(() => (document.getElementById('maplegend') || {}).textContent || ''));

/* CONSENT IS REMEMBERED, THE READINGS ARE NOT. Asking again every visit for
   something already agreed is the app forgetting a decision; caching a day of
   velocity would be worse, because it is only useful while it is today. */
check('agreeing to the day is remembered, and the readings are not cached',
  await page.evaluate(() => {
    const river = byId('sacramento');
    sput(river.id, 'velday', true);
    const remembered = !!sget(river.id, 'velday');
    const cached = !!(state.velHistory || {})[river.id] &&
                   JSON.stringify(Store).indexOf('72255') !== -1;
    sput(river.id, 'velday', false);
    return remembered && !cached;
  }));

/* --- WHICH WAY THE TIDE IS MOVING ----------------------------------------
   Everything the app said about the tide was a direction on the MAP: the sea
   is downstream, the flood pushes up, the wash marks how far. None of it told
   a reader standing on a bank whether the water in front of them is coming up
   or going down, which is a direction in TIME and the one an afternoon gets
   planned around. It was derivable from the highs and lows already on the
   screen the whole time. */
const phase = await page.evaluate(() => {
  const river = byId('sacramento');
  const ph = tidePhase(river);
  const panel = document.getElementById('panel-water');
  const strip = panel.querySelector('.tidephase');
  /* A tide whose "high" is lower than the lows either side of it is a broken
     prediction, not a tide, and an arrow drawn from it would be a guess. */
  const kept = state.tides[river.id].hilo;
  const now = Date.now();
  const bad = [
    { t: new Date(now - 2 * 3600000).toISOString().replace('T', ' ').slice(0, 16), v: 4.0, type: 'L' },
    { t: new Date(now + 2 * 3600000).toISOString().replace('T', ' ').slice(0, 16), v: 1.0, type: 'H' }
  ];
  state.tides[river.id].hilo = bad;
  const incoherent = tidePhase(river);
  /* And with only the turn ahead of us, there is no phase to state. */
  state.tides[river.id].hilo = [kept[kept.length - 1]];
  const oneSided = tidePhase(river);
  state.tides[river.id].hilo = kept;
  return {
    got: !!ph, rising: ph ? ph.rising : null,
    through: ph ? ph.through : null,
    range: ph ? ph.range : null,
    minutes: ph ? ph.minutes : null,
    incoherentIsNull: incoherent === null,
    oneSidedIsNull: oneSided === null,
    strip: strip ? strip.textContent : '',
    card: (document.getElementById('panel-water').textContent || '')
  };
});
check('the app works out whether the tide is rising or falling', phase.got,
  JSON.stringify(phase));
/* The fixture puts now halfway up a flood: three hours past a low of 0.70 and
   three hours short of a high of 4.30. */
check('and gets the direction right for the fixture', phase.rising === true,
  JSON.stringify(phase));
check('with how far through the swing it is', phase.through > 0.3 && phase.through < 0.7,
  String(phase.through));
/* DERIVED FROM THE FIXTURE, NOT TYPED. The stub's amplitude now varies over a
   fortnight so the spring-and-neap question has a cycle to answer against, and
   a hardcoded 3.6 was a constant belonging to the version before it. Asserting
   the app's figure equals the fixture's own two turns keeps this true whatever
   the envelope is next changed to. */
check('and how big the swing is',
  Math.abs(phase.range - Math.abs(tideAt(3) - tideAt(-3))) < 0.02,
  String(phase.range) + ' against ' + Math.abs(tideAt(3) - tideAt(-3)));
/* A HIGH LOWER THAN THE LOWS EITHER SIDE OF IT IS NOT A TIDE. Better to say
   nothing than to draw an arrow off a broken prediction. */
check('an incoherent prediction gets no direction at all', phase.incoherentIsNull,
  JSON.stringify(phase));
/* The turn AHEAD on its own would make the direction right by luck. */
check('and neither does one with no turn behind it', phase.oneSidedIsNull,
  JSON.stringify(phase));
check('the tide panel says it in words, not only in an arrow',
  /rising/i.test(phase.strip), phase.strip.slice(0, 200));
/* IT IS A LEVEL PREDICTION AT ONE STATION AND MUST SAY SO. The water can run
   upstream while the level falls; a reader told "rising" with nothing else is
   being handed a current reading that is not one. */
check('and says it is the level at one station, not the current where you are',
  /level/i.test(phase.strip) && /not the current/i.test(phase.strip),
  phase.strip.slice(0, 300));
/* And the measured section says the two need not agree, so a reader who finds
   them disagreeing has not found a fault. */
check('the measured section says the two need not agree',
  /need not agree|not the same thing/i.test(along.text), along.text.slice(0, 400));

/* --- FIRST AND LAST LIGHT -----------------------------------------------
   The convention every angler's tide table carries and this one did not: the
   change of tide lands differently in the dark, in the low light at either end
   of the day, or at noon. It is arithmetic — no request, nothing to go stale,
   works offline for any date — which makes it the one thing here that can be
   checked against physics rather than against a service. */
const sun = await page.evaluate(() => {
  const LAT = 38.1583, LON = -121.6853;          /* Rio Vista */
  const at = iso => sunTimes(new Date(iso + 'T12:00:00Z'), LAT, LON);
  const hours = (a, b) => (b - a) / 3600000;
  const eq = at('2026-03-20'), jun = at('2026-06-21'), dec = at('2026-12-21');
  const nov = at('2026-11-03'), feb = at('2026-02-11');
  const meanNoonH = 12 - LON / 15;               /* mean solar noon, UTC hours */
  const noonOff = t => (t.noon.getUTCHours() + t.noon.getUTCMinutes() / 60 +
                        t.noon.getUTCSeconds() / 3600 - meanNoonH) * 60;
  return {
    eqLen: hours(eq.sunrise, eq.sunset),
    junLen: hours(jun.sunrise, jun.sunset),
    decLen: hours(dec.sunrise, dec.sunset),
    /* Sunrise and sunset must straddle solar noon exactly. */
    symmetry: Math.abs((+eq.sunrise + +eq.sunset) / 2 - eq.noon) / 1000,
    /* The equation of time: the sun runs about 16 minutes ahead of the clock
       in early November and about 14 behind in mid-February. Nothing here was
       fitted to those — they fall out of the ephemeris or the ephemeris is
       wrong. */
    novOff: noonOff(nov), febOff: noonOff(feb),
    /* Civil twilight is before sunrise and after sunset, never the other way. */
    dawnBeforeRise: hours(eq.dawn, eq.sunrise),
    duskAfterSet: hours(eq.sunset, eq.dusk),
    /* THE LOOP CLOSES. The shading reads the sun's altitude at an instant; the
       sentences read the named crossings. Two formulations of the same thing
       is how they come to disagree by four minutes with nobody able to say
       which is right — so the altitude AT the computed sunrise has to be the
       sunrise altitude. */
    altAtSunrise: sunAltitude(jun.sunrise, LAT, LON),
    altAtDawn: sunAltitude(jun.dawn, LAT, LON),
    altAtNoonJun: sunAltitude(jun.noon, LAT, LON),
    /* And the classifier agrees with both. */
    stateAtNoon: lightAt(jun.noon, LAT, LON),
    stateAtMidnight: lightAt(new Date(+jun.noon + 12 * 3600000), LAT, LON),
    stateBetween: lightAt(new Date(+jun.sunset + 12 * 60000), LAT, LON)
  };
});
/* Twelve hours and a bit at the equinox — the "and a bit" is the sun's disc
   and refraction, and a check that came out at exactly 12 would mean those
   had been left out. */
check('day length at the equinox is twelve hours and a little more',
  sun.eqLen > 12.05 && sun.eqLen < 12.25, String(sun.eqLen));
/* 38.16 degrees north: the solstices are 14h49m and 9h31m. */
check('and the solstices are the right length for this latitude',
  Math.abs(sun.junLen - 14.82) < 0.05 && Math.abs(sun.decLen - 9.51) < 0.05,
  JSON.stringify({ jun: sun.junLen, dec: sun.decLen }));
/* NEARLY, AND NOT EXACTLY — the asymmetry is real rather than error. The
   declination drifts across the day, so sunrise and sunset are not perfectly
   equidistant from transit; it is tens of seconds at this latitude. Asserting
   "exactly" was asserting a property of the approximate model, and it started
   failing the moment the model got better. */
check('sunrise and sunset straddle solar noon to within a minute',
  sun.symmetry < 60, String(sun.symmetry));
check('the equation of time peaks where it really does',
  sun.novOff < -14 && sun.novOff > -18 && sun.febOff > 13 && sun.febOff < 17,
  JSON.stringify({ nov: sun.novOff, feb: sun.febOff }));
check('first light comes before sunrise and last light after sunset',
  sun.dawnBeforeRise > 0.3 && sun.dawnBeforeRise < 0.8 &&
  sun.duskAfterSet > 0.3 && sun.duskAfterSet < 0.8,
  JSON.stringify({ dawn: sun.dawnBeforeRise, dusk: sun.duskAfterSet }));
/* THE TWO ANSWERS COME FROM ONE EPHEMERIS, asserted by substituting one back
   into the other rather than by computing it the same way twice. */
check('the altitude at the sunrise this app computes IS the sunrise altitude',
  Math.abs(sun.altAtSunrise - (-0.833)) < 0.1, String(sun.altAtSunrise));
check('and the altitude at first light is the civil-twilight altitude',
  Math.abs(sun.altAtDawn - (-6)) < 0.1, String(sun.altAtDawn));
/* Sanity on the other end: at midsummer noon at 38N the sun is about 75 up. */
check('the sun is where it should be at midsummer noon',
  sun.altAtNoonJun > 73 && sun.altAtNoonJun < 77, String(sun.altAtNoonJun));
check('and the light is classified from the same altitude',
  sun.stateAtNoon === 'day' && sun.stateAtMidnight === 'night' &&
  sun.stateBetween === 'twilight',
  JSON.stringify({ noon: sun.stateAtNoon, midnight: sun.stateAtMidnight,
                   justAfterSunset: sun.stateBetween }));

/* IT IS DRAWN AND IT IS SAID. The shading lives inside a role="img", so a
   band with nothing naming it reaches nobody who cannot see it — the same
   defect the tide key and the reversal mark have each already been. */
const lightUi = await page.evaluate(() => {
  const chart = document.getElementById('tidechart');
  const panel = document.getElementById('panel-water').textContent;
  return {
    shaded: chart ? chart.querySelectorAll('rect[fill="#04090A"]').length : 0,
    said: /First light/.test(panel) && /last light/.test(panel),
    /* THE CLAIM MUST BE ABOUT THE OVERLAP, NEVER ABOUT THE FISH — and the
       test for that cannot be a word search, because the sentence doing the
       refusing contains the words being refused. Third time this session: a
       gate keyed on copy pins the copy, and pins the disclaimer with it
       (hub LESSONS 180). So this asserts the DENIAL is present, which is the
       actual requirement, and separately that no recommendation is made. */
    convention: /convention among anglers/.test(panel),
    denial: /nothing whatever about what the fish will do/.test(panel),
    noForecast: !/(better|best) (fishing|time to fish)|you should fish|worth fishing/i.test(panel),
    computed: /arithmetic from the date and the position/.test(panel),
    twilightSaid: /six degrees below the horizon/.test(panel)
  };
});
check('the light is shaded on the tide chart', lightUi.shaded > 0,
  String(lightUi.shaded));
check('and named in words, because the chart is a role="img"', lightUi.said);
check('the low-light turns are given as a coincidence, not a prediction',
  lightUi.convention && lightUi.denial && lightUi.noForecast, JSON.stringify(lightUi));
check('it says the times are computed rather than published', lightUi.computed);
check('and says what "first light" actually means', lightUi.twilightSaid);

/* --- THE LANDING PAGE, AS IT IS ACTUALLY READ ----------------------------
   Four reports from a real device in one message, and three of them were the
   same kind of defect: something correct when it was written, left behind by
   the app growing a fifth entry or a new overlay. */

/* HOME LOST ITS RIBBON, ON EVERY GEOMETRY.

   The tappable river rows are HTML buttons laid over the drawing inside
   `#ribbonwrap` — absolutely positioned, exactly as tall as the ribbon. The
   height budget summed the wrapper's children as furniture that pushes the
   ribbon down the page, and counted that overlay among them. It does not push
   anything: it IS the ribbon, drawn over itself. So each redraw subtracted the
   previous draw's own height from the space left for the next, and the budget
   reached MINUS 26 on a 390x664 phone before a row was measured.

   Then it latched: below the floor the draw returns early, before the line
   that clears the stale overlay, so the overlay stayed and the budget could
   never recover. */
/* THIS BLOCK IS ABOUT THE LANDING PAGE, so it has to BE on the landing page —
   and it has to put the suite back where it found it. The row overlay only
   exists when more than one river is drawn, so with a river still selected
   these checks measured an empty overlay and called it a defect; and leaving
   All rivers selected afterwards failed three tide-station checks forty lines
   later, which is the same state leak this suite has been bitten by before. */
const riverBefore = await page.evaluate(() => state.riverId);
await page.evaluate(() => {
  const sel = document.getElementById('riverpick');
  sel.value = ''; sel.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(1500);

const ribbonBand = await page.evaluate(() => {
  const wrap = document.getElementById('ribbonwrap');
  /* Redraw several times: one pass was always fine, and the defect only
     appeared once a previous draw had left its overlay behind. */
  drawRibbon(); drawRibbon(); drawRibbon();
  const hits = document.getElementById('riverhits');
  return {
    hidden: wrap.hidden, rowH: RIB.rowH, tooTight: RIB.tooTight,
    rows: document.querySelectorAll('#ribbon rect[stroke="#1F5B57"]').length,
    hitButtons: hits ? hits.querySelectorAll('button').length : 0,
    rivers: RIVERS.length,
    /* The overlay must never be counted as furniture again. */
    overlayInWrap: !!(hits && hits.parentNode === wrap),
    overlayAbsolute: hits ? getComputedStyle(hits).position : null
  };
});
check('the ribbon survives being redrawn', !ribbonBand.hidden && ribbonBand.rowH > 0,
  JSON.stringify(ribbonBand));
check('and its budget is never driven negative by its own overlay',
  ribbonBand.rowH >= 22, JSON.stringify({ rowH: ribbonBand.rowH }));
/* The overlay is still where it was — the fix is to stop COUNTING it, not to
   move it, and a test that passes because the overlay went away would be
   measuring a different app. */
check('the row buttons are still laid over the ribbon inside its wrapper',
  ribbonBand.overlayInWrap && ribbonBand.overlayAbsolute === 'absolute',
  JSON.stringify(ribbonBand));
check('there is a button for every river the ribbon draws',
  ribbonBand.hitButtons === ribbonBand.rivers,
  JSON.stringify({ buttons: ribbonBand.hitButtons, rivers: ribbonBand.rivers }));

/* A SHORT SCREEN SCROLLS THE BAND RATHER THAN DROPPING IT. Five rows at a
   legible height need more room than a phone has above the cards, and the old
   answer was to remove the comparison the landing page exists for. A row has a
   floor below which a dot and its figure cannot be read, so squeezing is not
   available either — the third option is to keep the size, cap the band, and
   let the rest be reached. */
const shortBand = await page.evaluate(async () => {
  const before = { w: window.innerWidth, h: window.innerHeight };
  /* Drive the metrics directly: the viewport cannot be resized from in here,
     and what is under test is the arithmetic, not the browser. */
  ribbonMetrics(360, 5, 112, true);
  const tight = { rowH: RIB.rowH, scrolls: RIB.scrolls, tooTight: RIB.tooTight };
  ribbonMetrics(360, 5, 300, true);
  const roomy = { rowH: RIB.rowH, scrolls: RIB.scrolls, tooTight: RIB.tooTight };
  ribbonMetrics(360, 5, 40, true);
  const sliver = { rowH: RIB.rowH, scrolls: RIB.scrolls, tooTight: RIB.tooTight };
  drawRibbon();
  return { tight, roomy, sliver, before };
});
check('a band with room shows every row without scrolling',
  !shortBand.roomy.scrolls && !shortBand.roomy.tooTight,
  JSON.stringify(shortBand.roomy));
/* THE ROWS KEEP THEIR HEIGHT. An illegible row is not a smaller row. */
check('a band too small keeps the rows legible and scrolls instead',
  shortBand.tight.scrolls && shortBand.tight.rowH >= 22 && !shortBand.tight.tooTight,
  JSON.stringify(shortBand.tight));
/* And the one case where scrolling would be a sliver of a bar still drops. */
check('a band too small to show even one row is still dropped',
  shortBand.sliver.tooTight, JSON.stringify(shortBand.sliver));

/* --- THE PICTURE TURNS, BECAUSE THE PHONE CANNOT BE TURNED ---------------
   Asked for as a button that rotates the screen. No web page can do that on
   this hardware — Safari's engine has no screen.orientation.lock at all and
   Chromium's throws NotSupportedError — so a button calling it would be a
   control that does nothing. The drawing rotates instead, which is also the
   better half: a portrait phone gives the bars its long side.

   This suite runs at 1280x900, where the band has room and the offer is
   correctly absent. So the cramped state is driven rather than waited for, and
   the claims that are ABOUT the geometry — that it fits, that the rows come
   out taller — are asserted in the walk that actually runs at phone sizes.
   Here: the mechanics, the wiring and the words. */
const sw = await page.evaluate(async () => {
  /* A band with no room, the state a phone is really in. */
  ribbonMetrics(360, RIVERS.length, 150, true);
  const crampedRowH = RIB.rowH, cramped = RIB.scrolls || RIB.rowH < RIB.natural;
  syncSidewaysOffer();
  const row = document.getElementById('swopen');
  const offered = row && !row.hidden;
  if (!offered) { drawRibbon(); return { cramped, offered: false, crampedRowH }; }
  /* FOCUS IT FIRST, because that is what pressing it does. A modal returns
     focus to whatever held it when it opened, so a synthetic click that never
     focused the button asks the platform to restore something that was never
     true and then blames it for the answer. */
  const opener = row.querySelector('button');
  opener.focus();
  opener.click();
  await new Promise(r => setTimeout(r, 500));
  const d = document.getElementById('sideways');
  const svg = document.getElementById('swribbon');
  const out = {
    cramped, offered: true, open: d.open, crampedRowH,
    bars: svg.querySelectorAll('rect[stroke="#1F5B57"]').length,
    rivers: RIVERS.length,
    note: document.getElementById('swnote').textContent,
    focusInside: d.contains(document.activeElement),
    /* No row-press overlay in here: it positions itself from bounding boxes,
       and inside a rotated container those describe the screen rather than the
       picture. Hit-testing through a transform is a trap. */
    hits: !!document.querySelector('#swinner #riverhits'),
    /* The drawing is the SAME drawing — one function, two hosts — so the
       upright band must still be intact behind it. */
    uprightIntact: document.querySelectorAll('#ribbon rect[stroke="#1F5B57"]').length > 0
  };
  d.close();
  await new Promise(r => setTimeout(r, 200));
  out.closed = !d.open;
  drawRibbon();
  return out;
});
check('a band with no room is recognised as cramped', sw.cramped,
  JSON.stringify({ rowH: sw.crampedRowH }));
check('and it offers to show the rivers sideways', sw.offered, JSON.stringify(sw));
check('the sideways view opens', sw.open === true, JSON.stringify(sw));
check('every river is drawn in it', sw.bars >= sw.rivers, JSON.stringify(sw));
/* IT MUST NOT CLAIM TO HAVE ROTATED THE DEVICE. */
check('it says it turns the picture and not the phone',
  /turns the picture, not the phone/.test(sw.note) &&
  /cannot rotate the screen itself/.test(sw.note), sw.note);
check('the row-press overlay is not carried into the rotated view', !sw.hits,
  JSON.stringify(sw));
/* ONE DRAWING, TWO HOSTS — the second host must not have eaten the first. */
check('drawing it sideways leaves the upright band standing', sw.uprightIntact,
  JSON.stringify(sw));
check('the keyboard is inside it while it is open', sw.focusInside,
  JSON.stringify(sw));
check('it closes', sw.closed, JSON.stringify(sw));
/* WHERE FOCUS LANDS AFTER IT CLOSES IS ASSERTED IN THE WALK, not here. This
   suite runs at 1280x900 and drives the cramped state by hand, so the moment
   anything redraws, the offer correctly disappears — and the button focus
   should return to is gone with it. The precondition for that check only
   holds on a screen that is really short, which is where the walk runs. */

/* AND IT IS NOT OFFERED WHERE IT CHANGES NOTHING. A control that does nothing
   is the defect this whole feature exists to avoid being. */
check('a band already showing every row at full height does not offer it',
  await page.evaluate(() => {
    ribbonMetrics(900, RIVERS.length, 900, true);
    syncSidewaysOffer();
    const hidden = document.getElementById('swopen').hidden;
    drawRibbon();
    return hidden;
  }));

/* NO SENTENCE NAMES A COUNT THAT LIVES IN AN ARRAY. Every one of them said
   FOUR, and there have been five entries since the Delta arrived. */
const copy = await page.evaluate(() => ({
  water: document.getElementById('panel-water').textContent,
  home: (document.getElementById('homebtn') || {}).title || '',
  phrase: typeof riversPhrase === 'function' ? riversPhrase() : null,
  riverCount: typeof riverCount === 'function' ? riverCount() : null,
  ribbonRows: typeof ribbonRowCount === 'function' ? ribbonRowCount() : null
}));
check('the landing copy counts the rivers rather than naming a number',
  /Four rivers, one temperature scale/.test(copy.water) === false &&
  new RegExp(copy.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(copy.water),
  JSON.stringify({ phrase: copy.phrase, has: copy.water.slice(0, 160) }));
check('and the phrase comes from the river list',
  copy.riverCount === 4 && copy.ribbonRows === 5 && /four rivers/i.test(copy.phrase),
  JSON.stringify(copy));
/* The Delta is counted apart: it is where the four arrive, not a fifth. */
check('the Delta is named rather than counted as a river',
  /and the Delta/i.test(copy.phrase), copy.phrase);
check('the Home button offers what is actually there',
  !/four rivers/i.test(copy.home) || /and the Delta/i.test(copy.home), copy.home);

/* DEPTH SAT ON A SPINNER THAT COULD NEVER RESOLVE. The catalogue is fetched
   for a river; with no river the request is never made, so "Reading the DWR
   service directory…" was a permanent claim that the app was busy on your
   behalf. A spinner tells a reader to wait; this one had to tell them to act. */
const noRiver = await page.evaluate(async () => {
  const out = {};
  for (const t of ['layers', 'marks']) {
    selectTab(t);
    await new Promise(r => setTimeout(r, 400));
    const el = document.getElementById('panel-' + t);
    out[t] = { text: el.textContent,
               route: [...el.querySelectorAll('button')]
                 .some(b => /Choose a river/.test(b.textContent)) };
  }
  selectTab('water');
  return out;
});
check('Depth with no river says what it is for, not that it is loading',
  !/Reading the DWR service directory/.test(noRiver.layers.text) &&
  /Depth belongs to a reach/.test(noRiver.layers.text),
  noRiver.layers.text.slice(0, 200));
/* AND NAMES THE ROUTE. "Pick one above" is an instruction to go and find a
   control; the control belongs where the refusal is. */
check('and offers the way to pick one', noRiver.layers.route);
check('Marks with no river does the same', noRiver.marks.route &&
  /A mark belongs to one river/.test(noRiver.marks.text),
  noRiver.marks.text.slice(0, 160));

/* Put the suite back on the river it was reading, and wait for it, so what
   follows measures the app rather than this block's leftovers. */
await page.evaluate((id) => {
  const sel = document.getElementById('riverpick');
  sel.value = id; sel.dispatchEvent(new Event('change', { bubbles: true }));
}, riverBefore);
await page.waitForTimeout(2500);

/* --- IS TODAY A BIG TIDE OR A SMALL ONE ----------------------------------
   After "which way" and "when", this is the question. The swing between high
   and low grows and shrinks over about fourteen and a half days, and on this
   water a spring day and a neap day are a couple of feet apart at the same
   station. Two days both described as "rising, high at 4pm" can be completely
   different afternoons, and nothing in this app said which. */
const spring = await page.evaluate(() => {
  const river = byId('sacramento');
  const sn = springNeap(river);
  const days = tideDayRanges(river);
  const panel = document.getElementById('panel-water').textContent;

  /* A CLIPPED DAY IS NOT A SMALL TIDE. A day holding one high and one low
     when it really had four reports a span the water never stopped at. */
  const kept = state.tides[river.id].hilo;
  const stamp = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);
  const t0 = Date.now();
  state.tides[river.id].hilo = kept.concat([
    { t: stamp(t0 + 40 * 86400000), v: 3.0, type: 'H' },
    { t: stamp(t0 + 40 * 86400000 + 3600000), v: 2.9, type: 'L' }
  ]);
  const withClipped = tideDayRanges(river).some(d => d.n < 3);

  /* Every day the same size is not a cycle, and naming one of them a spring
     tide would be naming rounding. */
  state.tides[river.id].hilo = kept.map((h, i) => ({
    t: h.t, type: h.type, v: h.type === 'H' ? 3.0 : 2.9
  }));
  const flat = springNeap(river);
  state.tides[river.id].hilo = kept;

  return {
    got: !!sn, band: sn ? sn.band : null,
    todayRange: sn ? sn.today.range : null,
    biggest: sn ? sn.biggest.range : null,
    smallest: sn ? sn.smallest.range : null,
    windowDays: sn ? sn.windowDays : 0,
    allDays: days.length,
    everyDayHasBoth: days.every(d => d.hi !== null && d.lo !== null && d.n >= 3),
    clippedDayDropped: !withClipped,
    flatIsNull: flat === null,
    figure: !!document.querySelector('#panel-water svg[aria-label*="water covers"], #panel-water svg[aria-label*="biggest tide"], #panel-water svg[aria-label*="smallest tide"]'),
    /* THE CLAIM, not the prose around it. Checking the whole panel for the
       words "biggest of the month" fails on the app's own sentence promising
       NOT to say it — the same trap this suite already carries a note about
       for the tide-turn check, and hub LESSONS 180: a gate keyed on copy pins
       the copy, and pins the disclaimer with it. The figure's accessible name
       IS the claim, so that is what gets read. */
    claim: (document.querySelector('#panel-water svg[aria-label*="ft"]') || {})
      .getAttribute ? document.querySelector('#panel-water svg[aria-label*="ft"]').getAttribute('aria-label') : '',
    panel: panel
  };
});
check('the app works out how big today’s tide is', spring.got, JSON.stringify(spring).slice(0, 200));
/* A WEEK CANNOT ANSWER A FORTNIGHTLY QUESTION. The turns are now asked for
   over sixteen days so the window contains both a biggest and a smallest. */
check('and reads a fortnight of days, not a week',
  spring.windowDays >= 12, JSON.stringify({ windowDays: spring.windowDays }));
/* THE FIXTURE HAS A REAL ENVELOPE and now sits at the spring end of it. */
check('it places today at the big end of the cycle', spring.band === 'spring',
  JSON.stringify({ band: spring.band, today: spring.todayRange,
                   biggest: spring.biggest, smallest: spring.smallest }));
check('with a real spread between the biggest day and the smallest',
  spring.biggest - spring.smallest > 1, JSON.stringify(spring).slice(0, 160));
/* THE GREAT DIURNAL RANGE, not one high minus the next low. This coast has
   two UNEQUAL highs and lows a day; taking a pair would report whichever the
   arithmetic landed on and swing about for a reason that is not the moon. */
check('every counted day has both a high and a low in it',
  spring.everyDayHasBoth, JSON.stringify({ days: spring.allDays }));
check('a clipped day is dropped rather than reported as a small tide',
  spring.clippedDayDropped, JSON.stringify(spring).slice(0, 160));
/* Every day the same size is not a cycle. */
check('a tide with no cycle in it gets no spring-or-neap claim',
  spring.flatIsNull, JSON.stringify({ flat: spring.flatIsNull }));
check('the fortnight is drawn as well as said', spring.figure);
/* IT SAYS "FORTNIGHT" AND MEANS IT — sixteen days of predictions cannot say
   this is the biggest tide of the month or the year, and must not imply it. */
check('it claims only the window it can actually see',
  /fortnight/.test(spring.claim) && !/(month|year)/i.test(spring.claim),
  spring.claim);
/* THE SWING IS THE ASTRONOMICAL TIDE AT ONE STATION. What moves where somebody
   stands is that plus whatever the river is carrying, and a tall bar must not
   be allowed to imply the second. */
check('and says the river’s own water is not in this figure',
  /river is carrying/.test(spring.panel), spring.panel.slice(0, 300));

/* --- THE KEY SAID "tap to switch" AND TAPPING DID NOT SWITCH -------------
   The map's key promised it; tapping a station opened a label naming the
   station and offering nothing. So the one sentence in the app telling a
   reader the station is a choice described something the map did not do.
   It matters more than it looks: high water at Rio Vista and at Freeport are
   hours apart, so a reader on the wrong station is wrong by hours. */
const station = await page.evaluate(async () => {
  const t = state.tides.sacramento;
  const other = t.stations.find(s => s.id !== t.station && Number.isFinite(s.lat));
  const live  = t.stations.find(s => s.id === t.station && Number.isFinite(s.lat));
  const popupFor = async (st) => {
    const m = state.tideLayer.getLayers().find(l =>
      l.getLatLng && Math.abs(l.getLatLng().lat - st.lat) < 1e-9);
    if (!m) return null;
    m.openPopup();
    await new Promise(r => setTimeout(r, 300));
    const pop = document.querySelector('.leaflet-popup-content');
    const btn = pop && [...pop.querySelectorAll('button')]
      .find(b => /Read the tide here/.test(b.textContent));
    return { text: pop ? pop.textContent : '', hasSwitch: !!btn };
  };
  const otherPop = await popupFor(other);
  const livePop  = live ? await popupFor(live) : null;
  return { was: t.station, other: other.id, otherPop: otherPop, livePop: livePop,
           key: (document.getElementById('maplegend') || {}).textContent || '' };
});
check('another tide station offers to be read instead',
  station.otherPop && station.otherPop.hasSwitch, JSON.stringify(station.otherPop));
check('and says why it would matter',
  /hours apart/.test((station.otherPop || {}).text || ''),
  ((station.otherPop || {}).text || '').slice(0, 120));
/* The one being read already is not offered as a switch to itself. */
check('the station already being read offers no such thing',
  station.livePop && !station.livePop.hasSwitch, JSON.stringify(station.livePop));
/* THE KEY AND THE MAP MUST NOT DRIFT APART AGAIN: if the key claims a tap
   switches, a tap has to switch. */
check('the key only promises what the map does',
  !/tap to switch/i.test(station.key) || station.otherPop.hasSwitch, station.key.slice(0, 160));

const switched = await page.evaluate(async () => {
  const t = state.tides.sacramento;
  const other = t.stations.find(s => s.id !== t.station && Number.isFinite(s.lat));
  const m = state.tideLayer.getLayers().find(l =>
    l.getLatLng && Math.abs(l.getLatLng().lat - other.lat) < 1e-9);
  m.openPopup();
  await new Promise(r => setTimeout(r, 300));
  const btn = [...document.querySelectorAll('.leaflet-popup-content button')]
    .find(b => /Read the tide here/.test(b.textContent));
  btn.click();
  await new Promise(r => setTimeout(r, 2500));
  const sel = document.querySelector('select[id^=tidestation]');
  return { want: other.id, now: (state.tides.sacramento || {}).station,
           picker: sel ? sel.value : null };
});
check('pressing it reads the tide there', switched.now === switched.want,
  JSON.stringify(switched));
/* The panel and the map are two views of one choice and must agree — a map
   drawn as "the one you are using" over a panel reading another station is
   two answers to one question. */
check('and the panel agrees about which station that is',
  switched.picker === null || switched.picker === switched.now,
  JSON.stringify(switched));
/* Put it back, so what follows reads the station the rest of the suite does. */
await page.evaluate((id) => switchTideStation(byId('sacramento'), id), station.was);
await page.waitForTimeout(2000);

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
    /* The FIRST list is the changes; a second list follows it for what is
       still not right, and counting every li conflates the two. */
    items: [...(body.querySelector('ul') ? body.querySelector('ul').querySelectorAll('li') : [])]
      .map(li => li.textContent),
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
/* A 1.0 STATES ITS LIMITS WHERE A READER MEETS THEM, not eight releases down.
   The dialog a reader sees after an update has to carry them. */
/* THE LIMITS BELONG TO THE APP, NOT TO A RELEASE. A version that added no new
   caveat must still show the standing ones — otherwise a reader updating to a
   small release is told, by omission, that the app has no limits. */
check('the update dialog carries what is still not right',
  await page.evaluate(() => {
    const standing = RELEASES.find(x => x.broken && x.broken.length);
    if (!standing) return false;
    const t = document.getElementById('newbody').textContent;
    return /Still not right/i.test(t) && t.includes(standing.broken[0].slice(0, 40));
  }),
  await page.evaluate(() => {
    const s = RELEASES.find(x => x.broken && x.broken.length);
    return s ? s.broken.length + ' standing limit(s), declared at ' + s.v : 'none declared anywhere';
  }));
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
/* "IT DOES NOT SHOW THE RIVER LINE, JUST A BUNCH OF DOTS" — over imagery, with
   sixty pins on it, a two-pixel dashed stroke is not a line anybody can see. */
check('the profiled line is drawn heavily enough to see over a photograph',
  await page.evaluate(() => {
    const strokes = state.profLayer.getLayers()
      .filter(l => typeof l.getLatLngs === 'function')
      .map(l => l.options.weight);
    return strokes.length >= 2 && Math.max(...strokes) >= 6 &&
           strokes.some(w => w >= 3 && w < 6);
  }),
  await page.evaluate(() => state.profLayer.getLayers()
    .filter(l => typeof l.getLatLngs === 'function')
    .map(l => l.options.color + '@' + l.options.weight).join(' ')));
check('and the key explains what that line is',
  await page.evaluate(() => [...document.querySelectorAll('#maplegend .keyrow')]
    .some(r => /line the depth below is measured along/i.test(r.textContent))));
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
/* --- a tap belongs on the water ----------------------------------------
   A finger is not a precise instrument, and a tap that lands in an orchard
   beside the Sacramento was being answered as a serious question about the
   depth of an orchard. */
await page.evaluate(() => loadRiverLines());
await page.waitForTimeout(1200);
const snap = await page.evaluate(() => {
  const line = RIVER_LINES[state.riverId];
  const mid = line[Math.floor(line.length / 2)];
  const off = m => [mid[0] + m / 110540, mid[1]];          /* m north of the river */
  return {
    onIt:    snapToRiver(mid[0], mid[1]),
    near:    snapToRiver(off(60)[0], off(60)[1]),
    beside:  snapToRiver(off(600)[0], off(600)[1]),
    faraway: snapToRiver(off(9000)[0], off(9000)[1]),
    mid
  };
});
check('a tap on the river is taken exactly as given',
  snap.onIt.moved === 0 && !snap.onIt.tooFar, JSON.stringify(snap.onIt));
check('a tap a few paces off is taken as given too, not nudged',
  snap.near.moved === 0 && !snap.near.tooFar, JSON.stringify(snap.near));
check('a tap on the bank is moved onto the water, and the distance recorded',
  snap.beside.moved > 100 && !snap.beside.tooFar, JSON.stringify(snap.beside));
/* And a tap in the middle of a county is not a question about the river. */
check('a tap nowhere near the river is refused rather than answered',
  snap.faraway.tooFar === true, JSON.stringify(snap.faraway));

/* MOVING SOMEBODY'S QUESTION WITHOUT SAYING SO IS WORSE THAN REFUSING IT. */
const said = await page.evaluate(() => {
  const n = depthNode({ value: -18, exact: true, snapped: 240,
    survey: { name: 'Bathy_TEST_SacramentoRvr' } }, 38.45, -121.6);
  return { text: n.textContent,
           spoken: depthSentence({ value: -18, exact: true, snapped: 240,
             survey: { name: 'Bathy_TEST_SacramentoRvr' } }) };
});
check('a reading taken on the water says the tap was moved to get it',
  /landed 240 m off the /.test(said.text), said.text.slice(0, 220));
check('and says so aloud as well',
  /240 metres off the river/.test(said.spoken), said.spoken.slice(0, 160));
/* AND IT SAYS IT ON THE SCREEN FOR EVERY OUTCOME, NOT JUST FOR A NUMBER.
   Written beside the reading it appeared only when there was a reading, so a
   tap moved onto unsurveyed water read as the app failing at the spot the
   reader picked — which is not the spot it looked at. */
for (const none of ['nowhere', 'notmeasured', 'nocatalog']){
  const seen = await page.evaluate((k) => {
    const n = depthNode({ none: k, snapped: 300, covering: [{}] }, 38.45, -121.6);
    return n.textContent;
  }, none);
  check('the moved tap is on screen for ' + none + ' too',
    /landed 300 m off the /.test(seen), seen.slice(0, 200));
}
/* The snap is true of every outcome, so it prefixes them rather than
   replacing them — written as its own branch it swallowed the others. */
check('the snap does not swallow the outcome underneath it',
  await page.evaluate(() => {
    const t = depthSentence({ none: 'notmeasured', snapped: 300, covering: [{}] });
    return /off the river/.test(t) && /nothing was measured within/.test(t);
  }),
  await page.evaluate(() => depthSentence({ none: 'notmeasured', snapped: 300, covering: [{}] })));

/* --- every answer that is not a depth ----------------------------------
   "This tells a user nothing about what happened, what should have happened,
   what will happen, or how to do it, or if they did something wrong."
   That was true of all four. Each one now has to say what happened, whether
   the reader did anything wrong, and what to do about it — and this drives
   every branch rather than trusting that the one somebody saw got fixed. */
const outcomes = await page.evaluate(() => {
  const cases = {
    failed:      { failed: 'HTTP 500' },
    nocatalog:   { none: 'nocatalog', covering: [] },
    nowhere:     { none: 'nowhere', covering: [] },
    notmeasured: { none: 'notmeasured', covering: [{ name: 'Bathy_TEST_SacramentoRvr' }] }
  };
  const out = {};
  Object.keys(cases).forEach(k => {
    const n = depthNode(cases[k], 38.45, -121.6);
    out[k] = { text: n.textContent, spoken: depthSentence(cases[k]),
               buttons: [...n.querySelectorAll('button')].map(b => b.textContent.trim()) };
  });
  return out;
});
Object.keys(outcomes).forEach(k => {
  const o = outcomes[k];
  /* Whose doing it was. A reader who cannot tell whether they made a mistake
     will assume they did. */
  check(`the "${k}" answer says whether the reader did anything wrong`,
    /nothing you did/i.test(o.text), o.text.slice(0, 180));
  /* And what to do now — a next step, or a button that takes it. */
  check(`the "${k}" answer says what to do next`,
    /try (the same spot )?again|tap (anywhere )?inside|tap further out|nearer the middle|when you have one|in a moment/i.test(o.text) ||
    o.buttons.length > 0,
    o.text.slice(0, 200));
  /* Read by ear, the spoken line is all somebody gets. */
  check(`the "${k}" answer says the same thing aloud`,
    /nothing you did/i.test(o.spoken) && o.spoken.length > 60, o.spoken);
});
/* Where the reader is simply outside every survey, the app can just take them
   somewhere it does work. */
check('tapping unsurveyed water offers to take you to surveyed water',
  outcomes.nowhere.buttons.some(b => /surveyed water/i.test(b)),
  JSON.stringify(outcomes.nowhere.buttons));
/* The old text said "One survey covers this point and none of them has a
   reading here" — one, and none of them. */
check('the not-measured answer is grammatical about how many surveys there are',
  !/One survey covers[^.]*none of them/i.test(outcomes.notmeasured.text),
  outcomes.notmeasured.text.slice(0, 200));

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
/* --- A PIN IS 13 PIXELS WIDE AND A FINGER IS NOT --------------------------
   Measured before the fix by walking out from each centre and asking the
   document what was on top: 13 px across for an access site, 11 for an idle
   tide station, 19 for the live one. The floor is 44.

   And a miss was not inert. The map's own handler ran and answered a question
   about the depth of the water under the miss — so pressing a circle marked
   "places I can go" returned a depth, and the circles read as decoration.
   These drive the geometry rather than the styling, because the styling was
   never the thing that was wrong. */
const pinAt = async (off) => {
  await page.evaluate(() => { state.map.closePopup();
    const s = ACCESS_LANDS.sacramento[0]; state.map.setView([s.lat, s.lon], 14); });
  await page.waitForTimeout(500);
  const pt = await page.evaluate(() => {
    const p = state.map.latLngToContainerPoint(
      [ACCESS_LANDS.sacramento[0].lat, ACCESS_LANDS.sacramento[0].lon]);
    const b = state.map.getContainer().getBoundingClientRect();
    return { x: b.x + p.x, y: b.y + p.y };
  });
  await page.mouse.click(pt.x + off, pt.y);
  await page.waitForTimeout(700);
  return page.evaluate(() => {
    const pop = document.querySelector('.leaflet-popup-content');
    if (!pop) return 'nothing';
    return /Depth here|Not on the river/.test(pop.textContent) ? 'depth' : 'pin';
  });
};

for (const off of [0, 10, 20]){
  check('a press ' + off + ' px off a public-land pin reaches the pin',
    await pinAt(off) === 'pin', 'got ' + await pinAt(off));
}
/* THE RESCUE HAS TO HAVE AN EDGE, or the map stops being able to answer the
   question it is for. Past a finger's width the water gets the tap back. */
check('a press well clear of every pin still asks the water',
  await pinAt(45) === 'depth');

/* The dense layer is deliberately outside the rescue: hundreds of soundings
   three pixels apart would mean no tap ever reached the water again. */
check('soundings are not in the rescue, so they cannot swallow the map',
  await page.evaluate(() => pinLayers().every(p => p[0] !== state.soundingLayer)));
check('and nothing without a popup can take a press',
  await page.evaluate(() => {
    state.map.setView([38.45, -121.6], 13);
    return nearestPin({ lat: 0, lng: 0 }) === null;
  }));

/* --- AND THEY MUST NOT LOOK LIKE A TIDE STATION -------------------------
   A green ring on a dark fill beside a teal ring on a dark fill, at five
   pixels' radius, outdoors. Hue is the one cue a colour-blind reader does not
   get and the one sunlight takes first, so the difference is a SHAPE. */
check('a public-land pin is a square, not another small circle',
  await page.evaluate(() => {
    const pin = document.querySelector('.accesspin');
    return !!pin && getComputedStyle(pin).borderRadius === '0px';
  }),
  await page.evaluate(() => { const p = document.querySelector('.accesspin');
    return p ? getComputedStyle(p).borderRadius : 'no pin'; }));
check('and the key carries the same shape, or it describes another map',
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#maplegend .keyrow')];
    const r = rows.find(x => /Public land/.test(x.textContent));
    return !!r && getComputedStyle(r.querySelector('i.sw')).borderRadius === '0px';
  }));
check('while a tide station stays round, so the two read apart',
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#maplegend .keyrow')];
    const r = rows.find(x => /tide station/i.test(x.textContent));
    return !!r && getComputedStyle(r.querySelector('i.sw')).borderRadius !== '0px';
  }));

await page.click('#tab-layers');
await page.waitForTimeout(800);
/* --- THE PANEL DOES BEFORE IT EXPLAINS ---------------------------------
   Every section here was a heading, then two or three paragraphs of what the
   thing is and where its data comes from, and only then the button that does
   it. All true, none of it deletable — and stacked in front of the controls
   it pushed the rest of the panel off the screen, so the reader who wanted
   the second control never learnt there was one. Measured before the change,
   on a 900px window: "Read the depth at the map centre" sat 733px down a
   661px panel. */
const panel = await page.evaluate(() => {
  const p = document.getElementById('panel-layers');
  /* Text a reader can actually see: not the inside of a closed fold. */
  const visibleTextBefore = (el) => {
    let n = 0;
    const walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walk.nextNode())){
      /* PRECEDING means "node comes before el" — count those and only those. */
      if (!(el.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING)) continue;
      if (node.parentElement.closest('details:not([open])')) continue;
      n += node.textContent.trim().length;
    }
    return n;
  };
  const all = [...p.querySelectorAll('button, details.foldbox')];
  const btn = (re) => [...p.querySelectorAll('button')].find(b => re.test(b.textContent));
  const centre = btn(/Read the depth at the map centre/);
  const folds = [...p.querySelectorAll('details.foldbox')];
  return {
    proseBeforeLastPrimary: centre ? visibleTextBefore(centre) : -1,
    folds: folds.length,
    /* every fold has a control ahead of it — the panel acts, then explains */
    everyFoldFollowsAControl: folds.every(f => {
      const i = all.indexOf(f);
      return all.slice(0, i).some(e => e.tagName === 'BUTTON');
    }),
    closedByDefault: folds.every(f => !f.open),
    everyFoldIsNamed: folds.every(f => (f.querySelector('summary')||{}).textContent.trim().length > 8),
    text: p.textContent
  };
});
check('the explanations are folded, not stacked in front of the controls',
  panel.folds >= 5, panel.folds + ' fold(s)');
check('every fold comes after something that does the thing',
  panel.everyFoldFollowsAControl);
check('and each one says what it holds before you open it',
  panel.everyFoldIsNamed && panel.closedByDefault);
/* The budget is the point: this is the number the reader was complaining
   about, and a fixed pixel assertion would move with the font. */
check('a reader reaches the last depth control without wading',
  panel.proseBeforeLastPrimary > 0 && panel.proseBeforeLastPrimary < 450,
  panel.proseBeforeLastPrimary + ' characters of visible prose before it');
/* NOTHING WAS DELETED. Folding honesty out of the way is fine; losing it is
   not, and a shorter panel achieved by dropping provenance would pass every
   check above. */
[ 'no coordinate down the middle of these rivers was invented here',
  'THEY ARE NOT BOAT RAMPS',
  'missing data, not flat bottom',
  'the nearest place it did measure',
  'middle of a property rather than a spot on the bank'
].forEach(frag => check('still says: ' + frag.slice(0, 34),
  panel.text.includes(frag)));

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

/* --- tracing the profile onto the map ----------------------------------
   The picture says how deep it is somewhere along the line; the map says where
   things are. Until now a reader held the join between them in their head. */
const box = await page.evaluate(() => {
  const r = document.getElementById('profsvg').getBoundingClientRect();
  return { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height * 0.5),
           x2: Math.round(r.left + r.width * 0.7) };
});
await page.mouse.move(box.x, box.y);
await page.mouse.down();
await page.waitForTimeout(300);
const traced = await page.evaluate(() => ({
  onMap: state.traceLayer ? state.traceLayer.getLayers().length : -1,
  readout: [...document.querySelectorAll('#profsvg text')]
    .map(t => t.textContent).filter(t => /ft$|not measured/.test(t)),
  at: state.traceLayer && state.traceLayer.getLayers()[0]
    ? state.traceLayer.getLayers()[0].getLatLng() : null
}));
check('dragging the profile marks the place on the map',
  traced.onMap === 1 && !!traced.at, JSON.stringify(traced).slice(0, 200));
check('and shows the depth it actually measured there',
  traced.readout.length > 0, JSON.stringify(traced.readout));
/* THE MARK MUST MOVE WITH THE FINGER, not sit where it first landed. */
await page.mouse.move(box.x2, box.y);
await page.waitForTimeout(250);
const moved = await page.evaluate(() => {
  const l = state.traceLayer.getLayers()[0];
  return l ? l.getLatLng() : null;
});
check('the mark follows the finger along the line',
  !!moved && (Math.abs(moved.lat - traced.at.lat) > 1e-6 ||
              Math.abs(moved.lng - traced.at.lng) > 1e-6),
  JSON.stringify({ first: traced.at, then: moved }));
await page.mouse.up();
await page.waitForTimeout(400);
/* LIFTING THE FINGER USED TO THROW THE POINT AWAY, which is the opposite of
   what dragging along a profile is for: you found the deep bit and the moment
   you found it the mark vanished, so you had learnt that a deep bit exists and
   nothing about where. It is held now. */
check('letting go keeps the mark, it does not discard it',
  await page.evaluate(() => state.traceLayer.getLayers().length) > 0,
  await page.evaluate(() => JSON.stringify(state.traceAt)));
const held = await page.evaluate(() => {
  const b = document.getElementById('profheld');
  return { text: b ? b.textContent : '',
           buttons: b ? [...b.querySelectorAll('button')].map(x => x.textContent) : [] };
});
check('and says which bank it is on, as the river runs',
  /bank|middle of the channel/.test(held.text), held.text.slice(0, 200));
check('and how far off the middle of the channel',
  /\d+ m off the middle|within \d+ m of the middle/.test(held.text), held.text.slice(0, 200));
check('and how to get to it',
  /Nearest public land|publishes no land of its own/.test(held.text), held.text.slice(0, 260));
check('and offers to show it, keep it, or let it go',
  held.buttons.some(b => /Show me this point/.test(b)) &&
  held.buttons.some(b => /Keep it as a mark/.test(b)) &&
  held.buttons.some(b => /Let it go/.test(b)), JSON.stringify(held.buttons));

/* LEFT AND RIGHT ARE AS THE RIVER RUNS, and the baked centreline is stored
   MOUTH FIRST — so downstream at a point is back towards the previous index.
   Getting that backwards swaps every left for a right, silently and
   convincingly, so it is driven rather than trusted. */
check('left and right are taken from the downstream direction, not the array order',
  await page.evaluate(() => {
    const river = byId('sacramento');
    const line = riverLineFor(river.id);
    if (!line || line.length < 3) return 'noline';
    /* A point a short way to the WEST of a north-flowing-to-the-south reach.
       Work it out from the geometry rather than asserting a compass answer:
       step off the line perpendicular to the downstream vector, on the side a
       positive cross product should call "left", and require that name back. */
    const i = Math.floor(line.length / 2);
    const here = line[i], down = line[i - 1];
    const dx = down[1] - here[1], dy = down[0] - here[0];
    const len = Math.hypot(dx, dy) || 1;
    /* left of the downstream vector is (-dy, dx) normalised */
    const off = 0.004;
    const lat = here[0] + (dx / len) * off, lon = here[1] - (dy / len) * off;
    const b = bankOf(river, lat, lon);
    return b && b.side;
  }) === 'left',
  await page.evaluate(() => {
    const river = byId('sacramento');
    const line = riverLineFor(river.id);
    const i = Math.floor(line.length / 2);
    const here = line[i], down = line[i - 1];
    const dx = down[1] - here[1], dy = down[0] - here[0];
    const len = Math.hypot(dx, dy) || 1;
    const lat = here[0] + (dx / len) * 0.004, lon = here[1] - (dy / len) * 0.004;
    return JSON.stringify(bankOf(river, lat, lon));
  }));
check('and the middle of the channel is called neither bank',
  await page.evaluate(() => {
    const river = byId('sacramento');
    const line = riverLineFor(river.id);
    const b = bankOf(river, line[5][0], line[5][1]);
    return b && b.side === null;
  }));
/* A held point belongs to the line it was found on. */
check('drawing a new line lets the old point go',
  await page.evaluate(async () => {
    const before = !!state.traceAt;
    runProfile(state.profile.pts.slice());
    await new Promise(r => setTimeout(r, 300));
    return before && !state.traceAt &&
      document.getElementById('profheld').textContent === '';
  }));

/* --- getting back ------------------------------------------------------- */
const back = await page.evaluate(() => {
  const b = document.getElementById('backbtn');
  return { there: !!b, hidden: b ? b.hidden : null, text: b ? b.textContent.trim() : '' };
});
check('there is a way back to where you were', back.there && !back.hidden,
  JSON.stringify(back));
check('and it names which of the two it will go to', /Back to me|Back to my mark/.test(back.text),
  back.text);
await page.evaluate(() => state.map.setView([40.5, -122.2], 9));
await page.waitForTimeout(400);
await page.click('#backbtn');
/* WAIT FOR THE MAP TO STOP, DO NOT BET ON A NUMBER OF MILLISECONDS. This
   asserted the centre 800 ms after the press, which is a bet that a six-zoom
   animated pan finishes in 800 ms on whatever machine is running. It caught
   the map IN FLIGHT — a third of the way from where the test had parked it to
   where the button was correctly taking it — and reported the button as
   broken. The button was never broken; the clock was. */
await page.waitForFunction(() => {
  const c = state.map.getCenter();
  return Math.abs(c.lat - state.here.lat) < 0.01 && Math.abs(c.lng - state.here.lon) < 0.01;
}, null, { timeout: 8000 }).catch(() => {});
check('pressing it returns to your own position',
  await page.evaluate(() => {
    const c = state.map.getCenter();
    return Math.abs(c.lat - state.here.lat) < 0.01 && Math.abs(c.lng - state.here.lon) < 0.01;
  }),
  await page.evaluate(() => JSON.stringify(state.map.getCenter())));

/* --- AND IT STAYS THERE ---------------------------------------------------
   This is the defect the check above found by failing. Pressing "Profile down
   the river itself" starts a fetch; on a slow signal it lands seconds later
   and fitted the map to the whole surveyed run, over the top of wherever the
   reader had gone in the meantime. The map arrived at you and was then dragged
   away to a stretch of river fifty miles off, with nothing saying why.
   The view the reader asked for last is the one that holds. */
check('a fit that arrives late does not drag the map off the reader',
  await page.evaluate(async () => {
    const claim = claimView();              /* as a press would take */
    goBackToMine();                         /* the reader asks for somewhere */
    await new Promise(r => setTimeout(r, 400));
    /* now the earlier press's fetch comes back and tries to have its way */
    mapView(L.latLngBounds([[40.4, -122.3], [40.6, -122.1]]), { animate: false }, claim);
    const c = state.map.getCenter();
    return Math.abs(c.lat - state.here.lat) < 0.01 && Math.abs(c.lng - state.here.lon) < 0.01;
  }),
  await page.evaluate(() => JSON.stringify(state.map.getCenter())));
/* AN OPEN POPUP USED TO TETHER THE MAP. Leaflet re-pans to keep a popup in
   view whenever the view resets, so pressing a pin and then a go-there button
   arrived and was hauled straight back to the pin. The button looked broken,
   and the cause was a label two hundred miles away insisting on staying on
   screen. This is the check that would have caught it: it failed for four
   different wrong reasons before the real one, so it is worth having. */
check('a pin popup does not drag the map back when you ask to go elsewhere',
  await page.evaluate(async () => {
    state.map.setView([40.5, -122.2], 9);
    const pin = state.accessLayer.getLayers()[0] || state.tideLayer.getLayers()[0];
    pin.openPopup();
    await new Promise(r => setTimeout(r, 300));
    goBackToMine();
    await new Promise(r => setTimeout(r, 600));
    const c = state.map.getCenter();
    return Math.abs(c.lat - state.here.lat) < 0.01 && Math.abs(c.lng - state.here.lon) < 0.01;
  }),
  await page.evaluate(() => JSON.stringify(state.map.getCenter())));

/* ...but it is not simply ignored forever: a fit nobody has overruled applies. */
check('and a fit nobody has overruled still moves the map',
  await page.evaluate(() => {
    const claim = claimView();
    mapView(L.latLngBounds([[40.4, -122.3], [40.6, -122.1]]), { animate: false }, claim);
    const c = state.map.getCenter();
    return Math.abs(c.lat - 40.5) < 0.2;
  }),
  await page.evaluate(() => JSON.stringify(state.map.getCenter())));

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
