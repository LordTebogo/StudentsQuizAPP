const CACHE_NAME = "quizmark-static-v2";
const APP_SHELL = [
  "/static/index.html",
  "/static/student.html",
  "/static/lecturer.html",
  "/static/lessons_student.html",
  "/static/lessons_lecturer.html",
  "/static/admin.html",
  "/static/comrade.html",
  "/static/style.css",
  "/static/pwa.js",
  "/static/manifest.webmanifest",
  "/branding/logo"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys
      .filter(key => key !== CACHE_NAME)
      .map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || (url.pathname !== "/branding/logo" && !url.pathname.startsWith("/static/"))) return;
  event.respondWith(
    fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request).then(cached => cached || caches.match("/static/index.html")))
  );
});
