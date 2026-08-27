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
    check('phone: the map is not shown until it is asked for', !box.mapShown, JSON.stringify(box));
    check('phone: the readings get at least 40% of the screen',
      box.panel >= box.vh * 0.4, JSON.stringify(box));
    check('phone: chrome above the readings is under half the screen',
      (box.header + box.ribbon) < box.vh * 0.5, JSON.stringify(box));

    /* All rivers has no map, so it has no Map button either. */
    check('phone: All rivers offers no map button',
      await page.evaluate(() => {
        const b = document.getElementById('maptoggle');
        return !b || b.getBoundingClientRect().height === 0;
      }));

    /* And the map, once a river is picked and it is asked for, believes it
       is the size it is. */
    await page.selectOption('#riverpick', 'sacramento');
    await page.waitForTimeout(1200);
    await page.click('#maptoggle');
    await page.waitForTimeout(900);
    const mapBox = await page.evaluate(() => ({
      rect: Math.round(document.getElementById('map').getBoundingClientRect().height),
      leaflet: state.map.getSize().y }));
    check('phone: the map fills the stage and Leaflet agrees',
      mapBox.rect > 200 && Math.abs(mapBox.rect - mapBox.leaflet) < 2, JSON.stringify(mapBox));
    await page.click('#maptoggle');
    await page.waitForTimeout(400);
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
