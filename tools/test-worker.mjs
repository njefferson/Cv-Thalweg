/* Local tests for worker.js.
 *
 * The proxy is the one piece of this app whose behaviour can be settled
 * without reaching California: what it forwards, what it refuses, and
 * what it strips are all decisions the code makes on its own. Upstream is
 * stubbed, so a pass here says the allow-list holds — it says nothing
 * about whether DWR answers.
 *
 *   node tools/test-worker.mjs
 */
let upstreamCalls = [];

globalThis.caches = {
  default: {
    _m: new Map(),
    /* The edge hands back a fresh Response each time. Storing and
       returning clones is what makes a double-read show up here instead
       of on the second visitor to a tile. */
    async match(req) { const hit = this._m.get(req.url); return hit ? hit.clone() : undefined; },
    async put(req, res) { this._m.set(req.url, res.clone()); }
  }
};

const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  upstreamCalls.push(String(url));
  return new Response('{"ok":true}', {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': 'session=should-never-survive; Path=/',
      'x-upstream-secret': 'also-dropped'
    }
  });
};

const mod = await import('../worker.js');
const worker = mod.default;
const ctx = { waitUntil(p) { return p; } };

/* The Pages Function is a mount point, not a second implementation. These
   run the same allow-list through the /bathy prefix to prove that mounting
   it inside the site cannot widen what it forwards. */
const pages = (await import('../functions/bathy/[[path]].js')).onRequest;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}
async function call(path, init) {
  upstreamCalls = [];
  const res = await worker.fetch(new Request('https://proxy.example' + path, init), {}, ctx);
  return { res, upstream: upstreamCalls.slice() };
}

/* --- allowed --- */
for (const p of [
  '/arcgisimg/rest/services/Bathymetry?f=json',
  '/arcgisimg/rest/services/Bathymetry/Bathy_NCRO_20190819_SacramentoRvr/ImageServer?f=json',
  '/arcgisimg/rest/services/Bathymetry/Anything_Published_Next_Month/ImageServer/exportImage?bbox=1,2,3,4&f=image',
  '/arcgis/rest/services/Elevation/i06_Singlebeam_Bathymetry/MapServer/layers?f=json',
  '/arcgis/rest/services/Elevation/i06_Singlebeam_Bathymetry/MapServer/31/query?f=json&where=1%3D1',
  /* the REST directory is not consistent about case, so neither are we */
  '/arcgis/rest/services/Elevation/i06_SingleBeam_Bathymetry/MapServer/33/query?f=json'
]) {
  const { res, upstream } = await call(p);
  check('allows ' + p.slice(0, 62), res.status === 200 && upstream.length === 1,
    'status ' + res.status);
  check('  forwards to gis.water.ca.gov',
    upstream[0] && upstream[0].startsWith('https://gis.water.ca.gov' + p.split('?')[0]),
    upstream[0]);
}

/* --- refused --- */
for (const p of [
  '/',
  '/arcgis/rest/services?f=json',
  '/arcgis/rest/services/Boundaries/MapServer?f=json',
  '/arcgisimg/rest/services/Elevation/Something/ImageServer',
  '/arcgisimg/rest/services/BathymetryOther/ImageServer',
  '/arcgisimg/rest/services/Bathymetry/../../admin',
  '/arcgisimg/rest/services/Bathymetry/%2e%2e/%2e%2e/admin',
  '/arcgisimg/rest/services/Bathymetry//etc/passwd',
  '/arcgisimg/rest/services/Bathymetry/x/ImageServer/exportImage?url=http://evil'
    .replace('exportImage?url', 'exportImage%3Furl')
]) {
  const { res, upstream } = await call(p);
  const refused = res.status === 403 && upstream.length === 0;
  check('refuses ' + p.slice(0, 62), refused, 'status ' + res.status + ', upstream ' + upstream.length);
}

/* "BathymetryOther" must not match on the "Bathymetry" prefix. */
{
  const { res } = await call('/arcgisimg/rest/services/BathymetryX/ImageServer?f=json');
  check('prefix is anchored at a path separator', res.status === 403, 'status ' + res.status);
}

/* --- method --- */
for (const m of ['POST', 'PUT', 'DELETE']) {
  const { res, upstream } = await call('/arcgisimg/rest/services/Bathymetry?f=json', { method: m });
  check('refuses ' + m, res.status === 403 && upstream.length === 0, 'status ' + res.status);
}
{
  const { res } = await call('/arcgisimg/rest/services/Bathymetry?f=json', { method: 'OPTIONS' });
  check('answers preflight', res.status === 204 &&
    res.headers.get('access-control-allow-origin') === '*', 'status ' + res.status);
}

/* --- headers --- */
{
  const { res } = await call('/arcgisimg/rest/services/Bathymetry?f=json');
  check('sets Access-Control-Allow-Origin', res.headers.get('access-control-allow-origin') === '*');
  check('strips set-cookie', !res.headers.get('set-cookie'));
  check('drops unlisted upstream headers', !res.headers.get('x-upstream-secret'));
  check('keeps content-type', /json/.test(res.headers.get('content-type') || ''));
}

/* --- cache lifetimes --- */
{
  const tile = await call('/arcgisimg/rest/services/Bathymetry/L/ImageServer/exportImage?bbox=1,2,3,4&f=image');
  check('tiles cache for a year',
    /max-age=31536000/.test(tile.res.headers.get('cache-control') || ''),
    tile.res.headers.get('cache-control'));
  const q = await call('/arcgis/rest/services/Elevation/i06_Singlebeam_Bathymetry/MapServer/31/query?f=json');
  check('feature queries cache for a day',
    /max-age=86400/.test(q.res.headers.get('cache-control') || ''),
    q.res.headers.get('cache-control'));
}

