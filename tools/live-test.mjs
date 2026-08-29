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

/* ---- the landing: one card per river, no map ---- */
let water = (await page.textContent('#panel-water')).replace(/\s+/g, ' ');
const cards = await page.evaluate(() => [...document.querySelectorAll('.rivercard')]
  .map(c => c.textContent.replace(/\s+/g, ' ').trim()));
check('a card for every river', cards.length === 4, JSON.stringify(cards.length));
check('every card carries a temperature and a reading',
  cards.every(c => /\d+F/.test(c) && /(moving|workable|holding deep|stressed)/.test(c)),
  JSON.stringify(cards));
check('every card carries a flow figure', cards.every(c => /cfs/.test(c)), JSON.stringify(cards));
check('every card says whether the river is open',
  cards.every(c => /open|closed|not confirmed/i.test(c)), JSON.stringify(cards));
/* The furthest downstream gauge on a tidal river reads the tide, not the
   river. Discharge has to come from the lowest gauge above the tide. */
check('the Sacramento quotes a gauge above the tide, not Rio Vista',
  /VERONA/i.test(cards[0]) && !/RIO VISTA/i.test(cards[0]), cards[0]);
check('a river with no gauge above the tide says its flow is tidal',
  /tidal flow, not what the river is carrying/.test(cards[3]), cards[3]);
check('All rivers shows no map',
  await page.evaluate(() => document.getElementById('map').getBoundingClientRect().height === 0));
check('the header is not claiming stale data',
  !/network did not answer/.test(await page.textContent('#staleness')),
  await page.textContent('#staleness'));

/* ---- and a card opens its river ---- */
await page.click('.rivercard');
await page.waitForTimeout(14000);
check('tapping a card opens that river',
  await page.evaluate(() => document.getElementById('riverpick').value) === 'sacramento');
check('the map comes back with it',
  await page.evaluate(() => document.getElementById('map').getBoundingClientRect().height > 100));
water = (await page.textContent('#panel-water')).replace(/\s+/g, ' ');
check('USGS answered with real site names', /SACRAMENTO R A RIO VISTA CA/i.test(water), water.slice(0, 200));
check('a flow figure is present', /cfs/.test(water));
check('no site errored', !/request failed|no data returned/.test(water), water.slice(0, 400));

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
/* Selected by the survey's identity rather than its label: the label is
   written for readers and is allowed to change, and this check went red the
   day it did, taking the tile-decode checks below with it silently. */
const surfaces = await page.evaluate(() => [...document.querySelectorAll('#panel-layers button[data-survey]')]
  .map(b => b.getAttribute('data-survey')).filter(t => /^Bathy_/.test(t)));
