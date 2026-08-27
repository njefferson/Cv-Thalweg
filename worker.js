/* Thalweg bathymetry proxy.
 *
 * The DWR services are California's public GIS infrastructure, not a tile
 * API. Without this in front of them, every visitor's pan and zoom lands
 * on gis.water.ca.gov, one request per 256-pixel tile. With it, the edge
 * answers almost all of them: the surveys are static, so a tile cached
 * for a year is not stale, it is finished.
 *
 * Two service paths are proxied and nothing else. The allow-list is by
 * PREFIX so a survey published next month needs no redeploy here, and it
 * is anchored at the service root so this cannot be turned into an open
 * proxy for the rest of the host.
 *
 * Deploy:  npx wrangler deploy worker.js --name cv-thalweg-bathy
 * Then set BATHY_PROXY in public/index.html to the worker's origin.
 */

const UPSTREAM = 'https://gis.water.ca.gov';

/* Matched case-insensitively: ArcGIS service names are not consistently
   cased between the REST directory and the documentation. */
const ALLOWED = [
  { prefix: '/arcgisimg/rest/services/bathymetry',                          kind: 'raster' },
  { prefix: '/arcgis/rest/services/elevation/i06_singlebeam_bathymetry',    kind: 'feature' }
];

const YEAR = 31536000;   /* multibeam surveys are static */
const DAY  = 86400;      /* feature queries follow the map, not the survey */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  'Timing-Allow-Origin': '*'
};

function deny(reason) {
  return new Response('Forbidden: ' + reason + '\n', {
    status: 403,
    headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

function classify(pathname) {
  /* Reject traversal before any prefix test, so a dotted segment cannot
     climb out of the allowed subtree after the match has been made.
     Percent-encoding is refused outright rather than decoded and checked:
     ArcGIS service and layer paths are plain word characters, so a % in
     the path is never anything but an attempt to smuggle a separator past
     this test and have the origin resolve it afterwards. */
  if (pathname.includes('..') || pathname.includes('//')) return null;
  if (pathname.includes('%') || pathname.includes('\\')) return null;
  if (!/^[A-Za-z0-9_/.\-]*$/.test(pathname)) return null;
  const lower = pathname.toLowerCase();
  for (const rule of ALLOWED) {
    if (lower === rule.prefix || lower.startsWith(rule.prefix + '/')) return rule;
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return deny('method ' + request.method);
    }

    const rule = classify(url.pathname);
    if (!rule) return deny('path not in the bathymetry allow-list');

    /* An exportImage request is a tile and lives a year; everything else
       under these prefixes is a query or service metadata and lives a day. */
    const isTile = url.pathname.toLowerCase().endsWith('/exportimage');
    const ttl = isTile ? YEAR : DAY;

    const upstream = new URL(UPSTREAM + url.pathname + url.search);

    const cache = caches.default;
    const cacheKey = new Request(upstream.toString(), { method: 'GET' });

    let response = await cache.match(cacheKey);
    let hit = true;

    if (!response) {
      hit = false;
      let origin;
      try {
        origin = await fetch(upstream.toString(), {
          method: 'GET',
          headers: { 'Accept': '*/*', 'User-Agent': 'thalweg-bathy-proxy' },
          redirect: 'follow',
          cf: { cacheTtl: ttl, cacheEverything: true }
        });
      } catch (err) {
        return new Response('Upstream unreachable: ' + err + '\n', {
          status: 502,
          headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }

      /* Rebuild the response rather than mutating it: this is where any
         set-cookie from the upstream is dropped, along with anything else
         we did not decide to pass on. */
      const headers = new Headers(CORS);
      const ct = origin.headers.get('content-type');
      if (ct) headers.set('Content-Type', ct);
      headers.set('Cache-Control', 'public, max-age=' + ttl + ', immutable');
      headers.set('X-Thalweg-Proxy', rule.kind);
      headers.delete('set-cookie');

      response = new Response(origin.body, { status: origin.status, headers });

      if (origin.ok) {
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }
    }

    const out = new Response(response.body, response);
    out.headers.set('X-Thalweg-Cache', hit ? 'hit' : 'miss');
    for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
    out.headers.delete('set-cookie');
    return out;
  }
};
