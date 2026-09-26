/**
 * The offline shell.
 *
 * Three things this gets right that the first cut did not:
 *
 *   1. The cache name carries the build id, injected at build time. A
 *      constant name meant a new deployment never took effect: the browser
 *      kept serving last month's JavaScript and no amount of reloading
 *      helped.
 *
 *   2. A failed asset fetch fails. It used to fall back to index.html, so a
 *      dropped connection handed the browser HTML where it expected
 *      JavaScript — a blank screen and a syntax error rather than an honest
 *      "you are offline".
 *
 *   3. Nothing that belongs to a person is cached. API responses hold
 *      attendance, marks and fee records; those are never written to disk by
 *      this worker, so a shared phone in a lab does not keep the last
 *      student's results.
 */
const BUILD = "2026.0926.062022";
const CACHE = `campus-${BUILD}`;
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {}),
    // No skipWaiting: the page decides when to swap, so a save in progress
    // is never interrupted by a reload the person did not ask for.
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("campus-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page tells the worker to take over once the person accepts the update.
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

const isAsset = (url) => url.pathname.includes("/assets/");

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;      // the API and fonts go straight out

  // The shell: network first, so a deployment is picked up on the next load,
  // with the cached copy as the offline fallback.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          /*
           * Only a good response is allowed to become the offline shell.
           *
           * Every response used to be cached, status included. A load
           * balancer answering 503 for the thirty seconds of a deployment was
           * enough to write that 503 page in as the app shell — and because
           * the cache is only ever replaced by a *successful* navigation, a
           * phone that went offline right afterwards kept being handed the
           * error page instead of the app, until the next deployment changed
           * the cache name. The offline screen below is the honest answer to
           * a failed load; a cached 503 is not.
           */
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("./index.html", copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r ?? offline())),
    );
    return;
  }

  // Hashed assets are immutable, so cache-first is safe and fast. A miss that
  // cannot be fetched is an error, not a page.
  if (isAsset(url)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Everything else — icons, the manifest — cache-first with a plain failure.
  event.respondWith(caches.match(req).then((hit) => hit ?? fetch(req)));
});

function offline() {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <title>Offline</title>
     <style>body{font:16px/1.5 system-ui;margin:0;display:grid;place-items:center;height:100dvh;
     background:#f7f7f8;color:#1a1a1a;padding:24px;text-align:center}p{max-width:32ch;color:#666}</style>
     <div><h1>You are offline</h1><p>Campus needs a connection to load. It will work again as soon as
     you are back on the network.</p></div>`,
    { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
