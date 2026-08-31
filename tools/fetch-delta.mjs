/* Bake the Delta: its published boundary, and the named channels inside it.
 *
 * WHY THIS EXISTS. The other four entries in this app are RIVERS — each one a
 * line with an upstream and a downstream, which is what lets the ribbon put a
 * gauge in a place and the profile follow a course. The Delta is not that. It
 * is a braided network of tidal channels with no single main stem, and half of
 * what the state actually surveys is in it: eleven of the twenty published
 * bathymetry surveys land inside no declared river at all.
 *
 * WHAT "THE DELTA" MEANS IS NOT THIS APP'S OPINION. DWR publishes the Legal
 * Delta Boundary, whose own attribution names the Delta Protection Act
 * (Section 12220 of the Water Code) as its source. That polygon is the extent
 * baked here, and everything else — which channels, which gauges, which
 * surveys — is decided by falling inside it rather than by anybody's idea of
 * where the Delta starts.
 *
 * Nothing here is drawn by hand. Boundary geometry is DWR's, channel geometry
 * is USGS's national hydrography, and the only judgement applied is a spacing
 * for the points and a refusal to keep channels that are not in the polygon.
 *
 *   node tools/fetch-delta.mjs --repo .
 *   node tools/fetch-delta.mjs --repo . --check
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/* Node's own fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY is set, and it
   reads that at STARTUP, so setting it here would be too late. Without it this
   asks the proxy directly and gets a 403 carrying the proxy's own allowlist
   message — which reads exactly like the state refusing us, while curl returns
   200 for the same URL in the same shell. It cost a wrong finding once already
   in this repo. Re-exec once with the variable in place. (Hub LESSONS §173.) */