check('surfaces are listed for the Sacramento', surfaces.length > 0, JSON.stringify(surfaces.slice(0, 3)));
if (surfaces.length) {
  await page.click(`#panel-layers button[data-survey=${JSON.stringify(surfaces[0])}]`);
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

/* ---- the last seven days, against the real record ---- */
/* The American is the one river where both lines come from the same gauge,
   which makes it the case where a mistake in site selection would not show. */
await page.selectOption('#riverpick', 'american');
await page.waitForTimeout(22000);
/* The layer tests above left the Layers panel showing, and a hidden panel
   has no width: the lines were drawn at their fallback size and measured at
   zero. They are redrawn when the Water tab is shown, which is what a reader
   does and what this now does. */
await page.click('#tab-water');
await page.waitForTimeout(800);
const tr = await page.evaluate(() => {
  const t = state.trends.american;
  const sparks = [...document.querySelectorAll('#panel-water .spark')].map(n => ({
    vb: Number((n.getAttribute('viewBox') || '0 0 0 0').split(' ')[2]),
    w: Math.round(n.getBoundingClientRect().width),
    label: n.getAttribute('aria-label') || '',
    pts: (n.querySelector('.spark-line')?.getAttribute('d') || '').split('L').length
  }));
  return { flow: t && t.flow && { site: t.flow.site, n: t.flow.pts.length },
           temp: t && t.temp && { site: t.temp.site, n: t.temp.pts.length },
           says: [...document.querySelectorAll('#panel-water .trend-say')].map(n => n.textContent),
           sparks };
});
check('the American publishes a week of flow', tr.flow && tr.flow.n > 300, JSON.stringify(tr.flow));
check('and a week of temperature', tr.temp && tr.temp.n > 300, JSON.stringify(tr.temp));
check('both lines are drawn', tr.sparks.length === 2, JSON.stringify(tr.sparks.map(s => s.vb)));
/* The ribbon rendered every figure at half size for twenty-two releases
   because it was drawn into a viewBox four times the space it had. The
   scale here is asserted rather than assumed. */
check('the lines are drawn at the width they are rendered at',
  tr.sparks.every(s => Math.abs(s.vb - s.w) <= 1), JSON.stringify(tr.sparks.map(s => s.vb + '/' + s.w)));
check('each line has a real path through it',
  tr.sparks.every(s => s.pts > 50), JSON.stringify(tr.sparks.map(s => s.pts)));
/* Colour is never the only thing carrying a fact here: the direction, the
   distance and the window are all in words next to the line and inside its
   accessible name. */
check('each line says which way and how far, in words',
  tr.says.length === 2 &&
  tr.says.every(t => /(Rising|Falling|Steady|Warming|Cooling) — /.test(t) && /over \d+ days/.test(t)),
  JSON.stringify(tr.says));
check('the accessible name carries the same sentence',
  tr.sparks.every(s => /over \d+ days\./.test(s.label) &&
    /(Rising|Falling|Steady|Warming|Cooling)/.test(s.label)),
  JSON.stringify(tr.sparks.map(s => s.label.slice(0, 80))));

/* Verona measures the Sacramento's discharge and publishes no temperature
   history at all, though it reports one right now. Asking one gauge left
   that river with a flow line and the words "no temperature history" on it. */
await page.selectOption('#riverpick', 'sacramento');
await page.waitForTimeout(22000);
const sac = await page.evaluate(() => {
  const t = state.trends.sacramento;
  return { flowSite: t && t.flow && t.flow.site, tempSite: t && t.temp && t.temp.site,
           noHistory: t && t.noHistory };
});
check('the Sacramento reads flow from the gauge the card names',
  sac.flowSite === '11425500', JSON.stringify(sac));
check('and finds a temperature history at a different gauge',
  sac.tempSite && sac.tempSite !== sac.flowSite, JSON.stringify(sac));

/* Every Mokelumne gauge answers for right now and publishes no history at
   all. An absent line has to be a sentence, not a blank space. */
await page.selectOption('#riverpick', 'mokelumne');
await page.waitForTimeout(22000);
const mok = await page.evaluate(() => {
  const t = state.trends.mokelumne;
  return { flow: !!(t && t.flow), temp: !!(t && t.temp),
           noHistory: (t && t.noHistory) || [],
           said: [...document.querySelectorAll('#panel-water p')]
             .some(n => /no line to draw/.test(n.textContent)) };
});
check('the Mokelumne has no published history and says so',
  !mok.flow && !mok.temp && mok.noHistory.length > 0 && mok.said, JSON.stringify(mok));

/* ---- turbidity, and the rivers that have no sensor for it ---- */
/* Verified 2026-08-28: published at Rio Vista, Freeport and Verona on the
   Sacramento and at two of the Mokelumne's three, at NONE of the American's
   four, and CDEC publishes none for the Feather. The asymmetry is the point:
   a river with no sensor is a river nobody is measuring, which is a
   different fact from clear water. */
await page.selectOption('#riverpick', 'sacramento');
await page.waitForTimeout(20000);
const turb = await page.evaluate(() => ({
  sac: (state.gauges.sacramento?.rows || []).filter(r => typeof r.turb === 'number').length,
  amr: (state.gauges.american?.rows || []).filter(r => typeof r.turb === 'number').length,
  words: document.getElementById('panel-water').innerText.replace(/\s+/g, ' ')
}));
check('the Sacramento reports turbidity from more than one gauge',
  turb.sac >= 2, JSON.stringify({ sac: turb.sac }));
check('and each reading is given in words as well as FNU',
  /(clear|lightly coloured|stained|muddy) — turbidity/.test(turb.words),
  turb.words.slice(0, 300));
check('the American has no turbidity sensor at all, which is a fact not a gap',
  turb.amr === 0, JSON.stringify({ amr: turb.amr }));
await page.selectOption('#riverpick', '');
await page.waitForTimeout(6000);
const clarityCards = await page.evaluate(() =>
  document.getElementById('panel-water').innerText.replace(/\s+/g, ' '));
check('the landing says which rivers nobody measures clarity on',
  /no turbidity sensor on this river/.test(clarityCards), clarityCards.slice(0, 400));

/* ---- velocity, and the sign convention checked against the real record ---- */
/* Verified 2026-08-29: at all seven gauges publishing both, the velocity sign
   matched the discharge sign at the same timestamp. The app re-checks it per
   gauge rather than trusting that, so this asserts the check runs and agrees. */
await page.selectOption('#riverpick', 'sacramento');
await page.waitForTimeout(20000);
const vel = await page.evaluate(() => {
  const rows = (state.gauges.sacramento?.rows || []).filter(r => typeof r.vel === 'number');
  return { n: rows.length,
    disagreeing: rows.filter(r => typeof r.flow === 'number' && (r.flow >= 0) !== (r.vel >= 0))
      .map(r => [r.id, r.flow, r.vel]),
    words: document.getElementById('panel-water').innerText.replace(/\s+/g, ' ') };
});
/* Discovery is a sweep over a whole basin and is the most expensive request
   this app makes — 234KB and nine seconds. It must not carry the enrichment
   parameters: adding them took it to 354KB, four of those fire on a cold
   open, and the run where that happened had every gauge on every river read
   as not answering. */
check('the discovery sweep does not carry the enrichment parameters',
  await page.evaluate(() => USGS_DISCOVER_PARAMS === '00060,00065,00010' &&
    USGS_PARAMS.indexOf('72255') !== -1 && USGS_PARAMS.indexOf('63680') !== -1),
  await page.evaluate(() => USGS_DISCOVER_PARAMS + ' vs ' + USGS_PARAMS));
check('the Sacramento reports water velocity from more than one gauge',
  vel.n >= 2, JSON.stringify({ n: vel.n }));
check('and says which way that is, marked as measured rather than predicted',
  /running (up|down)stream/.test(vel.words) && /measured, not predicted/.test(vel.words),
  vel.words.slice(0, 300));
/* Not an assertion that they never disagree — an assertion that a
   disagreement is reported as one. Live data is allowed to be odd. */
check('any gauge whose velocity and discharge disagree says so',
  vel.disagreeing.length === 0 ||
  /disagree about which way this water is going/.test(vel.words),
  JSON.stringify(vel.disagreeing));

/* ---- depth at a point, against the real surveys ---- */
/* Every coordinate here was found by walking the service, not by recall: the
   channel at 38.40061 N reads to about 30 m west of that line and is NoData
   beyond it, and of four hundred points sampled across this survey's whole
   bounding box exactly ONE had a value. */
await page.selectOption('#riverpick', 'sacramento');
await page.waitForTimeout(20000);
const D = await page.evaluate(async () => {
  const at = async (la, lo) => {
    const r = await depthAt(la, lo);
    return { v: r.value === undefined ? null : +Number(r.value).toFixed(2),
             exact: !!r.exact, away: r.away === undefined ? null : Math.round(r.away),
             none: r.none || null, survey: r.survey ? r.survey.name : null,
             date: r.survey ? r.survey._date : null, covering: (r.covering || []).length };
  };
  return { on:      await at(38.4006076, -121.5141745),
           edge:    await at(38.4006076, -121.514875),
           bank:    await at(38.4006076, -121.51558),
           dry:     await at(38.4300,    -121.4500),
           nowhere: await at(39.5000,    -122.0000) };
});
check('a point on the surveyed channel reads a depth',
  D.on.v !== null && D.on.v < 0 && D.on.exact, JSON.stringify(D.on));
check('and names the survey it came from, with its date',
  /^Bathy_/.test(D.on.survey || '') && /^\d{4}-\d{2}-\d{2}$/.test(D.on.date || ''), JSON.stringify(D.on));
/* A fingertip covers about a hundred metres at a usable zoom, so the single
   pixel misses the channel constantly. NoData there means "not that pixel",
   not "no survey", and answering the first as the second would be a lie in
   the app's own subject. */
check('a point just off the channel falls back to the nearest measured place',
  D.edge.v !== null && !D.edge.exact && D.edge.away > 0 && D.edge.away <= 100,
  JSON.stringify(D.edge));
/* A survey publishes elevation against its own datum. Positive is ground
   above it — this one is farmland beside the river, and printing its
   absolute value as a depth would sell two and a half feet of water on dry
   land. */
check('a positive reading is available to be called bank rather than depth',
  D.bank.v !== null && D.bank.v > 0, JSON.stringify(D.bank));
check('a point a survey covers but never measured says exactly that',
  D.dry.none === 'notmeasured' && D.dry.covering > 0, JSON.stringify(D.dry));
check('a point no survey covers says that instead',
  D.nowhere.none === 'nowhere', JSON.stringify(D.nowhere));

/* And the label a reader gets, with the way to keep it. */
await page.evaluate(() => showDepthAt(38.4006076, -121.5141745));
await page.waitForTimeout(4000);
const dtxt = await page.evaluate(() => {
  const n = document.querySelector('.leaflet-popup-content');
  return n ? n.textContent.replace(/\s+/g, ' ') : '';
});
check('the label carries the figure, the survey, the date and the caveat',
  /ft/.test(dtxt) && /Sacramento River/.test(dtxt) && /surveyed 2023-02-08/.test(dtxt) &&
  /Not for navigation/.test(dtxt), dtxt.slice(0, 220));
const marksBefore = await page.evaluate(() => state.marks.length);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.leaflet-popup-content button')]
    .find(x => /Keep this as a mark/.test(x.textContent));
  if (b) b.click();
});
await page.waitForTimeout(1200);
const kept = await page.evaluate(() => {
  const m = state.marks[state.marks.length - 1] || {};
  return { n: state.marks.length, depth: m.depth === undefined ? null : +Number(m.depth).toFixed(2),
           from: m.depthFrom || null, date: m.depthDate || null };
});
check('keeping it makes a mark that carries the depth and the survey date',
  kept.n === marksBefore + 1 && kept.depth !== null && kept.from && kept.date,
  JSON.stringify(kept));
/* A tap used to drop a mark silently. It reads the depth now, and the mark
   is the reader's decision rather than a side effect of looking. */
check('a tap on the map no longer drops a mark by itself',
  await page.evaluate(async () => {
    const before = state.marks.length;
    state.map.fire('click', { latlng: L.latLng(38.4006076, -121.5141745) });
    await new Promise(r => setTimeout(r, 1500));
    return state.marks.length === before;
  }));

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
