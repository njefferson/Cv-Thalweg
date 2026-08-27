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
 * There are two ways to run it and they share this one implementation,
 * because two copies of an allow-list is how an allow-list goes wrong.
 *
 *   As part of the site.  functions/bathy/[[path]].js calls handle() with
 *   the /bathy prefix, so Cloudflare Pages deploys the proxy along with
 *   the app. Nothing to wire up: same origin, no CORS, one deploy.
 *
 *   On its own.  npx wrangler deploy — the default export below — then
 *   point BATHY_PROXY at the worker's origin.
 */

const DWR  = 'https://gis.water.ca.gov';
const CDEC = 'https://cdec.water.ca.gov';

const YEAR = 31536000;   /* multibeam surveys are static */
const DAY  = 86400;      /* feature queries follow the map, not the survey */
const LIVE = 0;          /* a gauge reading is never cached; see below */

/* Matched case-insensitively: ArcGIS service names are not consistently
   cased between the REST directory and the documentation.
   `strip` is removed from the path before forwarding, which is how a
   second upstream gets its own namespace without the allow-list for one
   host ever being able to reach the other. */
const ALLOWED = [
  { prefix: '/arcgisimg/rest/services/bathymetry',
    kind: 'raster',  origin: DWR },
  { prefix: '/arcgis/rest/services/elevation/i06_singlebeam_bathymetry',
    kind: 'feature', origin: DWR },
  /* CDEC is where the Feather River's gauges live — DWR runs them and USGS
     publishes nothing current for that river. Routing them through here
     rather than straight from the page means the browser never depends on
     whether CDEC sends CORS headers, because this reply always does.
     Read-only data servlets only, and never cached: a gauge reading served
     from an edge cache is the exact failure this app is arranged against. */
  { prefix: '/cdec/dynamicapp/req/jsondataservlet',
    kind: 'gauge',   origin: CDEC, strip: '/cdec', ttl: LIVE },
  { prefix: '/cdec/dynamicapp/querycsv',
    kind: 'gauge',   origin: CDEC, strip: '/cdec', ttl: LIVE }
];

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

/* prefix is stripped before the allow-list sees the path, so mounting this
   at /bathy cannot widen what it will forward. */
export async function handle(request, ctx, prefix = '') {
    const url = new URL(request.url);
    if (prefix && url.pathname.startsWith(prefix)) {
      url.pathname = url.pathname.slice(prefix.length) || '/';
    } else if (prefix) {
      return deny('not under ' + prefix);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return deny('method ' + request.method);
    }

    const rule = classify(url.pathname);
    if (!rule) return deny('path not in the bathymetry allow-list');

    /* An exportImage request is a tile and lives a year; everything else
       under the bathymetry prefixes is a query or service metadata and
       lives a day. A rule can override that — CDEC's is zero. */
    const isTile = url.pathname.toLowerCase().endsWith('/exportimage');
    const ttl = rule.ttl !== undefined ? rule.ttl : (isTile ? YEAR : DAY);

    const forwardPath = rule.strip && url.pathname.toLowerCase().startsWith(rule.strip)
      ? url.pathname.slice(rule.strip.length)
      : url.pathname;
    const upstream = new URL((rule.origin || DWR) + forwardPath + url.search);

    const cache = caches.default;
    const cacheKey = new Request(upstream.toString(), { method: 'GET' });

    let response = ttl > 0 ? await cache.match(cacheKey) : undefined;
    let hit = !!response;

    if (!response) {
      hit = false;
      let origin;
      try {
        origin = await fetch(upstream.toString(), {
          method: 'GET',
          headers: { 'Accept': '*/*', 'User-Agent': 'thalweg-bathy-proxy' },
          redirect: 'follow',
          cf: ttl > 0 ? { cacheTtl: ttl, cacheEverything: true } : { cacheTtl: 0 }
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
      headers.set('Cache-Control', ttl > 0
        ? 'public, max-age=' + ttl + ', immutable'
        : 'no-store');
      headers.set('X-Thalweg-Proxy', rule.kind);
      headers.delete('set-cookie');

      response = new Response(origin.body, { status: origin.status, headers });

      if (origin.ok && ttl > 0) {
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }
    }

    /* Clone before reading. A cache hit hands back the stored Response, and
       constructing the reply straight from its body consumes it — so the
       first hit works, the second throws, and the failure only appears on
       the second visitor to the same tile. */
    const out = new Response(response.clone().body, response);
    out.headers.set('X-Thalweg-Cache', hit ? 'hit' : 'miss');
    for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
    out.headers.delete('set-cookie');
    return out;
}

export default {
  fetch(request, env, ctx) { return handle(request, ctx); }
};
