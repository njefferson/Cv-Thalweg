/* Did the deploy actually go out, and is it this commit?
 *
 * A push is not a release: it is entirely possible to verify a push
 * against the remote, correctly, and still have every deploy fail on a
 * gate — leaving the live site on an older build while each release is
 * reported as shipped. The question is never "did the push succeed" but
 * "is the live site serving THIS commit".
 *
 *   node tools/check-deploy.mjs [url] [expected-sha]
 *
 * With no arguments it checks https://cv-thalweg.pages.dev against the
 * commit currently checked out here. Exits non-zero if they differ, if
 * the site does not answer, or if the site cannot say what it is.
 */
import { execSync } from 'node:child_process';

const url = (process.argv[2] || 'https://cv-thalweg.pages.dev').replace(/\/$/, '');
let expected = process.argv[3];
if (!expected) {
  try { expected = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); }
  catch { expected = null; }
}

let bad = 0;
const say = (ok, line) => { if (!ok) bad++; console.log((ok ? 'PASS  ' : 'FAIL  ') + line); };
const note = line => console.log('INFO  ' + line);

async function get(path, as = 'text') {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url + path, { signal: ctrl.signal, redirect: 'follow' });
    return { res, body: as === 'json' ? await res.json() : await res.text() };
  } catch (e) {
    return { err: String(e && e.message || e) };
  } finally { clearTimeout(t); }
}

/* 1. the site answers at all */
const page = await get('/');
if (page.err || !page.res.ok) {
  say(false, `${url} did not answer — ${page.err || 'HTTP ' + page.res.status}`);
  console.log('\nNothing else can be checked until it does.');
  process.exit(1);
}
say(true, `${url} answers`);

/* 2. it is this app, and which version of it */
const version = (page.body.match(/var VERSION = '([^']+)'/) || [])[1];
say(/<title>Thalweg/.test(page.body), 'the page is Thalweg');
say(!!version, version ? `the app reports version ${version}` : 'no VERSION found in the page');

/* 3. which commit — the part that a push cannot tell you */
const v = await get('/version', 'json');
if (v.err || !v.res.ok) {
  say(false, `/version did not answer — ${v.err || 'HTTP ' + v.res.status}. ` +
    'Either the functions directory was not published, or this is not a Pages deployment.');
} else if (!v.body.commit) {
  say(false, `/version answered but cannot say which commit: ${v.body.source}`);
} else {
  note(`live commit ${v.body.commit}${v.body.branch ? ' on ' + v.body.branch : ''}`);
  if (expected) {
    say(v.body.commit === expected,
      v.body.commit === expected
        ? `the live site is serving ${expected.slice(0, 7)} — this commit`
        : `the live site is serving ${v.body.commit.slice(0, 7)}, not ${expected.slice(0, 7)}. The deploy did not carry this commit.`);
  } else {
    note('no expected commit given and git could not supply one; nothing compared');
  }
}

/* 4. the proxy went out with it */
const proxy = await get('/bathy/arcgisimg/rest/services/Bathymetry?f=json', 'json');
if (proxy.err || !proxy.res.ok) {
  say(false, `the bathymetry proxy at /bathy did not answer — ${proxy.err || 'HTTP ' + proxy.res.status}. ` +
    'Depth will be unavailable on the live site.');
} else {
  const n = (proxy.body.services || []).length;
  say(n > 0, `the proxy answers and DWR returned ${n} services through it`);
}
const denied = await get('/bathy/arcgis/rest/services/Boundaries/MapServer?f=json');
say(!denied.err && denied.res.status === 403,
  denied.err ? `the allow-list check could not run — ${denied.err}`
             : `the proxy refuses a path outside its allow-list (HTTP ${denied.res.status})`);

console.log(bad ? `\n${bad} problem(s). This is not deployed.` : '\nDeployed, and serving this commit.');
process.exit(bad ? 1 : 0);
