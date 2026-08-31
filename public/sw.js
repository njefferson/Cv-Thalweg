/* Thalweg service worker.
 *
 * Two jobs, and the second one is the interesting one.
 *
 * 1. Keep the shell so the app opens with no signal.
 * 2. Refuse to serve live data from cache. Flow and temperature that look
 *    current and are not are worse than no reading at all, so the gauge
 *    and tide hosts are never cached here — the page keeps the last good
 *    payload itself and labels its age. Predictions are arithmetic about
 *    the future and are stored by the page for the same reason.
 *
 * The new version WAITS. It never takes over under an open page: that is
 * how an app ends up running old markup against new code, and the reader
 * has no way to see it happen.
 */
var VERSION = '1.4.0';
var SHELL = 'thalweg-shell-' + VERSION;
var TILES = 'thalweg-tiles-' + VERSION;
var TILE_CAP = 1200;

var PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'tide-stations.js',
  'access-lands.js',
  'river-lines.js',
  'vendor/leaflet.js',
  'vendor/leaflet.css',
  'vendor/images/marker-icon.png',
  'vendor/images/marker-icon-2x.png',
  'vendor/images/marker-shadow.png',
  'vendor/images/layers.png',
  'vendor/images/layers-2x.png',
  'icon.svg',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
  'icon-512-maskable.png'
];

/* Hosts whose answers must never be served from cache. */
var LIVE_HOSTS = ['waterservices.usgs.gov', 'api.tidesandcurrents.noaa.gov'];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(SHELL).then(function(c){
      /* One at a time so a single 404 does not fail the whole install. */
      return Promise.all(PRECACHE.map(function(u){
        return c.add(new Request(u, { cache:'reload' })).catch(function(){ return null; });
      }));
    })
    /* No skipWaiting. See the note at the top of this file. */
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        if (k !== SHELL && k !== TILES && k.indexOf('thalweg-') === 0)
          return caches.delete(k);
        return null;
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('message', function(e){
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isLive(url){
  if (LIVE_HOSTS.indexOf(url.hostname) !== -1) return true;
  /* Gauge readings routed through this site's own proxy are live data too.
     Same rule, different door: never cached, never replayed. And /version
     exists to say which build is live — a cached answer to that question
     is worse than no answer, because it is confidently the old one. */
  return url.pathname.indexOf('/cdec/') === 0 || url.pathname === '/version';
}
function isBathy(url){
  return url.pathname.indexOf('/exportImage') !== -1 ||
         /\/MapServer(\/\d+)?\/query$/.test(url.pathname) ||
         url.pathname.indexOf('/arcgisimg/rest/services/Bathymetry') !== -1 ||
         url.pathname.indexOf('/i06_Singlebeam_Bathymetry') !== -1;
}
/* Cache-first is only right for something that cannot change. A depth
   tile is a survey that finished years ago, so a hit is as good as a
   fetch. The service directory is the opposite: the whole reason the app
   enumerates it instead of listing layers in its own source is so that a
   survey published next month appears without a redeploy — and a
   cache-first directory would quietly undo that. Same for a feature
   query, which is an answer about a place, not the place itself. */
function isFrozenTile(req, url){
  if (url.pathname.indexOf('/exportImage') !== -1) return true;
  return req.destination === 'image' && url.origin !== self.location.origin;
}
function isFreshable(url){
  return isBathy(url);
}

/* Keep the runtime cache bounded. Entries go in in the order they were
   viewed, so the oldest keys are the ones furthest from where you are. */
function trim(cache){
  return cache.keys().then(function(keys){
    if (keys.length <= TILE_CAP) return null;
    return Promise.all(keys.slice(0, keys.length - TILE_CAP).map(function(k){
      return cache.delete(k);
    }));
  });
}

self.addEventListener('fetch', function(e){
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch(err){ return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  /* Live data: straight to the network, never stored, never replayed. */
  if (isLive(url)) return;

  /* Navigation: the shell, so the app opens on a levee road. */
  if (req.mode === 'navigate'){
    e.respondWith(
      fetch(req).catch(function(){
        return caches.match('index.html', { ignoreSearch:true })
          .then(function(r){ return r || caches.match('./'); });
      })
    );
    return;
  }

  /* Map and depth tiles: cache as viewed, and a hit wins. */
  if (isFrozenTile(req, url)){
    e.respondWith(
      caches.open(TILES).then(function(cache){
        return cache.match(req).then(function(hit){
          if (hit) return hit;
          return fetch(req).then(function(res){
            /* An opaque response has an unknown status; store it anyway,
               it is the only thing a cross-origin tile can give us. */
            if (res && (res.ok || res.type === 'opaque')){
              cache.put(req, res.clone()).then(function(){ return trim(cache); })
                .catch(function(){});
            }
            return res;
          });
        });
      })
    );
    return;
  }

  /* Service directory, layer metadata and feature queries: the network
     first, so the app sees what DWR publishes today; the stored copy is
     what makes them work with no signal. */
  if (isFreshable(url)){
    e.respondWith(
      caches.open(TILES).then(function(cache){
        return fetch(req).then(function(res){
          if (res && res.ok){
            cache.put(req, res.clone()).then(function(){ return trim(cache); })
              .catch(function(){});
          }
          return res;
        }).catch(function(err){
          return cache.match(req).then(function(hit){
            if (hit) return hit;
            throw err;
          });
        });
      })
    );
    return;
  }

  /* Everything else is the shell: cache first, then network. */
  e.respondWith(
    caches.match(req, { ignoreSearch:false }).then(function(hit){
      return hit || fetch(req).then(function(res){
        if (res && res.ok && url.origin === self.location.origin){
          var copy = res.clone();
          caches.open(SHELL).then(function(c){ c.put(req, copy); }).catch(function(){});
        }
        return res;
      });
    })
  );
});
