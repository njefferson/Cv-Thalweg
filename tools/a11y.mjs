/* Accessibility and offline gate.
 *
 * Every state the app can be in gets audited, not just the one it opens
 * in: the first-run dialog, each panel, the About panel, and the update
 * strip — a strip that only appears when a new version is waiting is a
 * state that ships unmeasured unless something forces it on purpose.
 * Desktop and phone, because the layout stacks under 900px.
 *
 * The offline check reloads with the network cut and asserts the app
 * still comes up, which is the only way to find out whether the service
 * worker actually precached what it claims to.
 *
 *   node tools/serve.mjs &
 *   node tools/a11y.mjs [http://127.0.0.1:8787]
 */
import { chromium, webkit, devices } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const axe = readFileSync(join(here, '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const BASE = process.argv[2] || 'http://127.0.0.1:8787';

let pass = 0, fail = 0;
function report(label, violations) {
  if (!violations.length) { pass++; console.log('PASS  ' + label); return; }
  fail++;
  console.log('FAIL  ' + label);
  for (const v of violations)
    console.log(`        [${v.impact}] ${v.id}: ${v.help} x${v.nodes.length} -> ${v.nodes[0].target.join(' ')}`);
}
function check(label, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--proxy-server=http://127.0.0.1:1', '--proxy-bypass-list=127.0.0.1;localhost;[::1]'] });

/* The first-run panel is an interrupting surface, and every one of those has
   to be leaveable: a dismiss in the first frame, one at the end as well, both
   reachable however far down the reader has scrolled, and a panel that is
   genuinely gone afterwards. This one opened scrolled to its own last line,
   because a dialog with no focus target of its own focuses the first button
   it can find and that button was Start, at the bottom of a scrolling body.
   Everything the panel existed to say was above the fold, upwards, with
   nothing to say so. */
async function welcomeChecks(page, name) {
  const open = await page.evaluate(() => {
    const d = document.getElementById('welcome'), b = document.getElementById('welcomebody');
    const c = document.getElementById('welcomeclose').getBoundingClientRect();
    const hit = document.elementFromPoint((c.left + c.right) / 2, (c.top + c.bottom) / 2);
    return { open: d.open, scroll: b.scrollTop, focus: document.activeElement && document.activeElement.id,
             closeTop: Math.round(c.top),
             closeVisible: c.width > 0 && c.height > 0 && c.top >= 0 && c.bottom <= window.innerHeight,
             hit: hit ? (hit.id || hit.tagName) : null,
             height: Math.round(d.getBoundingClientRect().height), vh: window.innerHeight,
             bottomOut: !!document.querySelector('#welcomebody .rowline button') };
  });
  check(`${name}: first run opens at the top of itself`,
    open.open && open.scroll === 0, JSON.stringify(open));
  check(`${name}: first run puts focus on its title, not the button at the end`,
    open.focus === 'welcometitle', JSON.stringify(open));
  /* Hit-testing rather than arithmetic against the viewport, because a
     rectangle inside the viewport is not the same as a rectangle nobody has
     painted over — and a ceiling written as the number zero is a claim about
     the viewport, not about what a reader can reach (hub LESSONS §174). */
  check(`${name}: first run shows a way out in the first frame`,
    open.closeVisible && open.hit === 'welcomeclose', JSON.stringify(open));
  check(`${name}: first run offers a way out at the end as well`,
    open.bottomOut, JSON.stringify(open));
  check(`${name}: first run is bounded by the screen`,
    open.height <= open.vh, JSON.stringify(open));

  /* Scrolled to the very end, the way out is still there and still the thing
     under the finger — not merely painted, but what hit-testing returns. */
  const end = await page.evaluate(() => {
    const b = document.getElementById('welcomebody');
    b.scrollTop = b.scrollHeight;
    const c = document.getElementById('welcomeclose').getBoundingClientRect();
    const hit = document.elementFromPoint((c.left + c.right) / 2, (c.top + c.bottom) / 2);
    return { visible: c.width > 0 && c.height > 0 && c.top >= 0 && c.bottom <= window.innerHeight,
             hit: hit ? (hit.id || hit.tagName) : null,
             scrolled: b.scrollTop > 0 };
  });
  check(`${name}: the way out survives scrolling to the very end`,
    end.visible && end.hit === 'welcomeclose', JSON.stringify(end));

  await page.click('#welcomeclose');
  await page.waitForTimeout(300);
  const gone = await page.evaluate(() => {
    const d = document.getElementById('welcome');
    const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    return { open: d.open, inside: !!(hit && d.contains(hit)),
             focus: document.activeElement ? document.activeElement.tagName : null };
  });
  check(`${name}: dismissing it really removes it`,
    !gone.open && !gone.inside, JSON.stringify(gone));
  check(`${name}: focus lands somewhere real afterwards`,
    gone.focus && gone.focus !== 'null', JSON.stringify(gone));
}

/* Nothing may reach past the right-hand edge of the screen. Doctrine 3 wants
   content that cannot fit to scroll INSIDE itself, never over an edge — and
   the thing that breaks it is always a row of fixed-size items in a header:
   at 200% text on a 320px screen the app name and its version chip together
   measured 400px and pushed the whole document 80px sideways. */
async function noOverflow(page, label) {
  const bad = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('body *').forEach(n => {
      const r = n.getBoundingClientRect();
      if (r.width && r.right > window.innerWidth + 1)
        out.push((n.id || n.className || n.tagName) + ' right=' + Math.round(r.right));
    });
    return { vw: window.innerWidth, scrollW: document.documentElement.scrollWidth, out: out.slice(0, 6) };
  });
  check(label, bad.out.length === 0 && bad.scrollW <= bad.vw + 1, JSON.stringify(bad));
}

async function audit(page, label) {
  await page.addScriptTag({ content: axe });
  const res = await page.evaluate(async () => await window.axe.run(document, { resultTypes: ['violations'] }));
  report(label, res.violations);
}

/* 390 by 844 is an iPhone 13's SCREEN. The page gets 390 by 664 — Safari's
   own chrome takes the other 180px, and Playwright's device registry is the
   authority on that, not a number remembered from a spec sheet. This suite
   spent its whole life measuring a phone 27% taller than the one the app is
   read on. */
for (const [name, width, height] of [['desktop', 1280, 900], ['phone', 390, 664]]) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  /* State 0: the first-run orientation, before anything is pressed. */
  await audit(page, `${name}: first run`);
  await welcomeChecks(page, name);

  /* The readings have to fit on the screen they are read on. On a 667px
     phone this app once gave its data panel thirty-four pixels: a 117px
     header, a ribbon squeezed into a viewBox four times its width, and a
     map taking 46vh whether or not anyone had asked for one. */
  if (name === 'phone') {
    await page.evaluate(() => { const d = document.getElementById('welcome'); if (d.open) d.querySelector('button').click(); });
    await page.waitForTimeout(400);
    const box = await page.evaluate(() => {
      const panel = document.querySelector('[role=tabpanel]:not([hidden])');
      const mapEl = document.getElementById('map');
      return { vh: window.innerHeight, panel: panel ? panel.clientHeight : 0,
               header: Math.round(document.querySelector('header').getBoundingClientRect().height),
               ribbon: Math.round(document.getElementById('ribbonwrap').getBoundingClientRect().height),
               tabs: Math.round(document.querySelector('[role=tablist]').getBoundingClientRect().height),
               mapShown: mapEl.getBoundingClientRect().height > 0 };
    });
    check('phone: the map is not shown until its tab is chosen', !box.mapShown, JSON.stringify(box));
    check('phone: the readings get at least 40% of the screen',
      box.panel >= box.vh * 0.4, JSON.stringify(box));
    /* This used to add the ribbon to the header and call the sum chrome. The
       ribbon is not chrome — it plots every gauge on the river coloured by
       water temperature, which is the app. What has to stay small is the
       FURNITURE: the header and the tab strip, which carry no reading at
       all. The ribbon gets its own budget below instead of being counted as
       waste. */
    check('phone: furniture above the readings is under a third of the screen',
      (box.header + box.tabs) < box.vh * 0.33, JSON.stringify(box));
    check('phone: the ribbon band stays inside its height budget',
      box.ribbon === 0 || box.ribbon <= box.vh * 0.34, JSON.stringify(box));

    /* All rivers has no map, so it offers no Map tab either. */
    check('phone: All rivers offers no Map tab',
      await page.evaluate(() => document.getElementById('tab-map').getBoundingClientRect().height === 0));

    /* With a river picked the Map tab appears, sits with the others, and
       the map believes the size it actually is. */
    await page.selectOption('#riverpick', 'sacramento');
    await page.waitForTimeout(1500);
    check('phone: picking a river adds a Map tab',
      await page.evaluate(() => document.getElementById('tab-map').getBoundingClientRect().height > 0));
    await page.click('#tab-map');
    await page.waitForTimeout(900);
    const mapBox = await page.evaluate(() => ({
      rect: Math.round(document.getElementById('map').getBoundingClientRect().height),
      leaflet: state.map.getSize().y,
      selected: document.getElementById('tab-map').getAttribute('aria-selected'),
      others: [...document.querySelectorAll('[role=tab][aria-selected=true]')].length }));
    check('phone: the map fills the stage and Leaflet agrees',
      mapBox.rect > 200 && Math.abs(mapBox.rect - mapBox.leaflet) < 2, JSON.stringify(mapBox));
    /* The map panel takes role=tabpanel here, and the panel styles that go
       with that role once inset the map eleven pixels on every side. */
    check('phone: the map is not inset by panel padding',
      await page.evaluate(() => {
        const m = document.getElementById('map').getBoundingClientRect();
        return Math.round(m.left) === 0 && Math.round(m.width) === window.innerWidth;
      }),
      await page.evaluate(() => { const m = document.getElementById('map').getBoundingClientRect();
        return Math.round(m.left) + '..' + Math.round(m.right) + ' of ' + window.innerWidth; }));
    check('phone: exactly one tab is selected, and it is Map',
      mapBox.selected === 'true' && mapBox.others === 1, JSON.stringify(mapBox));
    await audit(page, 'phone: map tab open');
    await page.click('#tab-water');
    await page.waitForTimeout(500);
    check('phone: the map goes away again when another tab is chosen',
      await page.evaluate(() => document.getElementById('map').getBoundingClientRect().height === 0));
    await page.selectOption('#riverpick', '');
    await page.waitForTimeout(1500);
  }
  await page.evaluate(() => { const d = document.getElementById('welcome'); if (d.open) d.querySelector('button').click(); });
  await page.waitForTimeout(300);

  for (const tab of ['water', 'layers', 'marks', 'brief']) {
    await page.click('#tab-' + tab);
    await page.waitForTimeout(400);
    await audit(page, `${name}: ${tab} panel`);
    await noOverflow(page, `${name}: nothing reaches past the edge on ${tab}`);
  }

  /* Closing the first-run panel returned focus to nothing, because nothing
     opened it: a keyboard or screen-reader user was left with no position in
     the app at all. BODY is not "somewhere real". */
  check(`${name}: focus after the first-run panel lands on a tab`,
    await page.evaluate(() => {
      const d = document.getElementById('welcome');
      if (!d.open) showWelcome();
      d.close();
      const a = document.activeElement;
      return !!(a && a.getAttribute && a.getAttribute('role') === 'tab');
    }));

  await page.click('#aboutbtn');
  await page.waitForTimeout(500);
  await audit(page, `${name}: about panel`);
  check(`${name}: the About panel opens at the top of itself`,
    await page.evaluate(() => document.getElementById('aboutbody').scrollTop === 0 &&
      document.activeElement.id === 'abouttitle'),
    await page.evaluate(() => document.getElementById('aboutbody').scrollTop + ' / ' +
      document.activeElement.id));

  /* Dismissing the first-run panel is remembered, so without a way back the
     only route to it is clearing storage — which makes the one surface a new
     reader sees the one surface nobody can look at twice. */
  await page.click('#aboutbody button:text-is("Show the first-visit page again")');
  await page.waitForTimeout(500);
  check(`${name}: the first-visit page can be opened again from the (i)`,
    await page.evaluate(() => document.getElementById('welcome').open &&
      !document.getElementById('about').open));
  await welcomeChecks(page, `${name}: reopened`);
  await page.click('#aboutbtn');
  await page.waitForTimeout(400);
  await page.click('#aboutclose');

  /* The seven-day section with nothing answering. A panel that renders an
     empty box when its own request fails is the shape this app exists not to
     be: a reader cannot tell an absent line from a flat one. */
  await page.selectOption('#riverpick', 'sacramento');
  await page.waitForTimeout(1500);
  await page.click('#tab-water');
  await page.waitForTimeout(600);
  const trend = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('#panel-water .sec')].map(n => n.textContent);
    const i = heads.indexOf('The last seven days');
    const sec = document.querySelector('#panel-water .sec + div');
    const txt = [...document.querySelectorAll('#panel-water p')]
      .map(n => n.textContent).filter(t => /seven days|history|Loading the last/.test(t));
    return { heading: i !== -1, said: txt.length > 0, first: (txt[0] || '').slice(0, 120) };
  });
  check(`${name}: the seven-day section is there`, trend.heading, JSON.stringify(trend));
  check(`${name}: with nothing answering it says so rather than showing an empty box`,
    trend.said, JSON.stringify(trend));
  /* And it must not turn a request that never arrived into a statement about
     the gauges. With the network cut, "no line to draw" is a claim this app
     has no basis for: an absence and a refusal are different facts. */
  check(`${name}: a refusal is never printed as an absence`,
    await page.evaluate(() => ![...document.querySelectorAll('#panel-water p')]
      .some(n => /no line to draw|publishes nothing/.test(n.textContent))),
    await page.evaluate(() => [...document.querySelectorAll('#panel-water p')]
      .map(n => n.textContent).filter(t => /no line|publishes nothing/.test(t)).join(' | ')));
  await noOverflow(page, `${name}: nothing reaches past the edge with a river picked`);

  /* Staleness is a question about AGE. A payload fetched this minute is
     current whatever the request after it did — printing "network did not
     answer" in orange over readings timestamped that minute, on a cold open
     with every request logged ok, is the failure this app exists to avoid.
     Both states are forced, because a real one takes five minutes to arrive. */
  const staleWords = () => page.evaluate(() => {
    renderWater(); updateStaleness();
    return (document.getElementById('panel-water').innerText + ' || ' +
            document.getElementById('staleness').textContent).replace(/\s+/g, ' ');
  });
  await page.evaluate(() => {
    window.__g = JSON.parse(JSON.stringify(state.gauges));
    Object.keys(state.gauges).forEach(k => {
      state.gauges[k].stale = true; state.gauges[k].noData = false;
      state.gauges[k].failed = false; state.gauges[k].fetchedAt = Date.now();
    });
  });
  const fresh = await staleWords();
  check(`${name}: a reading fetched this minute is not called stale`,
    !/network did not answer|Stored readings/.test(fresh), fresh.slice(0, 200));
  await page.evaluate(() => {
    Object.keys(state.gauges).forEach(k => {
      state.gauges[k].fetchedAt = Date.now() - 40 * 60 * 1000; });
  });
  const aged = await staleWords();
  check(`${name}: one that is forty minutes old and failed to refresh says so`,
    /network did not answer/.test(aged), aged.slice(0, 200));
  await page.evaluate(() => { state.gauges = window.__g; renderWater(); updateStaleness(); });

  /* A card whose own source did not answer said "no thermometer reporting"
     and "no flow reading", which describes a river with no instruments on it
     rather than a request that failed. The Feather's gauges are CDEC's and
     CDEC is the slowest of the four services, so this is its normal first
     few seconds. */
  const cardWords = await page.evaluate(() => {
    state.gauges.feather = { fetchedAt: Date.now(), rows: [
      { id:'GRL', declared:true, error:'request failed', flow:null, tempF:null },
      { id:'FSB', declared:true, error:'request failed', flow:null, tempF:null }
    ]};
    const before = state.riverId; state.riverId = null; renderWater(); state.riverId = before;
    return document.getElementById('panel-water').innerText.replace(/\s+/g, ' ');
  });
  check(`${name}: a river whose gauges did not answer says that, not that it has none`,
    /did not answer/.test(cardWords) && !/no thermometer reporting/.test(cardWords),
    cardWords.slice(0, 220));
  check(`${name}: and the landing warning names which rivers are stored, not all four`,
    await page.evaluate(() => {
      /* With no network every river is in a failed state here, so the other
         three are forced current: the check is that ONE old river does not
         caption the other three. */
      RIVERS.forEach(r => { state.gauges[r.id] = { fetchedAt: Date.now(),
        stale:false, noData:false, failed:false,
        rows:[{ id:'x', declared:true, flow:100, tempF:60, lat:38.4, lon:-121.5 }] }; });
      state.gauges.feather.stale = true;
      state.gauges.feather.fetchedAt = Date.now() - 40 * 60 * 1000;
      const before = state.riverId; state.riverId = null; renderWater(); state.riverId = before;
      const t = document.getElementById('panel-water').innerText;
      return /Stored readings for Feather/.test(t) && !/These are stored readings/.test(t);
    }));
  await page.evaluate(() => { state.gauges = window.__g; renderWater(); });

  /* A mark kept from a depth reading carried the figure into its map label
     and nowhere else, so the list it lives in did not know it. */
  check(`${name}: a mark carrying a depth shows it in the list`,
    await page.evaluate(() => {
      state.marks.push({ id:'t1', type:'hole', lat:38.4, lon:-121.5,
        at:new Date().toISOString(), note:'', depth:-11.89,
        depthFrom:'Sacramento River', depthDate:'2023-02-08', depthAway:0 });
      renderMarks();
      const t = document.getElementById('panel-marks').innerText;
      state.marks = state.marks.filter(m => m.id !== 't1'); renderMarks();
      return /11\.9/.test(t) && /surveyed 2023-02-08/.test(t);
    }));

  /* Depth at a point, with nothing answering. "No survey covers this point"
     is a claim about California; an app that has not been able to ask has no
     business making it. */
  await page.click('#tab-layers');
  await page.waitForTimeout(400);
  /* An exported mark kept for its depth carried none of it: the figure, the
     survey and the date all lived on the device and in nothing that left it,
     which makes the export a worse copy of the thing it exports. */
  check(`${name}: an exported mark carries the depth it was kept for`,
    await page.evaluate(() => {
      state.marks.push({ id:'x1', type:'hole', lat:38.4, lon:-121.5,
        at:new Date().toISOString(), note:'', depth:-11.89,
        depthFrom:'Sacramento River', depthDate:'2023-02-08', depthAway:0 });
      const props = marksGeoJSON().features.slice(-1)[0].properties;
      state.marks = state.marks.filter(m => m.id !== 'x1');
      return props.depth_ft === -11.89 && props.depth_survey === 'Sacramento River' &&
             props.depth_surveyed === '2023-02-08' && /datum/.test(props.depth_is || '');
    }),
    await page.evaluate(() => JSON.stringify(marksGeoJSON().features.slice(-1)[0] || {}).slice(0, 200)));
  /* And a mark with no depth must not grow empty depth keys. */
  check(`${name}: a mark with no depth exports no depth keys`,
    await page.evaluate(() => {
      state.marks.push({ id:'x2', type:'ramp', lat:38.4, lon:-121.5,
        at:new Date().toISOString(), note:'' });
      const props = marksGeoJSON().features.slice(-1)[0].properties;
      state.marks = state.marks.filter(m => m.id !== 'x2');
      return !Object.keys(props).some(k => /^depth/.test(k));
    }));

  /* DWR's names are machine names and this list is where a reader chooses
     between twenty of them. The readable name is on the control; the machine
     name stays under it so what is on screen matches the catalogue. */
  check(`${name}: the layer list gives readable names and keeps the machine ones`,
    await page.evaluate(() => {
      const t = document.getElementById('panel-layers').innerText;
      if (!/Bathy_NCRO_/.test(t)) return true;          /* catalogue not loaded */
      return /Sacramento River|Grizzly Bay|Rio Vista/.test(t) &&
             /Bathy_NCRO_\d{8}_/.test(t);
    }),
    await page.evaluate(() => document.getElementById('panel-layers').innerText.slice(0, 160)));
  check(`${name}: the depth-at-a-point control is offered without a pointer`,
    await page.evaluate(() => [...document.querySelectorAll('#panel-layers button')]
      .some(b => /Read the depth at the map centre/.test(b.textContent))));
  /* The local dev server proxies /bathy upstream, so DWR is reachable here
     even with the browser's own egress cut — which is the production shape
     too. The no-catalogue state is therefore forced rather than waited for:
     it is real (the first seconds of a cold start, or the directory
     failing) and it is the one where a wrong answer is a claim about
     California made by an app that has not asked. */
  const popText = () => page.evaluate(() => {
    const n = document.querySelector('.leaflet-popup-content');
    return n ? n.textContent.replace(/\s+/g, ' ') : '';
  });
  const held = await page.evaluate(() => { const c = state.catalog; state.catalog = null; return !!c; });
  await page.evaluate(() => showDepthAt(38.4006076, -121.5141745));
  await page.waitForTimeout(700);
  const blind = await popText();
  check(`${name}: a depth reading with no catalogue says it has not asked`,
    /has not arrived|cannot be answered yet/.test(blind) &&
    !/No published survey covers/.test(blind), blind.slice(0, 160));
  await page.evaluate(() => { const b = document.querySelector('.leaflet-popup-close-button'); if (b) b.click(); });
  await page.evaluate(() => { state.catalog = null; });
  await page.evaluate(() => loadCatalog());
  await page.waitForTimeout(2500);
  check(`${name}: the catalogue came back`, held);
  await page.evaluate(() => showDepthAt(38.4006076, -121.5141745));
  await page.waitForTimeout(2500);
  const depth = await popText();
  check(`${name}: a depth reading names its survey and its caveat`,
    /ft/.test(depth) && /surveyed \d{4}-\d{2}-\d{2}/.test(depth) &&
    /Not for navigation/.test(depth), depth.slice(0, 200));
  await audit(page, `${name}: depth label open`);
  await page.evaluate(() => { const b = document.querySelector('.leaflet-popup-close-button'); if (b) b.click(); });
  await page.click('#tab-water');
  await page.waitForTimeout(300);
  await page.selectOption('#riverpick', '');
  await page.waitForTimeout(800);

  /* A map label. It exists only while a pin is tapped, so like the update
     strip below it is a state that ships unmeasured unless something opens
     it on purpose. */
  /* A dropped mark, rather than a gauge, so this runs with no network:
     the popup chrome being measured is the same one. */
  /* Dropping a mark needs a river: the app opens on All, where a mark has
     nowhere to belong. */
  await page.selectOption('#riverpick', 'sacramento');
  await page.waitForTimeout(800);
  await page.click('#tab-marks');
  await page.waitForTimeout(300);
  await page.click('#panel-marks button:text-is("Add at map centre")');
  await page.waitForTimeout(500);
  const opened = await page.evaluate(() => {
    const layers = state.markLayer ? state.markLayer.getLayers() : [];
    if (!layers.length) return false;
    layers[layers.length - 1].openPopup();
    return true;
  });
  await page.waitForTimeout(600);
  check(`${name}: a tapped pin opens a label`, opened);
  if (opened) await audit(page, `${name}: map label open`);
  await page.evaluate(() => { const b = document.querySelector('.leaflet-popup-close-button'); if (b) b.click(); });

  /* The update strip. It only shows when a new version is waiting, which
     is exactly why it has to be forced on to be measured at all. */
  await page.evaluate(() => {
    const s = document.getElementById('updatestrip');
    s.hidden = false;
    document.getElementById('updatetext').textContent =
      'A new version of Thalweg is ready. It is waiting — nothing has changed under you.';
  });
  await page.waitForTimeout(200);
  await audit(page, `${name}: update strip showing`);

  check(`${name}: no page errors`, errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* The phones, by their real geometry.
 *
 * WebKit itself is not installable here — the Playwright download host is
 * refused by this network's policy — so these are Chromium at Safari's
 * measurements, which settles every question of GEOMETRY and no question of
 * engine behaviour. The two are different things and were run together once:
 * the first-run panel opened at its last line only under WebKit's focus
 * rules, and no viewport size would have shown it.
 *
 * The keyboard case is the one that catches things nothing else does. iOS
 * shrinks the visual viewport by roughly three hundred points when the
 * software keyboard comes up, and a panel whose way out sits at the bottom
 * of a scrolling body is then a panel with no way out at all.
 */
for (const [label, width, height] of [
  ['iPhone 13', 390, 664],
  ['iPhone SE', 320, 568],
  ['iPhone 13 with the keyboard up', 390, 364]
]) {
  const ctx = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  await welcomeChecks(page, label);
  await noOverflow(page, `${label}: nothing reaches past the edge`);

  const box = await page.evaluate(() => {
    const panel = document.querySelector('[role=tabpanel]:not([hidden])');
    return { vh: window.innerHeight,
             panel: panel ? panel.clientHeight : 0,
             header: Math.round(document.querySelector('header').getBoundingClientRect().height),
             ribbon: Math.round(document.getElementById('ribbonwrap').getBoundingClientRect().height),
             tabs: Math.round(document.querySelector('[role=tablist]').getBoundingClientRect().height) };
  });
  /* Under a keyboard there is almost nothing left, so what is asserted there
     is that something is left, not that it is comfortable. */
  const floor = height < 400 ? 0.15 : 0.35;
  check(`${label}: the readings keep at least ${Math.round(floor*100)}% of the screen`,
    box.panel >= box.vh * floor, JSON.stringify(box));
  /* Under a keyboard the screen is 364px and the header still carries a
     notice that has to be visible at all times, so a third is not a
     reachable bar there. What has to hold instead is the thing the bar was
     a proxy for: the readings still beat the furniture. */
  if (height < 400)
    check(`${label}: the readings still outweigh the furniture`,
      box.panel > box.header + box.tabs, JSON.stringify(box));
  else
    check(`${label}: furniture above the readings is under a third of the screen`,
      (box.header + box.tabs) < box.vh * 0.33, JSON.stringify(box));
  /* Width was fixed once and height never was, so four rows of ribbon took
     263px on every screen — 46% of an iPhone SE and 72% of the same phone
     with its keyboard up. It is hidden rather than drawn illegibly when even
     the floor will not fit. */
  check(`${label}: the ribbon band stays inside its height budget`,
    box.ribbon === 0 || box.ribbon <= box.vh * 0.34, JSON.stringify(box));
  /* And when it is dropped it says so. A view that vanishes without a word
     is indistinguishable from one that failed to load. */
  check(`${label}: a dropped ribbon is announced rather than just missing`,
    await page.evaluate(() => document.getElementById('ribbonwrap').hidden === false ||
      [...document.querySelectorAll('#panel-water .note')]
        .some(n => /river ribbon is not shown/i.test(n.textContent))));

  await page.selectOption('#riverpick', 'sacramento');
  await page.waitForTimeout(1800);
  await page.click('#tab-water');
  await page.waitForTimeout(600);
  await noOverflow(page, `${label}: nothing reaches past the edge with a river picked`);
  check(`${label}: the seven-day section is reachable`,
    await page.evaluate(() => [...document.querySelectorAll('#panel-water .sec')]
      .some(n => n.textContent === 'The last seven days')));
  check(`${label}: no page errors`, errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* Small phone at 200% text, which is where a panel stops fitting and its way
   out goes over the edge. Only the dismiss rules are measured here; the rest
   of the suite has already run at two ordinary sizes. */
{
  const ctx = await browser.newContext({ viewport: { width: 320, height: 568 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.fontSize = '32px';
    });
  });
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await welcomeChecks(page, 'small phone at 200% text');
  await noOverflow(page, 'small phone at 200% text: nothing reaches past the edge');
  await ctx.close();
}

/* WebKit, because two engines answer differently and this app is read in the
 * one the rest of this suite does not drive.
 *
 * The first-run panel opened at its own last line and every Chromium check
 * was green: Chromium makes a scrollable region focusable in its own right
 * and lands on the panel body at scroll zero, so the defect is invisible
 * there. Planting the original markup back and running it HERE puts the
 * focus on the Start button, the body at scrollTop 813 of a maximum 813, and
 * the panel's first paragraph 667 pixels above the top of the screen.
 *
 * It is SKIPPED with the reason printed rather than failed when WebKit is not
 * installed: whether a browser is on this machine is not a fact about the
 * tree, and a gate that goes red for how somebody's container was configured
 * teaches people to ignore red.
 */
{
  let wk = null;
  try { wk = await webkit.launch(); }
  catch (e) {
    console.log('SKIP  WebKit pass — ' + String(e && e.message || e).split('\n')[0]);
    console.log('      npx playwright install webkit && npx playwright install-deps webkit');
  }
  if (wk) {
    const ctx = await wk.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    /* WebKit raises a blocked cross-origin fetch as a PAGE ERROR; Chromium
       does not. This sandbox gives the browser no egress, so every NOAA and
       USGS request fails here — which is a fact about the container, not
       about the app, and a gate that reddens for how somebody's network was
       configured teaches people to ignore red. Real exceptions still fail. */
    const errs = [];
    page.on('pageerror', e => {
      if (/access control checks|Load failed|Failed to fetch|NetworkError/i.test(e.message)) return;
      errs.push(e.message);
    });
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    await welcomeChecks(page, 'WebKit, iPhone 13');
    await noOverflow(page, 'WebKit, iPhone 13: nothing reaches past the edge');
    check('WebKit, iPhone 13: no page errors', errs.length === 0, errs.join(' | '));
    await ctx.close();
    await wk.close();
  }
}

/* Offline. */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(2000);
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);
  check('offline: the app opens', (await page.title()).includes('Thalweg'));
  check('offline: Leaflet came from the cache', await page.evaluate(() => typeof window.L === 'object'));
  check('offline: the ribbon still draws', (await page.textContent('#ribbonnote')).length > 20);
  check('offline: the Brief still reads',
    await page.evaluate(() => { document.getElementById('tab-brief').click();
      return document.getElementById('panel-brief').textContent.length > 400; }));
  await ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
