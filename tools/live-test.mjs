/* End-to-end against the live services.
 *
 * The browser's own requests are relayed through Node rather than stubbed:
 * every response below is the real bytes from USGS, NOAA, DWR and Esri on
 * the day it ran. Nothing here is a fixture. The relay exists only because
 * the sandbox this was built in lets Node reach those hosts and does not
 * let Chromium, and it is the same shape as what the Worker does in
 * production, so the app code path is the real one.
 *
 *   node tools/serve.mjs &
 *   NODE_USE_ENV_PROXY=1 node tools/live-test.mjs
 */
import { chromium } from 'playwright-core';
const BASE = process.argv[2] || 'http://127.0.0.1:8787';

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('PASS  ' + n))
                             : (fail++, console.log('FAIL  ' + n + (d ? ' — ' + String(d).slice(0, 300) : '')));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--proxy-server=http://127.0.0.1:1', '--proxy-bypass-list=127.0.0.1;localhost;[::1]']
});
/* Service workers are blocked: a worker's own fetch does not pass through
   a page route, so with one installed the relay would never see the
   request. The service worker and offline behaviour are tools/a11y.mjs. */
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, serviceWorkers: 'block' });

const relayed = { ok: 0, fail: 0, hosts: new Set() };
await ctx.route(url => !url.hostname.startsWith('127.0.0.1') && url.hostname !== 'localhost',
  async route => {
    const req = route.request();
    try {
      const res = await fetch(req.url(), { method: req.method(), redirect: 'follow' });
      const body = Buffer.from(await res.arrayBuffer());
      relayed.ok++; relayed.hosts.add(new URL(req.url()).hostname);
      await route.fulfill({
        status: res.status,
        headers: {
          'content-type': res.headers.get('content-type') || 'application/octet-stream',
          'access-control-allow-origin': '*'
        },
        body
      });
    } catch (e) {
      relayed.fail++;
      console.log('  relay FAIL ' + req.url().slice(0, 110) + ' :: ' + (e && e.message));
      await route.abort();
    }
  });

const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(18000);
await page.evaluate(() => { const d = document.getElementById('welcome'); if (d && d.open) d.querySelector('button').click(); });
await page.waitForTimeout(3000);

/* ---- gauges ---- */
let water = (await page.textContent('#panel-water')).replace(/\s+/g, ' ');
check('USGS answered with real site names', /SACRAMENTO R A RIO VISTA CA/i.test(water), water.slice(0, 200));
check('a flow figure is present', /\d[\d,]* ?cfs|\d+ cfs/i.test(water) || /cfs/.test(water));
check('no site errored', !/request failed|no data returned/.test(water), water.slice(0, 400));
check('the header is not claiming stale data',
  !/network did not answer/.test(await page.textContent('#staleness')),
  await page.textContent('#staleness'));

/* ---- ribbon ---- */
const note = await page.textContent('#ribbonnote');
check('the ribbon plotted the gauges', /[1-9]\d* gauges plotted/.test(note), note);
check('every gauge got a position', !/not plotted/.test(note), note);
check('the tidal reach is drawn to a named station',
  await page.evaluate(() => [...document.querySelectorAll('#ribbon text')]
    .some(t => /tide predicted to /.test(t.textContent))));

/* ---- tide ---- */
check('gauges are marked on the map',
  await page.evaluate(() => state.gaugeLayer.getLayers().length) >= 6,
  await page.evaluate(() => state.gaugeLayer.getLayers().length));
check('a tide curve was drawn', await page.evaluate(() => !!document.querySelector('#tidechart path')));
check('highs and lows listed', /High ·|Low ·/.test(water), water.slice(0, 300));

/* ---- layers, enumerated live ---- */
/* Depth is per river and the app opens on All, so pick one. */
check('a first run opens on All rivers',
  await page.evaluate(() => document.getElementById('riverpick').value) === '',
  await page.evaluate(() => document.getElementById('riverpick').value));
