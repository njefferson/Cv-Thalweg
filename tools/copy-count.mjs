#!/usr/bin/env node
/* A NUMBER IN READER-FACING COPY MUST BE ASKED OF THE TABLE THAT OWNS IT.
 *
 * `public/index.html` carries a comment promising this gate. The comment was
 * written and the gate was not, and the prose it was meant to hold went on
 * saying "four rivers" in two places while every other sentence in the app
 * counted properly. A rule that exists only as a paragraph beside the code is
 * what this repo has repeatedly measured as not holding — so this is a script.
 *
 * WHAT IT FLAGS, AND WHY IT IS THIS NARROW. The first version of this file
 * matched a count word in front of any table noun and flagged NINETY lines,
 * nearly all of them honest: "a mark belongs to one river", "two surveys here",
 * "one of the four subsections amended". Honest prose and a stale count are the
 * same shape, which the sibling repos have already paid to learn
 * (hub LESSONS §108), so the shape is not what is matched.
 *
 * WHAT IS MATCHED IS THE COINCIDENCE. A spelled number is flagged only when it
 * EQUALS the current size of one of this app's own tables and sits next to that
 * table's noun, or stands bare for the set — "four rivers", "all four",
 * "which of the four". A number that matches no table is talking about
 * something else and is left alone; a number that matches is correct today
 * and is the exact thing that goes stale when the table grows. The counts are
 * read out of the arrays in index.html on every run, so the gate cannot fall
 * behind the table any more than the copy may.
 *
 * WHAT IS NOT COPY. Comments, CSS and the RELEASES array. A release note is a
 * RECORD of what a version did, and version 1.0.0 really did open on four
 * rivers; rewriting it to say five would be a lie about the past, so past
 * releases are out of scope by construction rather than by declaration.
 *
 * The exceptions that remain are a LIST, in `.copy-count-allow`, one exact
 * string per line, and every covered line is PRINTED on every run so a growing
 * allow-list cannot hide behind a green tick. `--list` prints a seed.
 *
 *   node tools/copy-count.mjs [--list]
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const SRC = join(root, 'public', 'index.html');
const ALLOW = join(root, '.copy-count-allow');
const LIST = process.argv.includes('--list');

const WORDS = ['no','one','two','three','four','five','six','seven','eight',
               'nine','ten','eleven','twelve'];
const VALUE = {}; WORDS.forEach((w, i) => { VALUE[w] = i; });

/* The nouns whose number lives in an array in this file. Each one is paired
   below with the array that actually decides it. */
const NOUNS = ['rivers','river bars','weirs'];

/* COMMENTS ARE NOT COPY. Strip them before looking at anything, or the gate
   spends its whole life flagging the paragraphs that explain it. Kept
   character-for-character in length so line numbers still mean something. */
function stripComments(text){
  let out = '', i = 0, mode = null;
  while (i < text.length){
    const two = text.slice(i, i + 2);
    if (!mode && two === '/*'){ mode = 'block'; out += '  '; i += 2; continue; }
    if (mode === 'block' && two === '*/'){ mode = null; out += '  '; i += 2; continue; }
    if (!mode && text.slice(i, i + 4) === '<!--'){ mode = 'html'; out += '    '; i += 4; continue; }
    if (mode === 'html' && text.slice(i, i + 3) === '-->'){ mode = null; out += '   '; i += 3; continue; }
    const c = text[i];
    out += mode ? (c === '\n' ? '\n' : ' ') : c;
    i++;
  }
  return out;
}

/* A literal is prose if a person could read it as a sentence. Selectors,
   URLs, colours, keys and format strings are not, and flagging them is how a
   gate earns a reputation for being wrong. */
