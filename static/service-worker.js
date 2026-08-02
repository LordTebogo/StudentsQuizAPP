const CACHE_NAME = "nucleocampus-static-v7";
const APP_SHELL = [
  "/",
  "/students",
  "/lecturers",
  "/students/lessons",
  "/lecturers/lessons",
  "/admin",
  "/src",
  "/static/style.css",
  "/static/experience.js",
  "/static/loading.js",
  "/static/pwa.js",
  "/static/manifest.webmanifest",
  "/branding/logo"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
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
  if (url.origin !== self.location.origin) return;
  const isAppResource = event.request.mode === "navigate" || url.pathname === "/branding/logo" || url.pathname.startsWith("/static/");
  if (!isAppResource) return;
  event.respondWith(
    fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request).then(cached => cached || caches.match("/")))
  );
});

self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) { payload = {}; }
  const title = payload.title || "NucleoCampus";
  const options = {
    body: payload.body || "You have a new NucleoCampus update.",
    icon: "/branding/logo",
    badge: "/branding/logo",
    tag: payload.tag || "nucleocampus-update",
    renotify: true,
    data: { url: payload.url || "/students" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const destination = new URL(event.notification.data?.url || "/students", self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(windows => {
    const existing = windows.find(client => client.url.startsWith(self.location.origin));
    return existing ? existing.focus() : clients.openWindow(destination);
  }));
});
