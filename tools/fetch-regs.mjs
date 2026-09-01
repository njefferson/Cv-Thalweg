/* Bake the fishing regulations this app quotes, from CDFW's own service.
 *
 * WHY A BAKE AND NOT A HARDCODED STRING. Regulations change. A rule typed into
 * source is right on the day it is typed and silently wrong afterwards, and
 * the reader has no way to tell which they are looking at — a stale regulation
 * is worse than none, because it is quoted with a section number and reads as
 * authority. This asks the department, records what it said and when, and
 * refuses to ship anything it could not read.
 *
 * WHERE IT COMES FROM. CDFW publishes its own sport fishing regulations app at
 * apps.wildlife.ca.gov/sportfishingregs/, and behind it is a feature service
 * carrying Title 14 as text, searchable by section number. That is the
 * department's own copy of its own rules, which is the nearest thing to the
 * printed book that a machine can read. The printed regulations remain the
 * authority and this app says so everywhere it quotes one.
 *
 * WHAT IT WILL NOT DO. It does not summarise, paraphrase, or reorder. Every
 * rule is stored in the words the service returned, with its section number
 * and the date it was read. A regulation paraphrased is a regulation invented.
 *
 *   node tools/fetch-regs.mjs --repo .
 *   node tools/fetch-regs.mjs --repo . --check
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/* Node's own fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY is set, and it
   reads it at STARTUP. Without it the department appears to refuse us with a
   403 that is really the proxy's allowlist. (Hub LESSONS §173.) */
