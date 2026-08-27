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
import { chromium } from 'playwright-core';
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

async function audit(page, label) {
  await page.addScriptTag({ content: axe });
  const res = await page.evaluate(async () => await window.axe.run(document, { resultTypes: ['violations'] }));
  report(label, res.violations);
}

for (const [name, width, height] of [['desktop', 1280, 900], ['phone', 390, 844]]) {
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
               mapShown: mapEl.getBoundingClientRect().height > 0 };
    });
    check('phone: the map is not shown until its tab is chosen', !box.mapShown, JSON.stringify(box));
    check('phone: the readings get at least 40% of the screen',
      box.panel >= box.vh * 0.4, JSON.stringify(box));
    check('phone: chrome above the readings is under half the screen',
      (box.header + box.ribbon) < box.vh * 0.5, JSON.stringify(box));

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
  }

  await page.click('#aboutbtn');
  await page.waitForTimeout(500);
  await audit(page, `${name}: about panel`);
  await page.click('#aboutclose');

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
  await ctx.close();
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
