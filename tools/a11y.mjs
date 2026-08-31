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
import { chromiumLaunch, OFFLINE_ARGS } from './lib-browser.mjs';
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
/* KEPT SO THE END OF THE LOG CARRIES THEM. 190 lines of PASS scroll a handful
 * of FAILs far enough up that reading the tail of a CI log — which is what a
 * log-fetching tool gives you — shows only the runner cleaning up. Diagnosing
 * a red run then costs a round trip per guess. The summary repeats them. */
const failures = [];
function check(label, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + label); }
  else {
    fail++;
    console.log('FAIL  ' + label + (detail ? ' — ' + detail : ''));
    failures.push(label + (detail ? ' — ' + detail : ''));
  }
}

const browser = await chromium.launch({ ...chromiumLaunch({ args: OFFLINE_ARGS }) });

/* The first-run panel is an interrupting surface, and every one of those has
   to be leaveable: a dismiss in the first frame, one at the end as well, both
   reachable however far down the reader has scrolled, and a panel that is
   genuinely gone afterwards. This one opened scrolled to its own last line,
   because a dialog with no focus target of its own focuses the first button
   it can find and that button was Start, at the bottom of a scrolling body.
   Everything the panel existed to say was above the fold, upwards, with
   nothing to say so. */
/* IT DID NOT FIT ITS OWN FRAME — reported from a real phone by somebody meeting
   the app for the first time. The dialog had no height of its own; only its
   body did, so head plus body plus borders ran off the bottom. Nothing here
   measured the dialog's own box against the screen, which is why it shipped. */