if (!process.env.NODE_USE_ENV_PROXY &&
    (process.env.HTTPS_PROXY || process.env.https_proxy)) {
  const r = spawnSync(process.execPath, [import.meta.filename, ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(r.status === null ? 1 : r.status);
}

const repo = (() => { const i = process.argv.indexOf('--repo');
  return i >= 0 ? process.argv[i + 1] : '.'; })();
const OUT = join(repo, 'public', 'regulations.js');
const CHECK = process.argv.includes('--check');

const SERVICE = 'https://services2.arcgis.com/Uq9r85Potqm3MfRV/arcgis/rest/services/RFRService/FeatureServer/2/query';

/* THE SECTIONS THIS APP QUOTES, and nothing else. Fetching the whole of Title
   14 would be a megabyte of rules about waters this app has never heard of.
   Each entry says which app surface it is for and what it is about, so a
   reader of this file can tell why a rule is here without opening the app.
   Adding a species means adding its sections here and nowhere else.

   A PARENT SECTION IS USUALLY A HEADING WITH NOTHING IN IT. Asked for 5.80 the
   service returns "Inland White Sturgeon", and asked for 5.80(a) it returns
   "Open season:" — a colon and then nothing, because the season is in three
   children that name the Carquinez Bridge, the Feather confluence and the I-5
   bridge. Shipping the parent alone would put a section number and a colon in
   front of a reader and call it a regulation. So an entry can declare
   `children`, and the bake fetches the section AND its direct children and
   keeps them together as parts, in the service's own order. */
const WANTED = [
  { code: '1.71',        topic: 'delta',    about: 'What the Delta legally is' },
  { code: '2.10(c)(1)',  topic: 'delta',    about: 'Hook gaps in the Delta' },
  { code: '2.25(b)(1)',  topic: 'delta',    about: 'Bow and arrow fishing in the Delta' },

  { code: '5.00(a)(1)',  topic: 'bass',     about: 'Black bass: lakes, reservoirs and the Delta' },

  { code: '5.75(a)',     topic: 'striper',  about: 'Striped bass: open season' },
  { code: '5.75(b)',     topic: 'striper',  about: 'Striped bass: limit' },
  { code: '5.75(c)',     topic: 'striper',  about: 'Striped bass: minimum size' },
  { code: '5.75(e)',     topic: 'striper',  about: 'Striped bass: hybrids' },

  { code: '5.80(a)',     topic: 'sturgeon', about: 'White sturgeon: open season', children: true },
  { code: '5.80(b)',     topic: 'sturgeon', about: 'White sturgeon: daily limit' },
  { code: '5.80(c)',     topic: 'sturgeon', about: 'White sturgeon: annual limit' },
  { code: '5.80(d)',     topic: 'sturgeon', about: 'White sturgeon: methods of take' },
  { code: '5.80(e)',     topic: 'sturgeon', about: 'White sturgeon: handling and removal from water' },
  { code: '5.80(f)',     topic: 'sturgeon', about: 'White sturgeon: report card required' },
  { code: '5.80(i)',     topic: 'sturgeon', about: 'Sturgeon closure, Sierra and Valley District', children: true },
  { code: '5.80(j)',     topic: 'sturgeon', about: 'Sturgeon closure, Yolo Bypass' },
  { code: '5.81(a)',     topic: 'sturgeon', about: 'Green sturgeon may not be taken' },
  { code: '5.81(b)',     topic: 'sturgeon', about: 'Green sturgeon: removal from water' },
  { code: '5.81(c)',     topic: 'sturgeon', about: 'Green sturgeon: reporting' },

  { code: '1.73(a)',     topic: 'salmon',   about: 'What counts as salmon' },
  { code: '1.75',        topic: 'salmon',   about: 'Salmon spawning areas' }
];

/* The service wraps its text in markers for its own renderer. They are not
   part of the regulation and are not shown to anybody.

   `[row]` IS NOT ONE OF THOSE AND MUST NOT BE STRIPPED. It delimits a TABLE,
   pipe-separated — water, season, size, bag — and a table is the one shape
   this family of apps may not ship, because it does not render on the reader's
   tablet and loses its columns silently. Stripping the marker would turn it
   into a run of prose with stray pipes in it, which is worse than refusing it.
   So `plain` leaves it standing and the check below refuses the section. */
function plain(v) {
  return String(v || '')
    .replace(/\[start_\w+\]|\[end_\w+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* A HEADING IS NOT A REGULATION. "Salmon", "Open season:", "Exceptions:" —
   each is a section number in front of nothing, and quoting one with its
   number would read as authority for a rule that is not there. */
function isHeading(text, title) {
  const t = text.replace(/\s+$/, '');
  if (t.length < 14) return true;
  if (/:$/.test(t)) return true;
  if (title && t.toLowerCase().replace(/\.$/, '') === String(title).toLowerCase().trim()) return true;
  return false;
}

function hasTable(text) {
  return /\[row\]/.test(text) || /\|.*\|/.test(text);
}

async function get(params) {
  const u = new URL(SERVICE);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200));
  return j;
}

async function main() {
  /* Everything asked for by name, plus every direct child of the sections that
     declared they have one. Two queries rather than one per section: the
     service pages at a few hundred and this is a few dozen rows. */
  const quote = c => `'${String(c).replace(/'/g, "''")}'`;
  const byCode = new Map();

  async function pull(where) {
    const j = await get({
      where, outFields: 'Code,ParentCode,Title,Verbatim,Source',
      returnGeometry: 'false', f: 'json', resultRecordCount: '400',
      orderByFields: 'Code'
    });
    for (const f of j.features || []) {
      const a2 = f.attributes, text = plain(a2.Verbatim);
      if (!text) continue;
      /* One code can come back more than once. Keep the fullest text rather
         than whichever arrived last. */
      const prev = byCode.get(a2.Code);
      if (!prev || text.length > prev.text.length)
        byCode.set(a2.Code, { code: a2.Code, parent: a2.ParentCode || '',
                              title: a2.Title || '', text,
                              source: a2.Source || 'CCR Title 14' });
    }
  }

  await pull(`Code IN (${WANTED.map(w => quote(w.code)).join(',')})`);
  const parents = WANTED.filter(w => w.children).map(w => w.code);
  if (parents.length) await pull(`ParentCode IN (${parents.map(quote).join(',')})`);

  const rules = [], missing = [], refused = [];
  for (const w of WANTED) {
    const r = byCode.get(w.code);
    if (!r) { missing.push(w.code); continue; }

    const parts = w.children
      ? [...byCode.values()]
          .filter(x => x.parent === w.code)
          .sort((x, y) => x.code.localeCompare(y.code, 'en', { numeric: true }))
          .map(x => ({ code: x.code, text: x.text }))
      : [];

    /* A TABLE IS REFUSED, NOT FLATTENED. Losing its columns into prose would
       be this bake inventing a sentence CDFW never wrote. */
    const tabled = [r, ...parts].filter(x => hasTable(x.text)).map(x => x.code);
    if (tabled.length) { refused.push(`${w.code} (a table: ${tabled.join(', ')})`); continue; }

    /* A heading with children is a heading WITH ITS RULE UNDER IT and ships.
       A heading with none is a section number in front of nothing. */
    if (isHeading(r.text, r.title) && !parts.length) {
      refused.push(`${w.code} (a heading with nothing under it: "${r.text}")`);
      continue;
    }

    rules.push({ code: r.code, topic: w.topic, about: w.about,
                 title: r.title, text: r.text,
                 parts: parts, source: r.source });
  }
  if (!rules.length) throw new Error('no regulation came back at all');

  const body = `/* Generated by tools/fetch-regs.mjs — do not edit by hand.
   California Code of Regulations, Title 14, in the words CDFW's own
   regulations service returned on the date below. Nothing here is summarised
   or paraphrased. The printed regulations are the authority. */
var REGULATIONS = ${JSON.stringify(rules, null, 0)};
var REGULATIONS_META = ${JSON.stringify({
    source: SERVICE,
    from: 'CDFW sport fishing regulations service (apps.wildlife.ca.gov/sportfishingregs)',
    fetchedAt: new Date().toISOString().slice(0, 10),
    asked: WANTED.length, got: rules.length, missing, refused
  }, null, 0)};
`;
  writeFileSync(OUT, body);
  console.log(`=== regulations bake ===\n  ${rules.length} of ${WANTED.length} sections, ${(Buffer.byteLength(body)/1024).toFixed(1)} KB`);
  const byTopic = {};
  rules.forEach(r => { byTopic[r.topic] = (byTopic[r.topic] || 0) + 1; });
  Object.keys(byTopic).forEach(t => console.log(`    ${String(byTopic[t]).padStart(3)}  ${t}`));
  const withParts = rules.filter(r => r.parts.length);
  if (withParts.length)
    withParts.forEach(r => console.log(`  ${r.code} carries ${r.parts.length} sub-section(s): ${r.parts.map(p2 => p2.code).join(', ')}`));
  if (refused.length) console.log(`  REFUSED:\n    ${refused.join('\n    ')}`);
  if (missing.length) console.log(`  NOT RETURNED: ${missing.join(', ')} — renumbered, repealed, or wrong in WANTED.`);
}

function check() {
  if (!existsSync(OUT)) { console.error('public/regulations.js is missing — run without --check'); process.exit(1); }
  const src = readFileSync(OUT, 'utf8');
  const fails = [];
  if (!/Title 14/.test(src)) fails.push('the file does not say which code it quotes');
  if (!/printed regulations are the authority/.test(src))
    fails.push('the file does not carry the deference to the printed regulations');
  const m = src.match(/var REGULATIONS = (\[[\s\S]*?\]);\n/);
  const mm = src.match(/var REGULATIONS_META = (\{[\s\S]*?\});\n/);
  if (!m || !mm) { console.error('cannot parse regulations.js'); process.exit(1); }
  const rules = JSON.parse(m[1]), meta = JSON.parse(mm[1]);
  console.log(`=== baked regulations · ${rules.length} section(s) ===\n  read ${meta.fetchedAt} from ${meta.from}\n`);
  if (!rules.length) fails.push('no sections');
  const topics = {};
  for (const r of rules) {
    topics[r.topic] = (topics[r.topic] || 0) + 1;
    if (!r.code) fails.push('a rule with no section number');
    if (!r.text || r.text.length < 12) fails.push(`${r.code}: no text worth quoting`);
    if (/\[start_|\[end_/.test(r.text || '')) fails.push(`${r.code}: the service's own markers are still in the text`);
    if (!r.topic) fails.push(`${r.code}: no topic, so no surface can ask for it`);
    if (!r.about) fails.push(`${r.code}: nothing says why this section is here`);
    const parts = r.parts || [];
    /* DOCTRINE 2. A table does not render where this is read and loses its
       columns without saying so. The bake refuses one; this refuses one that
       got in past an older bake. */
    for (const x of [r, ...parts])
      if (/\[row\]/.test(x.text || '') || /\|.*\|/.test(x.text || ''))
        fails.push(`${x.code}: this is a table, and a table cannot be shown here`);
    /* A SECTION NUMBER IN FRONT OF NOTHING READS AS AUTHORITY. "Open season:"
       with no dates under it is worse than the section being absent. */
    if (!parts.length && (/:$/.test(r.text) || r.text.length < 14))
      fails.push(`${r.code}: "${r.text}" is a heading, not a rule — it needs its sub-sections or it should not be here`);
    for (const x of parts)
      if (!x.code || !x.text) fails.push(`${r.code}: a sub-section with no number or no words`);
  }
  Object.keys(topics).sort().forEach(t => console.log(`  ${String(topics[t]).padStart(3)}  ${t}`));
  /* STALENESS IS THE WHOLE POINT OF THIS FILE. A regulation quoted with a
     section number reads as authority, so one nobody has re-read in a year is
     the failure this bake exists to prevent. The workflow re-bakes monthly;
     this fails long before a reader could be looking at last season's rules. */
  const age = (Date.now() - Date.parse(meta.fetchedAt)) / 86400000;
  if (!(age >= 0)) fails.push('the file does not say when it was read');
  else if (age > 120) fails.push(`last read ${Math.round(age)} days ago — re-run the bake; the workflow should be doing this monthly`);
  else console.log(`\n  read ${Math.round(age)} day(s) ago.`);
  if (meta.missing && meta.missing.length)
    console.log(`  NOTE: ${meta.missing.length} requested section(s) did not come back: ${meta.missing.join(', ')}`);
  if (meta.refused && meta.refused.length)
    console.log(`  NOTE: ${meta.refused.length} refused by the bake: ${meta.refused.join('; ')}`);
  if (fails.length) { console.error('FAILURES:\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('\nEvery rule carries its section number, its topic and its words.');
}

if (CHECK) check();
else main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
