const CACHE_NAME = 'gzmn-v5';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const APP_SHELL = [
  './',
  './index.html',
  './search-worker.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './data/index.json'
];

self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(APP_SHELL);
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== CACHE_NAME; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

function putWithTimestamp(cache, req, res){
  return res.clone().blob().then(function(blob){
    var headers = new Headers(res.headers);
    headers.set('sw-cached-at', String(Date.now()));
    var stamped = new Response(blob, { status: res.status, statusText: res.statusText, headers: headers });
    return cache.put(req, stamped);
  });
}

self.addEventListener('fetch', function(event){
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  var isHtmlOrRoot = req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/') || url.pathname.endsWith('manifest.json');

  // HTML page + manifest: checked at most once every 24h.
  // Within the same day, served instantly from cache with no network call at all.
  if (isHtmlOrRoot){
    event.respondWith(
      caches.open(CACHE_NAME).then(function(cache){
        return cache.match(req).then(function(cached){
          var cachedAt = cached ? parseInt(cached.headers.get('sw-cached-at') || '0', 10) : 0;
          var isFresh = cached && (Date.now() - cachedAt) < ONE_DAY_MS;

          if (isFresh) return cached;

          return fetch(req).then(function(res){
            if (res && res.status === 200){
              putWithTimestamp(cache, req, res);
            }
            return res;
          }).catch(function(){ return cached; });
        });
      })
    );
    return;
  }

  // Data JSON files: cache-first, fall back to network, then update cache (stale-while-revalidate)
  if (url.pathname.indexOf('/data/') !== -1) {
    event.respondWith(
      caches.open(CACHE_NAME).then(function(cache){
        return cache.match(req).then(function(cached){
          var networkFetch = fetch(req).then(function(res){
            if (res && res.status === 200) cache.put(req, res.clone());
            return res;
          }).catch(function(){ return cached; });
          return cached || networkFetch;
        });
      })
    );
    return;
  }

  // Everything else (icons, etc.): cache-first
  event.respondWith(
    caches.match(req).then(function(cached){
      return cached || fetch(req).then(function(res){
        if (res && res.status === 200 && url.origin === self.location.origin){
          caches.open(CACHE_NAME).then(function(cache){ cache.put(req, res.clone()); });
        }
        return res;
      }).catch(function(){ return cached; });
    })
  );
});
