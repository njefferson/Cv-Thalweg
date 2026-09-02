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
import { chromiumLaunch, OFFLINE_ARGS } from './lib-browser.mjs';
import { spawnSync } from 'node:child_process';

/* THE FIFTH TOOL IN THIS REPO TO NEED THESE THREE LINES (hub LESSONS 173).
   Node's own fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY is set, and
   it reads it at STARTUP — so the relay below went direct, every request came
   back refused, and the whole suite reported the public agencies as down. It
   is a harder trap here than in the bakes, because this is the one suite whose
   job is to talk to real services: a red run looks exactly like the thing it
   is built to detect. */
if (!process.env.NODE_USE_ENV_PROXY &&
    (process.env.HTTPS_PROXY || process.env.https_proxy)) {
  const r = spawnSync(process.execPath, [import.meta.filename, ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(r.status === null ? 1 : r.status);
}
const BASE = process.argv[2] || 'http://127.0.0.1:8787';

let pass = 0, fail = 0;
const check = (n, c, d) => c ? (pass++, console.log('PASS  ' + n))
                             : (fail++, console.log('FAIL  ' + n + (d ? ' — ' + String(d).slice(0, 300) : '')));

const browser = await chromium.launch({
  ...chromiumLaunch({ args: OFFLINE_ARGS })
});
/* Service workers are blocked: a worker's own fetch does not pass through
   a page route, so with one installed the relay would never see the
   request. The service worker and offline behaviour are tools/a11y.mjs. */
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, serviceWorkers: 'block' });

const relayed = { ok: 0, fail: 0, hosts: new Set(), refused: new Set(), bytes: 0, boot: 0 };

/* Wait for the STATE, not for a number of seconds.
 *
 * A fixed wait is an assertion that the network is as fast as the machine it
 * was written on. `the Mokelumne has no published history and says so` went
 * red on a runner for exactly that: state.trends.mokelumne was still
 * undefined, every field read false, and the check reported an absence that
 * had not been established — which is the same defect this app was fixed for
 * twice over, in the suite that checks it. */
