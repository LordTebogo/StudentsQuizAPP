const CACHE_NAME = "quizmark-static-v3";
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

self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) { payload = {}; }
  const title = payload.title || "QuizMark";
  const options = {
    body: payload.body || "You have a new QuizMark update.",
    icon: "/branding/logo",
    badge: "/branding/logo",
    tag: payload.tag || "quizmark-update",
    renotify: true,
    data: { url: payload.url || "/static/student.html" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const destination = new URL(event.notification.data?.url || "/static/student.html", self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(windows => {
    const existing = windows.find(client => client.url.startsWith(self.location.origin));
    return existing ? existing.focus() : clients.openWindow(destination);
  }));
});
