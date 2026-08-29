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
  ts('11447650', 'SACRAMENTO R A FREEPORT CA',  38.4558, -121.5000, '63680', 2.0, 'NTU')
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

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--proxy-server=http://127.0.0.1:1', '--proxy-bypass-list=127.0.0.1;localhost;[::1]'] });
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
await ctx.route('**/mdapi/**', r => json(r, { stations: [
  { id: '9415316', name: 'Rio Vista', lat: 38.1583, lng: -121.6853 },
  { id: '9999999', name: 'Synthetic Mokelumne', lat: 38.15, lng: -121.40 }] }));
await ctx.route('**/arcgisimg/rest/services/Bathymetry?f=json', r => json(r, FOLDER));
await ctx.route('**/Bathy_TEST_SacramentoRvr/ImageServer?f=json', r =>
  json(r, imgMeta('Bathy_TEST_SacramentoRvr', -121.75, 38.30, -121.45, 38.65)));
await ctx.route('**/Bathy_TEST_Elsewhere/ImageServer?f=json', r =>
  json(r, imgMeta('Bathy_TEST_Elsewhere', 10.0, 50.0, 10.2, 50.2)));
await ctx.route('**/MapServer/layers?f=json', r => json(r, SBM_LAYERS));

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
check('discovered station offered alongside the verified ones',
  await page.evaluate(() => { const s = document.querySelector('select[id^=tidestation]');
    return !!s && s.options.length >= 3; }));

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