/* --- cache actually serves the second request --- */
{
  const a = await call('/arcgisimg/rest/services/Bathymetry/CacheMe/ImageServer?f=json');
  const b = await call('/arcgisimg/rest/services/Bathymetry/CacheMe/ImageServer?f=json');
  check('second identical request is a cache hit',
    a.res.headers.get('x-thalweg-cache') === 'miss' &&
    b.res.headers.get('x-thalweg-cache') === 'hit' && b.upstream.length === 0,
    a.res.headers.get('x-thalweg-cache') + ' then ' + b.res.headers.get('x-thalweg-cache'));
}

/* --- the second upstream: namespaced, read-only, never cached --- */
{
  const ok = await call('/cdec/dynamicapp/req/JSONDataServlet?Stations=GRL&SensorNums=20&dur_code=E');
  check('forwards a CDEC data request', ok.res.status === 200 && ok.upstream.length === 1,
    'status ' + ok.res.status + ', upstream ' + ok.upstream.length);
  check('strips the /cdec namespace and switches host',
    ok.upstream[0] === 'https://cdec.water.ca.gov/dynamicapp/req/JSONDataServlet?Stations=GRL&SensorNums=20&dur_code=E',
    ok.upstream[0]);
  check('a gauge reading is never cached', /no-store/.test(ok.res.headers.get('cache-control') || ''),
    ok.res.headers.get('cache-control'));

  const again = await call('/cdec/dynamicapp/req/JSONDataServlet?Stations=GRL&SensorNums=20&dur_code=E');
  check('an uncached rule goes upstream every time', again.upstream.length === 1,
    'upstream ' + again.upstream.length);

  /* The two upstreams must not be able to reach each other. */
  for (const p of [
    '/cdec/arcgisimg/rest/services/Bathymetry?f=json',
    '/cdec/dynamicapp/staMeta?station_id=GRL',
    '/cdec/',
    '/dynamicapp/req/JSONDataServlet?Stations=GRL',
    '/cdec/dynamicapp/req/JSONDataServlet/../../admin'
  ]) {
    const bad = await call(p);
    check('refuses ' + p.slice(0, 58), bad.res.status === 403 && bad.upstream.length === 0,
      'status ' + bad.res.status + ', upstream ' + bad.upstream.length);
  }
  const cross = await call('/arcgisimg/rest/services/Bathymetry/CrossCheck/ImageServer?f=json');
  check('a bathymetry path still goes to DWR, not CDEC',
    cross.upstream[0] && cross.upstream[0].startsWith('https://gis.water.ca.gov/'),
    cross.upstream[0]);
}

/* --- a cache hit must be readable more than once --- */
{
  const path = '/arcgisimg/rest/services/Bathymetry/ReadTwice/ImageServer?f=json';
  const first  = await call(path);
  const second = await call(path);
  const third  = await call(path);
  check('a cached response can be served repeatedly',
    second.res.status === 200 && third.res.status === 200 &&
    (await third.res.text()) === '{"ok":true}',
    'first ' + first.res.status + ', second ' + second.res.status + ', third ' + third.res.status);
}

/* --- query string survives, including the rendering rule --- */
{
  const { upstream } = await call(
    '/arcgisimg/rest/services/Bathymetry/L/ImageServer/exportImage?bbox=1,2,3,4&f=image&renderingRule=%7B%22rasterFunction%22%3A%22Stretch%22%7D');
  check('query string is forwarded intact',
    upstream[0].includes('renderingRule=%7B%22rasterFunction%22%3A%22Stretch%22%7D'), upstream[0]);
}

/* --- the same rules through the Pages mount --- */
async function viaPages(path, init) {
  upstreamCalls = [];
  const request = new Request('https://site.example' + path, init);
  const res = await pages({ request, waitUntil(p) { return p; } });
  return { res, upstream: upstreamCalls.slice() };
}
{
  /* A path nothing above has already fetched, or the edge cache answers it
     and there is no upstream call left to inspect. */
  const ok = await viaPages('/bathy/arcgisimg/rest/services/Bathymetry/PagesMountProbe/ImageServer?f=json');
  check('pages mount forwards an allowed path',
    ok.res.status === 200 && ok.upstream.length === 1,
    'status ' + ok.res.status + ', upstream ' + ok.upstream.length);
  check('pages mount strips its own prefix before forwarding',
    ok.upstream[0] === 'https://gis.water.ca.gov/arcgisimg/rest/services/Bathymetry/PagesMountProbe/ImageServer?f=json',
    ok.upstream[0]);

  for (const p of [
    '/bathy/arcgis/rest/services/Boundaries/MapServer?f=json',
    '/bathy/../arcgisimg/rest/services/Bathymetry?f=json',
    '/notbathy/arcgisimg/rest/services/Bathymetry?f=json',
    '/bathy/arcgisimg/rest/services/BathymetryX/ImageServer?f=json'
  ]) {
    const bad = await viaPages(p);
    check('pages mount refuses ' + p.slice(0, 58),
      bad.res.status === 403 && bad.upstream.length === 0,
      'status ' + bad.res.status + ', upstream ' + bad.upstream.length);
  }

  const tile = await viaPages('/bathy/arcgisimg/rest/services/Bathymetry/L/ImageServer/exportImage?bbox=1,2,3,4&f=image');
  check('pages mount keeps the year-long tile lifetime',
    /max-age=31536000/.test(tile.res.headers.get('cache-control') || ''),
    tile.res.headers.get('cache-control'));
}

globalThis.fetch = realFetch;
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
