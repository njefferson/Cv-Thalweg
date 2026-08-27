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
    async match(req) { return this._m.get(req.url) || undefined; },
    async put(req, res) { this._m.set(req.url, res); }
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

const worker = (await import('../worker.js')).default;
const ctx = { waitUntil(p) { return p; } };

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

/* --- query string survives, including the rendering rule --- */
{
  const { upstream } = await call(
    '/arcgisimg/rest/services/Bathymetry/L/ImageServer/exportImage?bbox=1,2,3,4&f=image&renderingRule=%7B%22rasterFunction%22%3A%22Stretch%22%7D');
  check('query string is forwarded intact',
    upstream[0].includes('renderingRule=%7B%22rasterFunction%22%3A%22Stretch%22%7D'), upstream[0]);
}

globalThis.fetch = realFetch;
console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
