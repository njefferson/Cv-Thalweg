#!/usr/bin/env node
/* THE STRANGER'S WALK — reading this app as somebody who has never seen it.
 *
 * Not a gate, on purpose, and it must never become one. A gate asks a yes/no
 * question it already knows how to ask; this asks the one question no assertion
 * can hold: what would a person who has never been told anything think this
 * screen means? Every check in tools/a11y.mjs was written by somebody who
 * already knew the answer, which is exactly the knowledge a first-time reader
 * does not have.
 *
 * It opens the app on a phone, walks every surface in the order a newcomer
 * meets them, and writes out two things per screen: a picture, and the words
 * actually on it. Then a human — or a session — READS them. The finding is
 * never "this failed"; it is "this sentence assumes something the reader has
 * not been told".
 *
 * Run it against the real services, because a reader gets real services:
 *   node tools/walk.mjs                     (real data, phone)
 *   node tools/walk.mjs --at http://…       (somewhere else)
 *   node tools/walk.mjs --wide              (desktop geometry)
 *
 * Pictures land in walk/ , which is not committed.
 */
import { chromium, devices } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromiumLaunch } from './lib-browser.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i === -1 ? d : process.argv[i + 1]; };
const BASE = arg('--at', 'http://127.0.0.1:8787');
const WIDE = process.argv.includes('--wide');
const OUT = 'walk';
mkdirSync(OUT, { recursive: true });

/* A walk against the live site needs the browser to use this container's
   egress proxy, which node picks up from the environment and Chromium does
   not. Local walks must NOT go through it — the bypass list keeps 127.0.0.1
   direct — and a walk that silently could not reach the site would report an
   app full of "did not answer", which is a finding about the container. */
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || '';
/* The page can come from a local server while the DATA still goes out through
   this container's egress. A walk whose services all failed would describe an
   app full of "did not answer", which is a finding about the container and not
   about the app.
   NO BYPASS LIST. Chromium already bypasses loopback, and `<-loopback>` is the
   token that TURNS THAT OFF — it sends localhost through the proxy, which is
   the exact opposite of what is wanted here. With it, the local server was
   never reached and the walk photographed a blank page: no title, no header,
   no error. It looked like the app had failed to boot. */
const args = proxy ? ['--proxy-server=' + proxy] : [];
if (!proxy) console.log('!! no HTTPS_PROXY — live data will not reach this walk');
const browser = await chromium.launch({ ...chromiumLaunch({ args }) });
const ctx = await browser.newContext(WIDE
  ? { viewport: { width: 1280, height: 900 } }
  : { ...devices['iPhone 13'] });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));

let n = 0;
const report = [];

async function screen(title, note) {
  n++;
  const id = String(n).padStart(2, '0');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${id}-${title.replace(/\W+/g, '-').toLowerCase()}.png`,
                          fullPage: false });
  /* The words a reader can actually SEE. Not the DOM — the visible text, with
     the runs of whitespace collapsed, because that is what the eye gets. */
  const words = await page.evaluate(() => {
    const seen = [];
    const walk = el => {
      for (const c of el.childNodes) {
        if (c.nodeType === 3) { const t = c.textContent.trim(); if (t) seen.push(t); }
        else if (c.nodeType === 1) {
          const s = getComputedStyle(c);
          if (s.display === 'none' || s.visibility === 'hidden' || c.hidden) continue;
          const r = c.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          walk(c);
        }
      }
    };
    walk(document.body);
    return seen.join(' ').replace(/\s+/g, ' ');
  });
  report.push({ id, title, note, words });
  console.log(`\n─── ${id} · ${title} ───`);
  if (note) console.log(`    (${note})`);
  console.log(words.slice(0, 2000));
}

await page.goto(BASE + '/', { waitUntil: 'load' });
await page.waitForTimeout(3500);
/* A WALK OF A BLANK PAGE IS WORSE THAN NO WALK. It produces screenshots and
   prose and every one of them is about nothing, and the first version did
   exactly that for a whole run before anybody noticed the header was missing. */
const booted = await page.evaluate(() => !!document.getElementById('riverpick'));
if (!booted) {
  console.log('\n!! The app did not boot at ' + BASE + ' — no river picker on the page.');
  console.log('   Nothing below this line would be about the app. Stopping.');
  await browser.close();
  process.exit(1);
}
await screen('first run', 'the very first thing anybody sees');

await page.evaluate(() => { const d = document.getElementById('welcome');
  if (d && d.open) d.querySelector('button').click(); });
await page.waitForTimeout(2500);
await screen('landing, all four rivers', 'the go-or-not screen');

await page.selectOption('#riverpick', 'sacramento');
await page.waitForTimeout(4000);
await screen('one river, readings', 'top of the Water panel');

await page.evaluate(() => { const p = document.getElementById('panel-water');
  p.scrollTop = p.scrollHeight * 0.45; });
await screen('one river, the tide', 'where a reader meets the tide');

await page.evaluate(() => { const p = document.getElementById('panel-water');
  p.scrollTop = p.scrollHeight; });
await screen('one river, foot of the panel', 'the last thing on the readings');

for (const [tab, note] of [['map', 'the map and its key'],
                           ['layers', 'where the depth surveys live'],
                           ['marks', 'your own marks'],
                           ['brief', 'seasons and rules']]) {
  const there = await page.evaluate(t => {
    const el = document.getElementById('tab-' + t);
    return !!el && el.getBoundingClientRect().height > 0;
  }, tab);
  if (!there) { console.log(`\n(no ${tab} tab at this size)`); continue; }
  await page.click('#tab-' + tab);
  await page.waitForTimeout(2500);
  await screen(tab, note);
}

/* The (i) is a <dialog>. Clicking the button is not enough to be sure it
   opened — if it did not, this screen silently captures whatever was behind
   it, which is exactly what happened the first time this ran. */
await page.click('#aboutbtn');
await page.waitForTimeout(1200);
const aboutOpen = await page.evaluate(() => document.getElementById('about').open);
if (!aboutOpen) console.log('\n!! the (i) panel did not open — that is itself a finding');
await screen('the (i) panel', aboutOpen ? 'what the app says about itself' : 'DID NOT OPEN');
await page.evaluate(() => { const d = document.getElementById('about'); if (d.open) d.close(); });

writeFileSync(`${OUT}/walk.json`, JSON.stringify({ base: BASE, wide: WIDE, errs, report }, null, 2));
console.log(`\n${n} screens in ${OUT}/. Page errors: ${errs.length ? errs.join(' | ') : 'none'}`);
console.log('\nThis is not a gate and must not become one. Read the words above and');
console.log('ask, of each screen: what does this assume the reader already knows?');
await browser.close();
