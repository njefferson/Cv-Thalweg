#!/usr/bin/env node
/* notes-check — the patch notes are written for the reader, and every release
 * that ships has one.
 *
 * Doctrine 7d says every app shows the reader what changed, in their words,
 * including what is still broken. That was true of this app's first release
 * and stopped being true of the four after it: they explained the mechanism
 * instead — a bounding box, a two-megabyte endpoint, a request per station.
 * All of that is real and none of it is what somebody who just pressed Update
 * wants to know.
 *
 * The prose rule lost four releases in a row while it sat in a file. So it is
 * a gate.
 *
 * WHY A CLOSED VOCABULARY AND A DECLARED ALLOW-LIST, rather than a cleverer
 * rule. Hub LESSONS 108: three pattern rules aimed at ordinary speech flagged
 * 39, 138 and 227 files of honest prose, because a product's voice and the
 * thing it is trying to exclude are the same shape. A short list of words no
 * reader has a use for is checkable; "does this read like a developer wrote
 * it" is not. `.notes-allow` is how a legitimate use gets through, declared
 * per line with a reason, and every covered line is printed on every run so a
 * declaration cannot quietly become permanent cover.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const repo = (() => {
  const i = process.argv.indexOf('--repo');
  return i === -1 ? process.cwd() : process.argv[i + 1];
})();

const APP = join(repo, 'public', 'index.html');
const ALLOW = join(repo, '.notes-allow');

const fails = [];
const notes = [];

const src = readFileSync(APP, 'utf8');

/* Read the declaration by evaluating it, not by pattern. A regex over this
   array found two of four rivers with the wrong flags when the station
   generator tried it, and there is no reason to expect better here. */
function releases() {
  const i = src.indexOf('var RELEASES = [');
  if (i === -1) throw new Error('no RELEASES array in public/index.html');
  let j = src.indexOf('[', i), depth = 0, end = -1;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '[') depth++;
    else if (src[k] === ']') { depth--; if (!depth) { end = k + 1; break; } }
  }
  return new Function('return ' + src.slice(j, end))();
}

function appVersion() {
  const m = /var VERSION = '([^']+)'/.exec(src);
  if (!m) throw new Error('no VERSION in public/index.html');
  return m[1];
}

/* Words a reader has no use for. Each is machinery: it describes how the app
   is built rather than what it does for the person holding it. Word
   boundaries throughout, so `panel` does not trip `pane`. */
const MACHINERY = [
  'bounding box', 'endpoint', 'API', 'JSON', 'regex', 'regular expression',
  'callback', 'propagation', 'z-index', 'pane', 'service worker', 'precache',
  'cache', 'cached', 'caching', 'commit', 'repo', 'repository', 'refactor',
  'DOM', 'CSS', 'HTML', 'viewport', 'boolean', 'null', 'array', 'parameter',
  'query string', 'lockfile', 'zizmor', 'identifier', 'build id', 'SHA',
  'deploy', 'deployed', 'runtime', 'render', 'rendered', 'string', 'integer',
];
const RX = MACHINERY.map(w => ({ w, rx: new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i') }));

/* One line, one declaration: "<version> <n> <term> — why". */
function readAllow() {
  if (!existsSync(ALLOW)) return [];
  return readFileSync(ALLOW, 'utf8').split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const m = /^(\S+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(l);
      if (!m) { fails.push(`.notes-allow: cannot read "${l}" — expected "<version> <index> <term> <reason>"`); return null; }
      return { v: m[1], i: Number(m[2]), term: m[3].toLowerCase(), why: m[4], used: false };
    })
    .filter(Boolean);
}

const R = releases();
const V = appVersion();
const allow = readAllow();

console.log(`=== patch notes · ${repo.split('/').pop()} ===\n`);

/* A RELEASE THAT SHIPS WITHOUT A NOTE IS THE FAILURE 7d IS ABOUT, and it is
   the easy one to make: bump the version, run the gates, push. */
if (!R.length) fails.push('RELEASES is empty — there is nothing to show a reader.');
else if (R[0].v !== V)
  fails.push(`the app is version ${V} and the newest note is for ${R[0].v} — a release without a note reaches a reader as an update that will not say what it did.`);

const seen = {};
R.forEach(r => {
  if (!r.v) fails.push('a release has no version.');
  if (!r.date) fails.push(`${r.v}: no date.`);
  if (seen[r.v]) fails.push(`${r.v} is listed twice.`);
  seen[r.v] = true;
  if (!r.changes || !r.changes.length) fails.push(`${r.v}: no changes listed.`);

  const lines = [].concat(r.changes || [], r.broken || []);
  lines.forEach((line, i) => {
    if (typeof line !== 'string' || !line.trim())
      return fails.push(`${r.v} #${i}: an empty note.`);
    if (line.trim().length < 40)
      fails.push(`${r.v} #${i}: too short to say anything — "${line}"`);
    RX.forEach(({ w, rx }) => {
      if (!rx.test(line)) return;
      const d = allow.find(a => a.v === r.v && a.i === i && a.term === w.toLowerCase());
      if (d) { d.used = true; notes.push(`  covered  ${r.v} #${i} "${w}" — ${d.why}`); return; }
      fails.push(`${r.v} #${i}: "${w}" is machinery, not something a reader has a use for.\n      ${line.slice(0, 140)}${line.length > 140 ? '…' : ''}`);
    });
  });
});

/* BOTH DIRECTIONS. A declaration that no longer covers anything is cover
   nobody is checking, and the next edit under it is unmeasured. */
allow.filter(a => !a.used).forEach(a =>
  fails.push(`.notes-allow declares ${a.v} #${a.i} "${a.term}" and that note does not use it any more — delete the line.`));

const total = R.reduce((n, r) => n + (r.changes || []).length + (r.broken || []).length, 0);
console.log(`  ${R.length} release(s), ${total} note(s), newest ${R[0] && R[0].v} against app version ${V}`);
const withBroken = R.filter(r => r.broken && r.broken.length).length;
console.log(`  ${withBroken} release(s) say what is still not right`);
notes.forEach(n => console.log(n));

if (fails.length) {
  console.log(`\nFAILURES (${fails.length}):`);
  fails.forEach(f => console.log('  ✗ ' + f));
  console.log('\nDoctrine 7d: the reader is told what changed, in their words.');
  process.exit(1);
}
console.log('\nEvery release has a note, and every note is written for the reader.');