async function waitFor(page, fn, what, ms = 45000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await page.evaluate(fn)) return true;
    await page.waitForTimeout(500);
  }
  console.log('        (gave up waiting for ' + what + ' after ' + (ms / 1000) + 's)');
  return false;
}
await ctx.route(url => !url.hostname.startsWith('127.0.0.1') && url.hostname !== 'localhost',
  async route => {
    const req = route.request();
    try {
      const res = await fetch(req.url(), { method: req.method(), redirect: 'follow' });
      const body = Buffer.from(await res.arrayBuffer());
      /* A REFUSAL IS NOT AN ANSWER, AND COUNTING IT AS ONE IS HOW A BLOCKED
         RUN COMES TO READ AS AN OUTAGE. The relay used to fulfil any HTTP
         response and increment `ok`, so a container whose egress refuses
         everything with a 403 produced a suite reporting that USGS, NOAA, DWR
         and CDEC were all down at once — which is not a thing that happens,
         and was the one clue that the failure was local. Three states look
         identical from inside: the service said no, the egress said no, and
         the request never left. This tells the first two apart by NAME, so
         the run says what to ask for rather than what to disbelieve.
         The body is still passed through: the app's own handling of a bad
         status is worth exercising, and hiding it would be a second lie. */
      if (res.status === 403 || res.status === 407) {
        relayed.refused.add(new URL(req.url()).hostname);
        console.log('  REFUSED ' + res.status + ' ' + req.url().slice(0, 110) +
          ' — that is an egress or gateway refusal, not the service saying no.');
      }
      relayed.ok++; relayed.hosts.add(new URL(req.url()).hostname);
      relayed.bytes += body.length;
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
/* What a first-time reader pays to see the landing screen, in bytes off the
   network, measured rather than estimated. It was 5.56MB: four of that was
   NOAA's whole station index, fetched once per tidal river to learn the
   position of stations this app already names, and most of the rest was four
   basin-wide gauge sweeps for a screen built from named gauges. This number
   is the guard on both. */
relayed.boot = relayed.bytes;
/* This is also what holds the sweep down: four basin sweeps on a cold open
   was 936KB of the 5.56MB a first-time reader used to pay. */
check('the landing costs a first-time reader under 1MB off the network',
  relayed.boot < 1024 * 1024,
  (relayed.boot / 1024 / 1024).toFixed(2) + 'MB in ' + relayed.ok + ' requests');
await page.evaluate(() => { const d = document.getElementById('welcome'); if (d && d.open) d.querySelector('button').click(); });
await page.waitForTimeout(3000);

/* ---- the landing: one card per river, no map ---- */
let water = (await page.textContent('#panel-water')).replace(/\s+/g, ' ');
/* THE FOUR RIVERS, AND THE DELTA SEPARATELY. The Delta is an entry but not a
   river — it is where the four arrive — so it has its own card outside the
   grid, and holding it to "a temperature and a flow" would be asking a place
   to answer like a reach. Its own checks are below. */
const cards = await page.evaluate(() => [...document.querySelectorAll('.rivercard:not(.networkcard)')]
  .map(c => c.textContent.replace(/\s+/g, ' ').trim()));
const deltaCards = await page.evaluate(() => [...document.querySelectorAll('.networkcard')]
  .map(c => c.textContent.replace(/\s+/g, ' ').trim()));
check('a card for every river', cards.length === 4, JSON.stringify(cards.length));
check('and one for the Delta, which is not one of them', deltaCards.length === 1,
  JSON.stringify(deltaCards.length));
check('the Delta card names itself', /Delta/.test(deltaCards[0] || ''),
  (deltaCards[0] || '').slice(0, 120));
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
/* THE MARK, NOT THE WORDING. This asked for the string "tide predicted to ",
   which the app has not produced since the station's name was taken out of
   that caption — it read "tide to SACRAMENTO, SACRAMENTO RIVER" and parsed as
   nowhere. The check kept passing in the only place it runs and then failed
   here for a change that had nothing to do with it. A gate that keys on copy
   pins the copy; this asks whether the tidal limit is MARKED, which is the
   thing the caption exists to point at. */
check('the tidal limit is marked on the ribbon, with words pointing at the mark',
  await page.evaluate(() => {
    const rules = document.querySelectorAll('#ribbon line[stroke-dasharray]').length;
    const said = [...document.querySelectorAll('#ribbon text')]
      .some(t => /tide/i.test(t.textContent));
    return rules >= 1 && said;
  }),
  await page.evaluate(() => JSON.stringify({
    rules: document.querySelectorAll('#ribbon line[stroke-dasharray]').length,
    texts: [...document.querySelectorAll('#ribbon text')]
      .map(t => t.textContent).filter(t => /tide/i.test(t)) })));

/* ---- tide ---- */
check('gauges are marked on the map',
  await page.evaluate(() => state.gaugeLayer.getLayers().length) >= 6,
  await page.evaluate(() => state.gaugeLayer.getLayers().length));
check('a tide curve was drawn', await page.evaluate(() => !!document.querySelector('#tidechart path')));
/* THE TIDE IS ITS OWN PANEL from 2.13.0; Water keeps the gauges, the weirs and
   the week. Read where it lives. */
const tideWords = (await page.textContent('#panel-tide')).replace(/\s+/g, ' ');
check('highs and lows listed', /High ·|Low ·/.test(tideWords), tideWords.slice(0, 300));

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
await waitFor(page, () => !!state.trends.american, 'the American trend to resolve');
await page.waitForTimeout(1500);
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
await waitFor(page, () => !!state.trends.sacramento, 'the Sacramento trend to resolve');
await page.waitForTimeout(1500);
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
const mokReady = await waitFor(page, () => !!state.trends.mokelumne,
  'the Mokelumne trend to resolve');
check('the Mokelumne trend request finished at all', mokReady);
await page.waitForTimeout(1500);
const mok = await page.evaluate(() => {
  const t = state.trends.mokelumne;
  return { flow: !!(t && t.flow), temp: !!(t && t.temp),
           noHistory: (t && t.noHistory) || [],
           said: [...document.querySelectorAll('#panel-water p')]
             .some(n => /no line to draw/.test(n.textContent)) };
});
check('the Mokelumne has no published history and says so',
  !mok.flow && !mok.temp && mok.noHistory.length > 0 && mok.said, JSON.stringify(mok));

/* ---- the basin sweep is asked for, not suffered ---- */
/* Measured before it was demoted: across all four rivers the sweep found four
   gauges, every one on the Sacramento, and returned NOTHING on the Feather,
   the American and the Mokelumne — three 234KB requests for nothing, on every
   visit. Those four are declared now. What the sweep is still for is a gauge
   that appears later, which is why it stays at all. */
await page.selectOption('#riverpick', 'sacramento');
await page.waitForTimeout(20000);
const sweep = await page.evaluate(() => ({
  bbox: (state.net || []).filter(n => /bBox/.test(n.label || '')).length,
  promoted: ['11447890', '11447905', '11455095', '381427121305401'].map(id => {
    const r = (state.gauges.sacramento?.rows || []).find(x => x.id === id);
    return r ? r.status + (typeof r.flow === 'number' ? ':has-flow' : ':no-flow') : 'ABSENT';
  }),
  offered: [...document.querySelectorAll('#panel-water button')]
    .some(b => /has not named/.test(b.textContent))
}));
check('the four gauges the sweep used to find are declared and verified',
  sweep.promoted.every(p => p === 'verified:has-flow'), JSON.stringify(sweep.promoted));
check('and the sweep is offered rather than run',
  sweep.offered, JSON.stringify({ offered: sweep.offered }));

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
/* NOAA's per-station record spells these in capitals where its whole-index
   file used title case. The app prints the name the service gives it, the
   same rule its USGS gauge names follow, so the case is theirs and this asks
   case-insensitively rather than the app being made to tidy their data. */
check('the Mokelumne has a tide station', /new hope bridge|terminous/i.test(water), water.slice(0, 300));
check('the Mokelumne gauges report', /MOKELUMNE/i.test(water), water.slice(0, 400));

await page.selectOption('#riverpick', 'sacramento');
await page.waitForTimeout(6000);
await page.screenshot({ path: '/tmp/live-final.png' });

/* --- TWO INDEPENDENT PATHS MADE TO CLOSE ----------------------------------
   The spring–neap section measures the swing in NOAA's published predictions
   for a real station and knows nothing about where the moon is. The moon is
   arithmetic about the sky and knows nothing about NOAA. The big tides follow
   the new and the full by a day or two, so the biggest day in the window has
   to land near one of them.

   IT IS HERE AND NOT IN THE RENDERING SUITE because that one runs against a
   stubbed tide whose envelope was written by hand: its phase has no
   relationship to the real moon, and making it agree would mean tuning the
   fixture to the code, which is exactly what an independent check must not do.
   (Hub LESSONS §203.) */
const syzygy = await page.evaluate(async () => {
  const river = RIVERS.filter(r => r.tidal)[0];
  if (!river) return null;
  selectRiver(river.id);
  await new Promise(r => setTimeout(r, 6000));
  const sn = springNeap(river);
  if (!sn || !sn.biggest) return { noWindow: true };
  const big = new Date(sn.biggest.day + 'T12:00:00');
  const nearest = [0, 180].map(target => {
    let t = new Date(big.getTime() - 20 * 86400000), best = Infinity;
    for (let i = 0; i < 3; i++) {
      const e = nextMoonEvent(t, target);
      if (!e) break;
      best = Math.min(best, Math.abs(e - big) / 86400000);
      t = new Date(e.getTime() + 86400000 * 2);
    }
    return best;
  });
  return { river: river.name, biggest: sn.biggest.day, days: Math.min(...nearest) };
});
/* Three and a half days is generous on purpose: the lag between syzygy and the
   spring tide is a real physical delay that varies by station, and this water
   is a long way up a river. What it refuses is a moon that has come unstuck
   from the tide altogether. */
check('the biggest tide NOAA predicts falls near a new or a full moon',
  syzygy && !syzygy.noWindow && syzygy.days <= 3.5,
  JSON.stringify(syzygy));

/* --- LOOKING UP AN ADDRESS, against the real geocoder ---------------------
   This is the only thing in the app that sends what somebody TYPED anywhere,
   so it is proved end to end rather than against a stub: through this site's
   own proxy — the Census geocoder sends no CORS header, so a page cannot
   reach it any other way — to the real service and back as a position.

   The address is a public building, deliberately. Nothing about a person is
   typed into a test that runs on every push. */
{
  await page.evaluate(() => { setAddressOn(true); });
  const got = await page.evaluate(async () => {
    const url = geocodeUrl('1315 10th St, Sacramento, CA');
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return { status: res.status };
    const hits = readMatches(await res.json());
    return { status: res.status, n: hits.length, first: hits[0] || null,
             cache: res.headers.get('cache-control') };
  });
  check('the address lookup reaches the geocoder through this site',
    got.status === 200, JSON.stringify(got));
  check('and a real street address comes back as a position',
    got.n >= 1 && got.first && Math.abs(got.first.lat - 38.58) < 0.1 &&
    Math.abs(got.first.lon + 121.49) < 0.1,
    JSON.stringify(got.first));
  check('and the address it matched is named back, not just plotted',
    got.first && /10TH ST/i.test(got.first.name), JSON.stringify(got.first));
  /* A TYPED ADDRESS MUST NOT SIT IN AN EDGE CACHE. Every other thing this
     proxy forwards is a question about a river; this one is usually where
     somebody lives, and no-store is the rule that keeps it out. */
  check('and nothing along the way is allowed to keep it',
    /no-store/.test(got.cache || ''), got.cache);
  await page.evaluate(() => { setAddressOn(false); });
}

check('no page errors anywhere', errs.length === 0, errs.join(' | '));
console.log(`\nlanding cost ${(relayed.boot / 1024).toFixed(0)}KB; whole run ` +
  `${(relayed.bytes / 1024 / 1024).toFixed(1)}MB`);
console.log(`relayed ${relayed.ok} live responses from ${[...relayed.hosts].join(', ')}` +
  (relayed.fail ? `, ${relayed.fail} failed` : ''));
/* AND SAY IT AGAIN AT THE END, BY NAME. A refusal printed a thousand lines up
   is a refusal nobody reads, and the failures underneath it read as findings
   about the app. Naming the hosts is what turns a red run into a question
   somebody can act on in one step rather than an afternoon of disbelief. */
if (relayed.refused.size) {
  console.log(`\n${relayed.refused.size} host(s) REFUSED this run rather than answering it:`);
  [...relayed.refused].forEach(h => console.log('  ' + h));
  console.log('A 403 or 407 from a gateway is a fact about where this ran and');
  console.log('nothing whatever about the service or the app. Every failure below');
  console.log('that depends on one of these hosts says nothing until they are reachable.');
}
console.log(`${pass} passed, ${fail} failed.`);
await browser.close();
process.exit(fail ? 1 : 0);