async function dialogFits(page, id, label) {
  const m = await page.evaluate(sel => {
    const d = document.getElementById(sel);
    if (!d || !d.open) return null;
    const r = d.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom),
             h: Math.round(r.height), vh: window.innerHeight,
             left: Math.round(r.left), right: Math.round(r.right),
             vw: window.innerWidth };
  }, id);
  check(`${label}: it fits on the screen it opened on`,
    !!m && m.top >= -1 && m.bottom <= m.vh + 1 && m.left >= -1 && m.right <= m.vw + 1,
    JSON.stringify(m));
}

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
  await dialogFits(page, 'welcome', `${name}: first run`);
  /* A WALL OF TEXT AND A START BUTTON. The install offer sat mid-scroll and a
     first-time reader heading for the button went straight past it, and so did
     the one line saying where everything had gone. Both must come AFTER the
     last heading a scroller passes — which means below the Start button's own
     position in the document is wrong, and above it by a little is right. */
  const order = await page.evaluate(() => {
    const b = document.getElementById('welcomebody');
    const txt = b.textContent;
    const inst = b.querySelector('.installbox');
    const start = [...b.querySelectorAll('button')].find(x => /start/i.test(x.textContent));
    if (!inst || !start) return { inst: !!inst, start: !!start };
    return { inst: true, start: true,
      instBeforeStart: inst.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false,
      instLate: inst.offsetTop > b.scrollHeight * 0.5,
      pointsAtI: /under the \(i\) button/.test(txt) };
  });
  check(`${name}: the install offer is the last thing before Start`,
    order.inst && order.start && order.instBeforeStart && order.instLate,
    JSON.stringify(order));
  check(`${name}: it says where everything it just showed you has gone`,
    order.pointsAtI, JSON.stringify(order));
  /* A CLAIM WITH A DATE ON IT. The welcome said "this is the first release"
     from 0.1.0 to 1.0.0, which stopped being true fifteen releases before
     anybody noticed. A sentence about which release this is has to come from
     the release, or not be said. */
  check(`${name}: the first-run page does not claim to be the first release`,
    await page.evaluate(() => !/first release/i.test(document.getElementById('welcomebody').textContent)),
    await page.evaluate(() => {
      const t = document.getElementById('welcomebody').textContent;
      const i = t.search(/first release/i);
      return i === -1 ? 'clean' : t.slice(Math.max(0, i - 60), i + 80);
    }));
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
/* THE RANGE THIS IS ACTUALLY READ ON, rather than two widths a session picked.
 * Phones portrait and landscape, iPads in BOTH orientations — which matters
 * more here than anywhere, because every iPad in portrait is 744–834px and
 * lands on the narrow side of the 901px breakpoint while every iPad in
 * landscape lands on the wide side, so one device gets both layouts — and the
 * laptop and desktop widths above that.
 *
 * The heaviest checks run on two of these; the rest get the geometry pass,
 * which is what a layout defect shows up in. */
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
    /* THE DOOR WAS LABELLED WRONG. Four separate askings of "where is the
       depth" all ended at a tab called Layers — a mapping term for a panel
       that is entirely about the bottom. */
    check('phone: the depth tab is called what is behind it',
      await page.evaluate(() => document.getElementById('tab-layers').textContent.trim()) === 'Depth',
      await page.evaluate(() => document.getElementById('tab-layers').textContent.trim()));
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
    /* THE LOCATE CONTROL IS A SURFACE, so it joins this gate in the commit
       that adds it (hub LESSONS 28). On a phone it is the one control in this
       app that sits on the map itself rather than in a panel, which is exactly
       the geometry a11y checks miss: it can be off-screen, under the
       attribution, or too small for the hand that takes it. */
    const here = await page.evaluate(() => {
      const b = document.getElementById('herebtn');
      if (!b) return { there: false };
      const r = b.getBoundingClientRect();
      const m = document.getElementById('map').getBoundingClientRect();
      const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      return { there: true, w: Math.round(r.width), h: Math.round(r.height),
               inside: r.top >= m.top - 1 && r.bottom <= m.bottom + 1 &&
                       r.left >= m.left - 1 && r.right <= m.right + 1,
               onTop: !!(hit && (hit === b || b.contains(hit))),
               name: (b.textContent || '').trim(),
               disabled: b.disabled };
    });
    check('phone: the locate control is on the map and fully in view',
      here.there && here.inside, JSON.stringify(here));
    /* 44 by 44, because this app is read one-handed on a riverbank. Leaflet's
       own controls are 30px and that is the floor this must not inherit. */
    check('phone: a thumb can hit the locate control',
      here.w >= 44 && here.h >= 44, JSON.stringify(here));
    /* Painted is not reachable. The attribution and the zoom control share
       these corners, and a control underneath another one takes no taps. */
    check('phone: nothing is sitting on top of the locate control',
      here.onTop, JSON.stringify(here));
    /* SC 2.5.3: the accessible name has to contain the visible words, and an
       aria-label that merely overlaps passes a substring check by accident
       (hub LESSONS 29) — so this asserts the button has no aria-label at all
       and is named by the text a reader can actually see. */
    check('phone: the locate control is named by its own visible words',
      /where i am/i.test(here.name) &&
      await page.evaluate(() => !document.getElementById('herebtn').hasAttribute('aria-label')),
      JSON.stringify(here));
    /* It is a real button, so the keyboard reaches it without a second route
       being built for the pointerless hand. */
    check('phone: the locate control takes the keyboard',
      await page.evaluate(() => {
        const b = document.getElementById('herebtn');
        b.focus();
        return document.activeElement === b && b.tabIndex >= 0;
      }));
    /* HOME IS A HEADER CONTROL ON THE TIGHTEST SCREEN THERE IS. The header
       already lost a fight at this width once — the (i) got pushed onto a line
       of its own, away from the controls it belongs with — so adding a button
       to it is measured, not assumed. */
    const home = await page.evaluate(() => {
      const b = document.getElementById('homebtn');
      if (!b || b.hidden) return { shown: false };
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      return { shown: true, w: Math.round(r.width), h: Math.round(r.height),
               inView: r.right <= window.innerWidth + 1 && r.left >= -1,
               onTop: !!(hit && (hit === b || b.contains(hit))),
               name: (b.textContent || '').trim(),
               label: b.getAttribute('aria-label') || '' };
    });
    check('phone: Home is offered inside a river and is fully on screen',
      home.shown && home.inView, JSON.stringify(home));
    check('phone: nothing is sitting on top of Home', home.onTop, JSON.stringify(home));
    /* SC 2.5.3 — the accessible name must contain the visible words, and an
       aria-label that merely overlaps passes a substring check by accident
       (hub LESSONS 29). This asserts containment, not overlap. */
    check('phone: Home\u2019s accessible name contains the word on its face',
      home.label.toLowerCase().includes(home.name.toLowerCase()) && /home/i.test(home.name),
      JSON.stringify(home));
    /* THE KEY IS A SURFACE and joins this gate in the commit that adds it. On a
       phone it defaults to a chip rather than the full list, because the map is
       small — so what must hold here is that the chip is findable and reaches
       the list, not that the list is showing. */
    const key = await page.evaluate(() => {
      const chip = document.getElementById('keyopen');
      const d = document.getElementById('maplegend');
      const r = (chip || d).getBoundingClientRect();
      const map = document.getElementById('map').getBoundingClientRect();
      return { chip: !!chip, name: chip ? chip.textContent.trim() : '',
               w: Math.round(r.width), h: Math.round(r.height),
               inView: r.right <= map.right + 1 && r.top >= map.top - 1 };
    });
    check('phone: the key is offered as a labelled chip, on the map',
      key.chip && /key/i.test(key.name) && key.inView, JSON.stringify(key));
    /* WHAT IS ASSERTED IS THE INVARIANT, NOT A PARTICULAR ROW. This suite runs
       offline against a local server, so the gauges have not answered and there
       are no gauge dots to explain — demanding a gauge row here would put a
       state agency's uptime inside this suite's verdict, which is the defect
       LESSONS 185 is about. What must hold is that the key names everything
       drawn and nothing that is not. The tide stations are the offline case:
       they come from the baked file and are always there. */
    const opened = await page.evaluate(() => {
      document.getElementById('keyopen').click();
      const rows = [...document.querySelectorAll('#maplegend .keyrow')].map(r => r.textContent.trim());
      const drawn = {
        gauge: state.gaugeLayer.getLayers().length > 0,
        tide:  state.tideLayer.getLayers().length > 0,
        here:  state.hereLayer.getLayers().length > 0
      };
      return { rows, drawn,
        claims: {
          gauge: rows.some(r => /gauge/i.test(r)),
          tide:  rows.some(r => /tide station/i.test(r)),
          here:  rows.some(r => /^You\b/.test(r))
        } };
    });
    check('phone: opening it says what the dots on the map are',
      opened.rows.length > 0 && opened.claims.tide && opened.drawn.tide,
      JSON.stringify(opened));
    check('phone: the key names everything drawn and nothing that is not',
      ['gauge', 'tide', 'here'].every(k => opened.claims[k] === opened.drawn[k]),
      JSON.stringify(opened));
    await audit(page, 'phone: map key open');
    await page.evaluate(() => {
      const b = document.querySelector('#maplegend .keyhead button');
      if (b) b.click();
    });
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

  /* ---- THE COMPARE VIEW ON A WIDE SCREEN ----
   *
   * This app was built phone-first and every geometry here was a phone or a
   * desktop asked only whether anything overflowed. Nothing asked whether the
   * result was COHERENT, and it was not: `main` is a flex row of the map and
   * then the rail, so with a river picked the rail sat on the right — correct —
   * and on All rivers, where there is no map, the rail was the row's only child
   * and hugged the LEFT with thirteen hundred pixels of nothing beside it.
   * Picking a river moved the whole panel across the window.
   *
   * "Nothing reaches past the edge" cannot see any of that. These can. */
  if (name === 'desktop') {
    // Put it in the state being asserted about. The first draft measured
    // whatever happened to be on screen and read 0% — and its sibling check
    // passed on four zeroes, which is a check that cannot fail.
    await page.selectOption('#riverpick', '');
    await page.click('#tab-water');
    await page.waitForTimeout(600);

    const w = await page.evaluate(() => {
      const g = document.querySelector('.rivergrid');
      return g ? g.getBoundingClientRect().width / window.innerWidth : 0;
    });
    check(`${name}: the compare view uses the width it is given`, w >= 0.6,
      `river cards span ${Math.round(w * 100)}% of the viewport`);

    /* Four rivers to compare, in a row, so the comparison happens in the eye
       rather than by scrolling. Equal tops because a stretched <button>
       centres its content, which floated the two cards with a line less of
       text eight pixels below the other two. */
    const tops = await page.evaluate(() =>
      [...document.querySelectorAll('.rivergrid .rivercard:not(.networkcard)')]
        .map(c => Math.round(c.getBoundingClientRect().top)));
    /* The four rivers, not the Delta — its card is below the grid on purpose
       and is not expected to share their line. */
    check(`${name}: every river card starts on the same line`,
      tops.length === 4 && new Set(tops).size === 1 && tops[0] > 0, tops.join(', '));
  }

  await page.click('#aboutbtn');
  await page.waitForTimeout(500);
  await audit(page, `${name}: about panel`);
  /* The hub links out to every app and each app links back, and the shared
     accessibility statement lives on the hub — so both links have to be in
     the (i), not merely intended to be. */
  check(`${name}: the About panel links back to the hub and to the shared statement`,
    await page.evaluate(() => {
      const hrefs = [...document.querySelectorAll('#aboutbody a')].map(a => a.getAttribute('href'));
      return hrefs.some(h => h === 'https://noahjefferson.pages.dev') &&
             hrefs.some(h => h === 'https://noahjefferson.pages.dev/accessibility');
    }),
    await page.evaluate(() => [...document.querySelectorAll('#aboutbody a')]
      .map(a => a.getAttribute('href')).filter(h => /noahjefferson/.test(h)).join(' | ')));
  /* THE TIP LINK LIVES IN THE (i) AND NOWHERE ELSE. A prompt for money has no
     business competing with reading the water, so it must be here and must not
     be on the working surface — and it must be a real target for a thumb. */
  const tip = await page.evaluate(() => {
    const as = [...document.querySelectorAll('#aboutbody a.tiplink')];
    return { n: as.length,
             links: as.map(a => ({ href: a.getAttribute('href'),
               rel: a.getAttribute('rel') || '', target: a.getAttribute('target') || '',
               h: Math.round(a.getBoundingClientRect().height) })),
             onSurface: !!document.querySelector('header a.tiplink, #rail a.tiplink, #panel-map a.tiplink') };
  });
  check(`${name}: the tip links are in the (i) panel`,
    tip.n > 0 && !tip.onSurface, JSON.stringify(tip));
  check(`${name}: every one is big enough for a thumb`,
    tip.links.every(l => l.h >= 44), JSON.stringify(tip));
  /* An outbound link that opens a new tab hands the opener to the other site
     unless it is told not to. */
  check(`${name}: none of them hands this page to the site it opens`,
    tip.links.every(l => l.target !== '_blank' || /noopener/.test(l.rel)),
    JSON.stringify(tip));
  /* NOTHING THAT NAGS. No counter, no total, no tier, no praise, and nothing
     that implies a reader who does not pay is missing something. */
  check(`${name}: the tip section asks for nothing and counts nothing`,
    await page.evaluate(() => {
      const t = document.getElementById('aboutbody').textContent;
      const i = t.indexOf('If it was useful');
      const seg = i === -1 ? '' : t.slice(i, i + 700);
      return i !== -1 &&
        !/supporters?|backers?|donors?|thank you|goal|so far|raised|tier|please|help us|support the/i.test(seg) &&
        /nothing about the app is different/.test(seg);
    }),
    await page.evaluate(() => {
      const t = document.getElementById('aboutbody').textContent;
      const i = t.indexOf('If it was useful');
      return i === -1 ? '(section missing)' : t.slice(i, i + 220);
    }));

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

  /* THE UPDATE DIALOG IS A SURFACE AND JOINS THIS GATE IN THE COMMIT THAT
     BUILDS IT (hub LESSONS 28). It is also the one surface nobody sees on
     purpose — it appears once, after a reload, to a reader who has just
     pressed Update — so it is exactly the kind of screen that ships
     unmeasured and stays that way for release after release. */
  await page.evaluate(() => showWhatsNew());
  await page.waitForTimeout(400);
  await audit(page, `${name}: what changed, after an update`);
  check(`${name}: the update dialog opens at the top of itself, with focus in it`,
    await page.evaluate(() => document.getElementById('newbody').scrollTop === 0 &&
      document.activeElement.id === 'newtitle'),
    await page.evaluate(() => document.getElementById('newbody').scrollTop + ' / ' +
      document.activeElement.id));
  /* A reader who just updated wants this version, not the history. It has to
     lead with the changes and offer the rest rather than serve it. */
  check(`${name}: it shows this version's changes and offers the rest`,
    await page.evaluate(() => {
      /* The first list is the changes; the second is what is still not right. */
      const first = document.getElementById('newbody').querySelector('ul');
      const n = first ? first.querySelectorAll('li').length : 0;
      return n === RELEASES.filter(r => r.v === VERSION)[0].changes.length &&
             !!document.getElementById('newolder');
    }),
    await page.evaluate(() => document.getElementById('newbody').querySelectorAll('li').length + ' items'));
  check(`${name}: the update dialog can be closed`,
    await page.evaluate(async () => {
      document.getElementById('newclose').click();
      return !document.getElementById('whatsnew').open;
    }));

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
  /* SEEDED, NOT WAITED FOR, AND THIS IS THE WHOLE POINT OF THE SUITE.
     renderLayers() returns early until the survey catalogue promise settles,
     so every assertion about this panel's contents inherits however long DWR
     takes — which from a GitHub runner is sometimes over twenty seconds and
     sometimes never. That is how a geometry suite came to have a verdict that
     depended on a state agency's uptime: it went red on the phone geometry,
     then on the desktop one, on a different run, with nothing about the commit
     changing in between.
     This suite runs six screen sizes and two engines against a LOCAL server.
     It should control its own inputs, so it does. Whether the real directory
     renders is `tools/live-test.mjs`'s question and it already asks it. */
  await page.evaluate(() => {
    if (state.catalog && state.catalog.raster && state.catalog.raster.length) return;
    state.catalog = { at: Date.now(), rasterError: null, singleError: null, single: [],
      raster: [{ name: 'Bathy_NCRO_20230208_SacramentoRiver',
                 path: '/arcgisimg/rest/services/Bathymetry/Bathy_NCRO_20230208_SacramentoRiver/ImageServer',
                 fields: ['Depth'],
                 box: { w: -122.5, s: 37.5, e: -121.0, n: 39.5, approx: false, wkid: 4326 } }] };
    renderLayers();
  });
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
  // Clears the catalogue to force the no-catalogue state. The return value used
  // to feed a "the catalogue came back" check, which went to the live suite
  // with the rest of the round trip.
  await page.evaluate(() => { state.catalog = null; });
  await page.evaluate(() => showDepthAt(38.4006076, -121.5141745));
  await page.waitForTimeout(700);
  const blind = await popText();
  check(`${name}: a depth reading with no catalogue says it has not asked`,
    /has not arrived|cannot be answered yet/.test(blind) &&
    !/No published survey covers/.test(blind), blind.slice(0, 160));
  /* THE LIVE ROUND TRIP BELONGS IN THE LIVE SUITE, and this is where it used
     to be. Three assertions here asked DWR for a real survey and then read the
     label: that the catalogue came back, that the reading names its survey and
     its date, and the caveat with it. They are duplicates —
     `tools/live-test.mjs` makes exactly those checks, against the real service,
     in the suite whose job that is and which is allowed to go amber when an
     upstream is down.
     Here they were a category error. This suite is the OFFLINE and geometry
     one: it runs six screen sizes and two engines against a local server, and
     making its verdict depend on a state agency's ImageServer answering within
     a timeout means a red run that says nothing about the commit. It failed on
     the desktop geometry while the phone geometry passed the identical
     assertion seconds later, which is what a race looks like from outside; two
     attempts to wait more precisely made it worse, because the thing being
     waited for was somebody else's uptime.
     What stays is the part that is this suite's: the label is a surface, so it
     is opened and audited. The no-catalogue path above opens it without the
     network and is the honest state to audit — it is real, it is what a cold
     start shows, and it is the one where a wrong answer would be a claim about
     California from an app that has not asked. */
  await page.evaluate(() => showDepthAt(38.4006076, -121.5141745));
  await page.waitForTimeout(700);
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

  /* The weir strip, forced on: nothing has been over a crest all summer, so
     the state that matters would otherwise ship unmeasured. A new strip costs
     HEIGHT, and height on a phone is what broke this app twice — so the
     panel's share is re-measured with it showing, not only without. */
  await page.evaluate(() => {
    const s = document.getElementById('weirstrip');
    s.hidden = false;
    document.getElementById('weirtext').textContent =
      'Tisdale Weir is 1.4 ft over its crest. Water is leaving the Sacramento ' +
      'for the Sutter Bypass, and fish go with it.';
  });
  await page.waitForTimeout(300);
  await audit(page, `${name}: weir strip showing`);
  await noOverflow(page, `${name}: nothing reaches past the edge with the weir strip up`);
  /* Ask for the READINGS panel by name. `[role=tabpanel]:not([hidden])` also
     matches the map panel, which is a live tab under the breakpoint and is
     zero-height while another tab is showing — so the generic selector
     measured the wrong element and reported nought. */
  await page.click('#tab-water');
  await page.waitForTimeout(400);
  const withStrip = await page.evaluate(() => ({
    vh: window.innerHeight,
    panel: document.getElementById('panel-water').clientHeight,
    strip: Math.round(document.getElementById('weirstrip').getBoundingClientRect().height) }));
  check(`${name}: the readings keep a third of the screen with the weir strip up`,
    withStrip.panel >= withStrip.vh * 0.33, JSON.stringify(withStrip));
  await page.evaluate(() => { document.getElementById('weirstrip').hidden = true; });
  await page.waitForTimeout(200);

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