if (!process.env.NODE_USE_ENV_PROXY &&
    (process.env.HTTPS_PROXY || process.env.https_proxy)) {
  const r = spawnSync(process.execPath, [import.meta.filename, ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(r.status === null ? 1 : r.status);
}

const repo = (() => { const i = process.argv.indexOf('--repo');
  return i >= 0 ? process.argv[i + 1] : '.'; })();
const OUT = join(repo, 'public', 'delta.js');
const CHECK = process.argv.includes('--check');

const BOUNDARY = 'https://gis.water.ca.gov/arcgis/rest/services/Boundaries/i03_LegalDeltaBoundary/MapServer/0/query';
const NHD = 'https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer/3/query';

/* Points along a channel, in metres. The same spacing the river centrelines
   use, so a tap snaps to the Delta as tightly as it snaps to a river. */
const SPACING_M = 400;
/* A named water shorter than this inside the boundary is a ditch or a stub of
   something mostly outside it, and it clutters the snap without helping. */
const MIN_KM = 1.5;

const R = 6371000, rad = d => d * Math.PI / 180;
function metres(a, b) {
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const la1 = rad(a[0]), la2 = rad(b[0]);
  const h = Math.sin(dLat/2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function get(url, params) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${u.pathname}`);
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200));
  return j;
}

/* Ray casting. The boundary is one ring and the question is only ever "is this
   point inside it", so nothing cleverer is called for. */
function inRing(ring, lat, lon) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][0], xi = ring[i][1], yj = ring[j][0], xj = ring[j][1];
    if ((yi > lat) !== (yj > lat) &&
        lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/* Drop points that add nothing: anything within tol of the line between its
   neighbours. The boundary is 2,131 points and a reader cannot see the
   difference at any zoom this app offers. */
function thin(pts, tolM) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    const ab = metres(a, b), bc = metres(b, c), ac = metres(a, c);
    if (ab + bc - ac > tolM) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function resample(pts, spacing) {
  if (pts.length < 2) return pts;
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    let seg = metres(pts[i - 1], pts[i]);
    if (!seg) continue;
    let t = (spacing - carry) / seg;
    while (t <= 1) {
      out.push([pts[i-1][0] + (pts[i][0] - pts[i-1][0]) * t,
                pts[i-1][1] + (pts[i][1] - pts[i-1][1]) * t]);
      carry = 0; t += spacing / seg;
    }
    carry += seg * (1 - Math.max(0, t - spacing / seg));
    if (carry > spacing) carry = carry % spacing;
  }
  const last = pts[pts.length - 1];
  if (metres(out[out.length - 1], last) > spacing / 3) out.push(last);
  return out.map(p => [ +p[0].toFixed(5), +p[1].toFixed(5) ]);
}

async function main() {
  const bj = await get(BOUNDARY, { where: '1=1', outFields: 'Source', returnGeometry: 'true',
    outSR: '4326', f: 'json' });
  const feat = (bj.features || [])[0];
  if (!feat) throw new Error('the Legal Delta Boundary returned no feature');
  const rings = (feat.geometry || {}).rings || [];
  if (rings.length !== 1) throw new Error(`expected one ring, got ${rings.length}`);
  /* Attributes are dropped apart from the citation. The record also carries the
     name of the person who last edited it at the department, and republishing
     somebody's name because a dataset happened to include it is not something
     this repo does. */
  const source = feat.attributes.Source || 'DWR, Legal Delta Boundary';
  const ring = thin(rings[0].map(p => [ +p[1].toFixed(5), +p[0].toFixed(5) ]), 60);

  const xs = rings[0].map(p => p[0]), ys = rings[0].map(p => p[1]);
  const bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    .map(v => +v.toFixed(4));

  /* THE SERVICE PAGES AT 2,000 AND SAYS SO. Taking the first page and carrying
     on would ship half a network with nothing to show it was half — the
     Delta's own boundary is wider than any single page of flowlines. */
  const features = [];
  for (let offset = 0; ; offset += 2000) {
    const nj = await get(NHD, {
      geometry: bbox.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects', outFields: 'gnis_name,lengthkm',
      returnGeometry: 'true', outSR: '4326', f: 'json',
      resultOffset: String(offset), resultRecordCount: '2000',
      where: 'gnis_name IS NOT NULL AND ftype IN (460,558)' });
    const got = nj.features || [];
    features.push(...got);
    if (!nj.exceededTransferLimit || !got.length) break;
    if (offset > 40000) throw new Error('the channel query will not end; something is wrong with the paging');
  }
  const nj = { features };

  /* Segments of one named water, joined end to end. NHD hands them back in no
     order, so each is placed against whichever end of the run it actually
     touches — the same rule the river centrelines use. */
  const byName = new Map();
  for (const f of nj.features || []) {
    const nm = f.attributes.gnis_name;
    const paths = (f.geometry || {}).paths || [];
    for (const path of paths) {
      const pts = path.map(p => [p[1], p[0]]);
      /* IN OR OUT IS DECIDED BY THE PUBLISHED POLYGON, not by the bounding box
         it happens to sit in. A creek that only clips the corner of the box is
         not a Delta channel. */
      const insideCount = pts.filter(p => inRing(ring, p[0], p[1])).length;
      if (insideCount < pts.length / 2) continue;
      if (!byName.has(nm)) byName.set(nm, []);
      byName.get(nm).push(pts);
    }
  }

  const channels = [];
  for (const [name, paths] of byName) {
    const runs = paths.slice().sort((a, b) => b.length - a.length);
    let line = runs.shift() || [];
    let moved = true;
    while (moved && runs.length) {
      moved = false;
      for (let i = 0; i < runs.length; i++) {
        const r = runs[i];
        const ends = [
          [metres(line[line.length - 1], r[0]), 'tail-head'],
          [metres(line[line.length - 1], r[r.length - 1]), 'tail-tail'],
          [metres(line[0], r[r.length - 1]), 'head-tail'],
          [metres(line[0], r[0]), 'head-head']
        ].sort((a, b) => a[0] - b[0])[0];
        if (ends[0] > 250) continue;
        if (ends[1] === 'tail-head') line = line.concat(r);
        else if (ends[1] === 'tail-tail') line = line.concat(r.slice().reverse());
        else if (ends[1] === 'head-tail') line = r.concat(line);
        else line = r.slice().reverse().concat(line);
        runs.splice(i, 1); moved = true; break;
      }
    }
    let km = 0;
    for (let i = 1; i < line.length; i++) km += metres(line[i-1], line[i]) / 1000;
    if (km < MIN_KM) continue;
    channels.push({ name, km: +km.toFixed(1), pts: resample(line, SPACING_M) });
  }
  channels.sort((a, b) => b.km - a.km);

  const body = `/* Generated by tools/fetch-delta.mjs — do not edit by hand.
   The boundary is DWR's Legal Delta Boundary; its own attribution names
   ${JSON.stringify(source)}. The channels are named waterways from the USGS
   national hydrography, kept only where most of the segment falls inside that
   boundary. No geometry here was drawn by this project. */
var DELTA = ${JSON.stringify({ boundary: ring, channels }, null, 0)};
var DELTA_META = ${JSON.stringify({
    boundarySource: source,
    boundaryFrom: 'DWR gis.water.ca.gov Boundaries/i03_LegalDeltaBoundary',
    channelsFrom: 'USGS NHDPlus High Resolution, flowlines',
    spacingM: SPACING_M, minKm: MIN_KM, bbox,
    fetchedAt: new Date().toISOString().slice(0, 10)
  }, null, 0)};
`;
  writeFileSync(OUT, body);
  const kb = (Buffer.byteLength(body) / 1024).toFixed(1);
  console.log(`=== delta bake ===\n  boundary ${rings[0].length} points thinned to ${ring.length}`);
  console.log(`  ${channels.length} named channels inside it, ${channels.reduce((n,c)=>n+c.pts.length,0)} points, ${kb} KB`);
  for (const c of channels.slice(0, 12)) console.log(`    ${String(c.km).padStart(6)} km  ${c.name}`);
}

function check() {
  if (!existsSync(OUT)) { console.error('public/delta.js is missing — run without --check'); process.exit(1); }
  const src = readFileSync(OUT, 'utf8');
  const fails = [];
  if (!/Legal Delta Boundary/.test(src)) fails.push('the file does not say where its boundary came from');
  if (!/national hydrography/i.test(src)) fails.push('the file does not say where its channels came from');
  const m = src.match(/var DELTA = (\{[\s\S]*?\});\n/);
  if (!m) { console.error('cannot parse DELTA'); process.exit(1); }
  const d = JSON.parse(m[1]);
  if (!d.boundary || d.boundary.length < 50) fails.push('the boundary is too short to be a boundary');
  if (!d.channels || !d.channels.length) fails.push('no channels');
  for (const c of d.channels || []) {
    if (!c.pts || c.pts.length < 2) fails.push(`${c.name}: fewer than two points`);
    for (const p of c.pts || [])
      if (!Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))
        { fails.push(`${c.name}: a point that is not a position`); break; }
    for (let i = 1; i < (c.pts || []).length; i++)
      if (metres(c.pts[i-1], c.pts[i]) > SPACING_M * 8)
        { fails.push(`${c.name}: a ${Math.round(metres(c.pts[i-1], c.pts[i]))} m step, which is a join that should have been cut`); break; }
  }
  if (fails.length) { console.error('FAILURES:\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log(`PASS — ${d.channels.length} channels inside a ${d.boundary.length}-point published boundary.`);
}

if (CHECK) check();
else main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