function isProse(s){
  if (!/\s/.test(s)) return false;
  if (s.length < 8) return false;
  if (/^https?:|^\.\/|^#|^\.[a-z-]+$/i.test(s)) return false;
  if (/^[-#0-9a-f., ()%]+$/i.test(s)) return false;
  return /[a-z]{3}/i.test(s);
}

const raw = readFileSync(SRC, 'utf8');
const body = stripComments(raw);
const lines = body.split('\n');

/* THE TABLE COUNTS, READ OUT OF THE APP RATHER THAN WRITTEN HERE. A gate that
   hardcodes the number it is policing has the same defect as the copy. */
function riverEntries(){
  const m = /\nvar RIVERS = \[/.exec(raw);
  if (!m) fatal('RIVERS not found in index.html — this gate cannot measure anything.');
  const from = m.index;
  const ids = [...raw.slice(from).matchAll(/\n  id:'([a-z]+)',/g)].map(x => x[1]);
  if (!ids.length) fatal('RIVERS has no top-level entries this gate can see.');
  const nets = [...raw.slice(from).matchAll(/\n  network:true,/g)].length;
  return { all: ids.length, rivers: ids.length - nets };
}
function weirCount(){
  const m = /weirs:\{[\s\S]*?list:\[([\s\S]*?)\]/.exec(raw);
  return m ? [...m[1].matchAll(/code:'/g)].length : 0;
}
function fatal(msg){ console.log('FAIL  ' + msg); process.exit(1); }

const RV = riverEntries();
/* A number is suspect if it equals the size of any of these. Overlap is fine:
   the question is only whether the number is one a table could move. */
const TABLES = [
  { n: RV.rivers, what: `RIVERS without the network entries (${RV.rivers})` },
  { n: RV.all,    what: `every row the ribbon draws (${RV.all})` },
  { n: weirCount(), what: `the Sacramento's weir list (${weirCount()})` }
].filter(t => t.n > 0);
const SUSPECT = new Map();
for (const t of TABLES) if (!SUSPECT.has(t.n)) SUSPECT.set(t.n, t.what);

const W = WORDS.filter(w => SUSPECT.has(VALUE[w])).join('|');
const N = NOUNS.join('|');
if (!W) fatal('No table has a size this gate can spell — nothing would ever be checked.');

/* "four rivers" — a count in front of a table's own noun. */
const COUNTED = new RegExp(`\\b(${W})\\s+(?:other\\s+|more\\s+)?(${N})\\b`, 'i');
/* "all four", "the four", "of the four" — the set named by its size with the
   noun left implied. Both defects that shipped were this shape. */
const BARE = new RegExp(`\\b(?:all|the|of the)\\s+(${W})\\b(?!\\s+(?:${N}))`, 'i');

/* A RELEASE NOTE IS A RECORD, NOT A CLAIM ABOUT NOW. Version 1.0.0 really did
   open on four rivers. Rewriting that sentence when a river is added would be
   a lie about the past, so the RELEASES array is out of scope — by finding it,
   not by declaring its lines one at a time. */
function releasesRange(){
  const m = /\nvar RELEASES = \[/.exec(body);
  if (!m) fatal('RELEASES not found — this gate no longer knows what to leave alone.');
  const start = body.slice(0, m.index).split('\n').length + 1;
  const rest = body.slice(m.index);
  const close = rest.indexOf('\n];');
  if (close < 0) fatal('RELEASES is not closed the way this gate expects.');
  return [start, start + rest.slice(0, close).split('\n').length];
}
const [relFrom, relTo] = releasesRange();

const allow = existsSync(ALLOW)
  ? readFileSync(ALLOW, 'utf8').split('\n')
      .map(l => l.replace(/^\s*#.*$/, '').trim()).filter(Boolean)
  : [];

const hits = [];
lines.forEach((line, n) => {
  const ln = n + 1;
  if (ln >= relFrom && ln <= relTo) return;
  /* Single-quoted literals, which is how every string in this app is written.
     A backslash-escaped quote inside one is left to the next match rather than
     parsed properly: it costs a duplicate hit at worst, never a miss. */
  const found = line.match(/'(?:[^'\\]|\\.)*'/g) || [];
  for (const lit of found){
    const str = lit.slice(1, -1);
    if (!isProse(str)) continue;
    const m = COUNTED.exec(str) || BARE.exec(str);
    if (!m) continue;
    const word = (m[1] || '').toLowerCase();
    hits.push({ line: ln, text: str, what: m[0],
                owner: SUSPECT.get(VALUE[word]) || 'a table in this file' });
  }
});

if (LIST){
  console.log('# tools/copy-count.mjs --list · one exact literal per line.');
  console.log('# Declare a line here only when the number is NOT the size of a');
  console.log('# table this app keeps. A stale count is never declarable.');
  for (const h of [...new Set(hits.map(h => h.text))]) console.log(h);
  process.exit(0);
}

const covered = hits.filter(h => allow.includes(h.text));
const open = hits.filter(h => !allow.includes(h.text));

/* EVERY COVERED LINE IS PRINTED. An allow-list that grows quietly is the
   same defect as no gate at all. */
if (covered.length){
  console.log(`Declared in .copy-count-allow (${covered.length}), and read on every run:`);
  for (const h of covered) console.log(`  index.html:${h.line}  "${h.what}"  — ${h.text.slice(0, 90)}`);
}

/* A DECLARATION THAT NO LONGER MATCHES ANYTHING IS A FAILURE, not a tidy-up.
   It means the copy moved and the reason it was allowed went with it. */
const stale = allow.filter(a => !hits.some(h => h.text === a));
for (const a of stale)
  console.log(`FAIL  .copy-count-allow declares copy that is no longer in the app — ${a.slice(0, 90)}`);

for (const h of open)
  console.log(`FAIL  index.html:${h.line} counts by hand — "${h.what}" is the size of ${h.owner}.\n        ${h.text.slice(0, 140)}`);

const bad = open.length + stale.length;
console.log(bad
  ? `\n${bad} hand-written count${bad === 1 ? '' : 's'} in reader-facing copy. Ask the table, or declare it in .copy-count-allow with a reason.`
  : `Every count in reader-facing copy is asked of its table. ${covered.length} declared, ${lines.length} lines read.`);
process.exit(bad ? 1 : 0);