await page.selectOption('#riverpick', 'sacramento');
await page.waitForTimeout(12000);
water = (await page.textContent('#panel-water')).replace(/\s+/g, ' ');
await page.click('#tab-layers');
await page.waitForTimeout(30000);
let layers = (await page.textContent('#panel-layers')).replace(/\s+/g, ' ');
const cat = await page.evaluate(() => state.catalog && {
  raster: state.catalog.raster.length, single: state.catalog.single.length,
  rasterError: state.catalog.rasterError, singleError: state.catalog.singleError,
  unplaced: state.catalog.raster.concat(state.catalog.single)
    .filter(r => r.box && r.box.unknownWkid).length
});
check('the multibeam directory enumerated', cat && cat.raster >= 20, JSON.stringify(cat));
check('the single beam service enumerated', cat && cat.single >= 80, JSON.stringify(cat));
check('every layer extent was placed', cat && cat.unplaced === 0, cat && cat.unplaced);
check('descriptions arrive as prose, not markup', !/<DIV|<SPAN|&lt;DIV/i.test(layers), layers.slice(0, 300));
check('a depth ramp switch is offered', /Depth ramp/.test(layers));

/* switch a surface on and confirm tiles decode */
const surfaces = await page.evaluate(() => [...document.querySelectorAll('#panel-layers button')]
  .map(b => b.textContent).filter(t => /^Bathymetry\/|^Bathy_/.test(t)));
check('surfaces are listed for the Sacramento', surfaces.length > 0, JSON.stringify(surfaces.slice(0, 3)));
if (surfaces.length) {
  await page.click(`#panel-layers button:text-is(${JSON.stringify(surfaces[0])})`);
  await page.waitForTimeout(8000);
  const tiles = await page.evaluate(() =>
    [...document.querySelectorAll('.leaflet-tile')].filter(t => t.src.includes('exportImage')).length);
  check('depth tiles were requested and loaded', tiles > 0, 'tiles=' + tiles);
}

/* ---- the rivers with no multibeam say so ---- */
await page.selectOption('#riverpick', 'feather');
await page.waitForTimeout(20000);
layers = (await page.textContent('#panel-layers')).replace(/\s+/g, ' ');
check('the Feather says it has no multibeam', /No published multibeam survey for this reach/.test(layers), layers.slice(0, 300));
check('the Feather offers its 2017 single beam surveys',
  /i06_Bathy_NCRO_2017\d+_FeatherRiver/.test(layers), layers.slice(0, 600));
water = (await page.textContent('#panel-water')).replace(/\s+/g, ' ');
check('the Feather reports from CDEC',
  /Feather River near Gridley/.test(water) && /CDEC GRL/.test(water), water.slice(0, 400));
check('the Feather gauges carry real flow',
  await page.evaluate(() => (state.gauges.feather.rows || [])
    .filter(r => r.source === 'CDEC' && typeof r.flow === 'number' && r.flow > 0).length) >= 2,
  await page.evaluate(() => JSON.stringify((state.gauges.feather.rows || [])
    .filter(r => r.source === 'CDEC').map(r => [r.id, r.flow, r.stage, r.tempF]))));
check('the -9999 sentinel never became a reading',
  await page.evaluate(() => (state.gauges.feather.rows || [])
    .every(r => [r.flow, r.stage, r.tempF].every(v => v === null || v > -9998))));
check('a station with no temperature sensor shows nothing, not a zero',
  await page.evaluate(() => { const r = (state.gauges.feather.rows || []).find(x => x.id === 'FSB');
    return !!r && r.tempF === null; }));
check('the Feather says whose gauges these are',
  /DWR’s gauges, read from CDEC|DWR's gauges, read from CDEC/.test(water), water.slice(0, 400));
check('the Feather still shows its tributaries',
  /YUBA R NR MARYSVILLE|BEAR R NR WHEATLAND/i.test(water), water.slice(0, 700));
check('the Feather ribbon now plots its gauges',
  /[1-9]\d* gauges plotted/.test(await page.textContent('#ribbonnote')),
  await page.textContent('#ribbonnote'));

/* ---- Mokelumne tide ---- */
await page.selectOption('#riverpick', 'mokelumne');
await page.waitForTimeout(20000);
water = (await page.textContent('#panel-water')).replace(/\s+/g, ' ');
check('the Mokelumne has a tide station', /New Hope Bridge|Terminous/.test(water), water.slice(0, 300));
check('the Mokelumne gauges report', /MOKELUMNE/i.test(water), water.slice(0, 400));

await page.selectOption('#riverpick', 'sacramento');
await page.waitForTimeout(6000);
await page.screenshot({ path: '/tmp/live-final.png' });

check('no page errors anywhere', errs.length === 0, errs.join(' | '));
console.log(`\nrelayed ${relayed.ok} live responses from ${[...relayed.hosts].join(', ')}` +
  (relayed.fail ? `, ${relayed.fail} failed` : ''));
console.log(`${pass} passed, ${fail} failed.`);
await browser.close();
process.exit(fail ? 1 : 0);