/* ---- THE DEVICE RANGE ----
 *
 * Cheap and broad: every geometry gets loaded, opened and measured for the
 * things a layout breaks in — something past the edge, a control stranded in a
 * phone-width column on a wide screen, a row of cards that is not a row. The
 * deep passes above stay on two geometries because they drive a browser through
 * twenty states each.
 *
 * The wide assertion is NOT "fills 60% of the screen". A centred column with
 * gutters is a deliberate and comfortable desktop shape, and demanding a share
 * of the viewport would fail 1920 and 2560 for being tidy. What it must not be
 * is STRANDED — the defect this was written after was a 340px rail on a 1680px
 * screen, so the floor is an absolute width. */
{
  const RANGE = [
    ['iPhone SE',        320,  568],
    ['iPhone 8',         375,  667],
    ['Android',          360,  800],
    ['iPhone 15',        393,  852],
    ['iPhone Pro Max',   430,  932],
    ['iPhone landscape', 844,  390],
    ['iPad mini',        744, 1133],
    ['iPad 10.2',        810, 1080],
    ['iPad Air',         820, 1180],
    ['iPad Pro 11',      834, 1194],
    ['iPad Pro 12.9',   1024, 1366],
    ['iPad mini land',  1133,  744],
    ['iPad Air land',   1180,  820],
    ['iPad Pro land',   1366, 1024],
    ['laptop',          1440,  900],
    ['desktop',         1536,  864],
    ['desktop wide',    1920, 1080],
    ['ultrawide',       2560, 1440],
  ];
  for (const [label, w, h] of RANGE) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForTimeout(1800);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    await page.waitForTimeout(400);

    const m = await page.evaluate(() => {
      const de = document.documentElement;
      const g = document.querySelector('.rivergrid');
      const cards = [...document.querySelectorAll('.rivergrid .rivercard')];
      const chip = document.getElementById('verchip');
      return {
        over: Math.max(0, de.scrollWidth - de.clientWidth),
        grid: g ? Math.round(g.getBoundingClientRect().width) : 0,
        tops: cards.map(c => Math.round(c.getBoundingClientRect().top)),
        cards: cards.length,
        network: document.querySelectorAll('.networkcard').length,
        chip: (chip && chip.textContent || '').trim(),
      };
    });

    check(`${label} ${w}×${h}: nothing reaches past the edge`, m.over === 0, m.over + 'px');
    /* FOUR, and the Delta is deliberately not among them: it is where the
       four arrive rather than a fifth of them, so it has its own card below
       the grid. A fifth card in this grid would leave an orphan row at every
       phone width, which is the defect the rule below exists for. */
    check(`${label} ${w}×${h}: all four rivers are offered`, m.cards === 4, String(m.cards));
    /* NOT "they are one row" — between 901 and 1199 two by two is the right
       shape and one row of four would be 190px wide. What is never right is an
       ORPHAN: four cards in rows of three leaves the fourth river alone, which
       is what auto-fit did on an iPad Pro in portrait. So the rule is that every
       row holds the same number, which for four means four, two or one. */
    const perRow = m.tops.filter(t => t === m.tops[0]).length;
    check(`${label} ${w}×${h}: no river is left on a row of its own`,
      m.cards === 4 && m.cards % perRow === 0, `${perRow} per row (${m.tops.join(', ')})`);
    check(`${label} ${w}×${h}: and the Delta is offered too, on its own card`,
      m.network === 1, String(m.network));
    if (w >= 1200)
      check(`${label} ${w}×${h}: the compare view is not stranded in a narrow column`,
        m.grid >= 900, m.grid + 'px');
    /* A stamp that can be wrong is worse than one that is blank. */
    check(`${label} ${w}×${h}: the version stamp says a version`,
      /^v\d+\.\d+\.\d+/.test(m.chip), m.chip || '(empty)');
    check(`${label} ${w}×${h}: no page errors`, errs.length === 0, errs[0]);
    await ctx.close();
  }
}

/* A FINGER, NOT A POINTER.
 *
 * Every geometry above is a narrow WINDOW, which is not the same thing as a
 * touch device, and the difference hid a real defect for two releases. A
 * control sits on the map, so a press on it is a press on the map — and
 * Leaflet's disableClickPropagation stops that for a mouse and does not stop
 * it for a finger, because on touch the map's click is synthesised from the
 * touch sequence. Tapping the key's Hide button, or Where I am, dropped a
 * depth query underneath it. Every desktop check passed the whole time.
 *
 * So this context has touch, and it taps every control on the map. */
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { const d = document.getElementById('welcome');
    if (d && d.open) d.querySelector('button').click(); });
  await page.waitForTimeout(1200);
  await page.selectOption('#riverpick', 'sacramento');
  await page.waitForTimeout(2500);
  await page.click('#tab-map');
  await page.waitForTimeout(1500);

  const noDepth = async label => {
    const open = await page.evaluate(() => {
      const p = document.querySelector('.leaflet-popup-content');
      return p ? p.textContent.slice(0, 80) : null;
    });
    check(`touch: tapping ${label} does not also ask for a depth`, open === null, open);
  };

  if (await page.locator('#keyopen').count()) {
    await page.click('#keyopen');
    await page.waitForTimeout(900);
    await noDepth('the Key chip');
  }
  await page.click('#maplegend .keyhead button');
  await page.waitForTimeout(900);
  await noDepth('the key\u2019s Hide button');

  await page.click('#herebtn');
  await page.waitForTimeout(1500);
  await noDepth('Where I am');

  /* And the map itself must still answer a finger — a guard that swallowed
     every tap would pass all three above and break the app. */
  const box = await page.evaluate(() => {
    const m = document.getElementById('map').getBoundingClientRect();
    return { x: Math.round(m.left + m.width / 2), y: Math.round(m.top + m.height / 2) };
  });
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(2500);
  check('touch: a tap on the open map still reads the depth there',
    await page.evaluate(() => !!document.querySelector('.leaflet-popup-content')));
  /* THE PROFILE IS A SURFACE and joins this gate in the commit that adds it.
     This suite is offline, so the survey cannot answer — which is the state
     worth auditing here: an empty axis reads as a river with no bottom, so it
     has to say WHY there is nothing, and the drawing must still carry a name
     for anyone reading by ear. */
  await page.click('#tab-layers');
  await page.waitForTimeout(1200);
  /* The cross-section is the pointerless route now: it cuts across the river's
     own line at the middle of the map, so it needs no tapping and it is a
     river's width rather than a screen's. */
  const hasProf = await page.evaluate(() =>
    !![...document.querySelectorAll('#panel-layers button')]
      .find(b => /Cross-section across the river/.test(b.textContent)));
  check('touch: the profile can be started without drawing on the map', hasProf);
  if (hasProf) {
    await page.click('#panel-layers button:text-is("Cross-section across the river here")');
    await page.waitForTimeout(3000);
    const p = await page.evaluate(() => {
      const sec = document.getElementById('profile');
      const svg = document.getElementById('profsvg');
      const t = svg && svg.querySelector('title');
      return { shown: sec && !sec.hidden,
               note: document.getElementById('profnote').textContent.trim(),
               named: !!(t && t.textContent.trim()),
               role: svg && svg.getAttribute('role') };
    });
    check('touch: with no survey it says why rather than drawing an empty axis',
      p.shown && p.note.length > 20, JSON.stringify(p).slice(0, 200));
    check('touch: the drawing is named even when it has nothing to draw',
      p.role === 'img' && p.named, JSON.stringify(p).slice(0, 200));
    await audit(page, 'touch: the profile');
    await page.click('#profclear');
    await page.waitForTimeout(400);
    /* TRACING IS A FINGER GESTURE ON A DRAWING, so it is tested with a finger.
       touch-action:none on the hit area is what stops the browser stealing the
       drag to scroll the profile sideways instead. */
    /* Only where there is a profile to trace. Offline, this suite reaches the
       "no survey answered" state, which correctly draws no trace surface —
       asserting one there would be demanding a gesture over an empty axis. */
    const traceable = await page.evaluate(() => {
      const drew = !!(state.profile && state.profile.bands && state.profile.deepest !== null);
      const r = document.querySelector('#profsvg rect[style*="touch-action"]');
      return { drew, there: !!r, style: r ? r.getAttribute('style') : '' };
    });
    if (traceable.drew)
      check('touch: the profile can be traced without the page stealing the drag',
        traceable.there && /touch-action:\s*none/.test(traceable.style),
        JSON.stringify(traceable));
    else
      check('touch: with nothing measured, there is no gesture over an empty axis',
        !traceable.there, JSON.stringify(traceable));
    /* GETTING BACK is a control on the map and answers to the same rules as
       the rest of them. */
    const back = await page.evaluate(() => {
      const b = document.getElementById('backbtn');
      if (!b || b.hidden) return { shown: false };
      const r = b.getBoundingClientRect();
      const map = document.getElementById('map').getBoundingClientRect();
      return { shown: true, w: Math.round(r.width), h: Math.round(r.height),
               inView: r.right <= map.right + 1 && r.bottom <= map.bottom + 1,
               name: b.textContent.trim() };
    });
    if (back.shown) {
      check('touch: the way back is big enough for a thumb and on the map',
        back.w >= 44 && back.h >= 44 && back.inView, JSON.stringify(back));
      check('touch: it says where it goes', /back to/i.test(back.name), JSON.stringify(back));
    }
    check('touch: clearing the profile puts it away',
      await page.evaluate(() => document.getElementById('profile').hidden));
  }

  check('touch: no page errors', errs.length === 0, errs.join(' | '));
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
if (failures.length) {
  console.log('\nWhat failed:');
  for (const f of failures) console.log('  FAIL  ' + f);
}
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
