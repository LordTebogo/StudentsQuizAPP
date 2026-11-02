const OFFLINE_VERSION = "v72";
const SHELL_CACHE = `nucleocampus-shell-${OFFLINE_VERSION}`;
const DATA_CACHE = `nucleocampus-data-${OFFLINE_VERSION}`;
const EXTERNAL_CACHE = `nucleocampus-external-${OFFLINE_VERSION}`;

// Everything required to open every Arounus workspace is downloaded when
// the app is installed. Keep this list limited to files that ship with the app.
const APP_SHELL = [
  "/static/market-safety.css?v=1", "/static/market-safety.js?v=1",
  "/static/app-traffic.js?v=1", "/static/admin-traffic.js?v=1", "/static/admin-traffic.css?v=1",
  "/", "/learning", "/learning/guide", "/students", "/lecturers",
  "/students/lessons", "/lecturers/lessons", "/lecturers/guide", "/live",
  "/posts", "/community", "/src", "/market", "/admin", "/comrade",
  "/tools/pdf", "/tools/media", "/trust", "/premium", "/reset-password",
  "/static/campus-home.css?v=6", "/static/campus-home.js?v=10", "/static/campus-browse.css?v=3", "/static/campus-redirect.js?v=1",
  "/static/media-compressor.js?v=2", "/static/admin-workspace.css?v=3", "/static/admin-workspace.js?v=3",
  "/static/document-organizer.js",
  "/static/site-footer.css?v=1", "/static/compact-entry.css?v=2",
  "/about", "/static/about.css?v=1", "/static/about.js?v=1", "/static/images/founder-tebogo-manyubele.png",
  "/static/style.css", "/static/ui.css?v=2", "/static/product.css", "/static/theme.css?v=2",
  "/static/brand-intro.css?v=1", "/static/brand-intro.js?v=2",
  "/static/floating-video.css?v=1", "/static/floating-video.js?v=2", "/static/media/campus-intro.jpg",
  "/static/light.css?v=5", "/static/messaging.css",
  "/static/market-sell.css?v=3",
  "/static/lesson-insights.css", "/static/quiz-builder.css",
  "/static/quiz-math-tools.css", "/static/mathlive-fonts.css?v=1",
  "/static/experience.js?v=17", "/static/loading.js", "/static/pwa.js?v=18",
  "/static/module-names.js", "/static/student-module-enrollment.js", "/static/username-suggestion.js", "/static/student-messaging.js",
  "/static/lecturer-messaging.js", "/static/admin-messaging.js",
  "/static/admin-market-ads.js?v=3", "/static/market-auth.js?v=1", "/static/market-sell.js?v=6", "/static/market-contact.js?v=3",
  "/static/market-metrics.js?v=4", "/static/video-access.js?v=5", "/static/media-url.js?v=1",
  "/static/lesson-insights.js", "/static/admin-finance.js?v=1", "/static/quiz-builder.js?v=16",
  "/static/quiz-import-template.csv", "/static/standard-quiz-template.json",
  "/static/fun-quiz-template.json", "/static/fun-quiz-images-scenario-template.json",
  "/static/lesson.json", "/static/manifest.webmanifest",
  "/favicon.ico", "/branding/logo", "/branding/logo?v=metallic-us", "/static/icons/favicon.ico",
  "/static/icons/favicon-96x96.png?v=5", "/static/icons/apple-touch-icon.png?v=5",
  "/static/icons/icon-192x192.png?v=5", "/static/icons/icon-512x512.png?v=5", "/static/icons/og-card.png",
  "/static/icons/bioscientistapp-sticker.png"
];

const LEGACY_PAGE_URLS = {
  'academics.html': '/learning', 'arounus-guide.html': '/learning/guide',
  'student.html': '/students', 'lecturer.html': '/lecturers',
  'lessons_student.html': '/students/lessons', 'lessons_lecturer.html': '/lecturers/lessons',
  'tutor_guide.html': '/lecturers/guide', 'live_lesson.html': '/live',
  'fun.html': '/community', 'index.html': '/', 'marketing.html': '/market',
  'admin.html': '/admin', 'pdf_tools.html': '/tools/pdf',
  'media_compressor.html': '/tools/media', 'trust.html': '/trust',
  'premium.html': '/premium', 'comrade.html': '/comrade',
  'reset-password.html': '/reset-password', 'about.html': '/about'
};

// These libraries are cached when their corresponding workspace first uses
// them. They never delay or block installation of the offline app shell.
const OPTIONAL_EXTERNAL_ASSETS = [
  "https://cdn.jsdelivr.net/npm/livekit-client@2.21.0/dist/livekit-client.umd.min.js",
  "https://unpkg.com/livekit-client@2.21.0/dist/livekit-client.umd.min.js",
  "https://cdn.jsdelivr.net/npm/mathlive@0.110.0/+esm",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
  "https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap"
];

const TRUSTED_EXTERNAL_ORIGINS = new Set([
  "https://cdn.jsdelivr.net", "https://unpkg.com", "https://cdnjs.cloudflare.com",
  "https://fonts.googleapis.com", "https://fonts.gstatic.com",
  "https://tessdata.projectnaptha.com"
]);

const ACCOUNT_HEADERS = [
  "X-Student-Token", "X-Lecturer-Token", "X-Landlord-Token",
  "X-Src-Token", "X-Lecturer-Pin"
];

function offlineJson(message, status = 503) {
  return new Response(JSON.stringify({ detail: message, offline: true }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

async function accountCacheKey(request) {
  const accountValue = ACCOUNT_HEADERS.map(name => request.headers.get(name) || "").join("|");
  if (!accountValue.replaceAll("|", "")) return request;
  const bytes = new TextEncoder().encode(accountValue);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const accountHash = [...new Uint8Array(digest)].slice(0, 12).map(value => value.toString(16).padStart(2, "0")).join("");
  const url = new URL(request.url);
  url.searchParams.set("__offline_account", accountHash);
  return new Request(url.href, { method: "GET" });
}

async function cacheResponse(cacheName, key, response) {
  if (!response || !response.ok || response.status === 206) return response;
  const directive = response.headers.get("Cache-Control") || "";
  if (/no-store/i.test(directive)) return response;
  try {
    await (await caches.open(cacheName)).put(key, response.clone());
  } catch (_) {
    // A full device cache must never turn a successful online request into an error.
  }
  return response;
}

async function networkFirst(request, cacheName, key = request) {
  try {
    const response = await fetch(request);
    return await cacheResponse(cacheName, key, response);
  } catch (_) {
    return (await caches.match(key)) || null;
  }
}

async function cachedExternal(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    try { await (await caches.open(EXTERNAL_CACHE)).put(request, response.clone()); } catch (_) {}
  }
  return response;
}

self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(shell => shell.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const current = new Set([SHELL_CACHE, DATA_CACHE, EXTERNAL_CACHE]);
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("nucleocampus-") && !current.has(key)).map(key => caches.delete(key)));
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET") {
    if (url.origin !== self.location.origin) return;
    event.respondWith(fetch(request).catch(() => offlineJson("This action needs an internet connection. Your current page and unsaved entries are still available.")));
    return;
  }

  // Let the browser stream video (including range requests) without saving
  // an entire promotional video in the installed app's offline cache.
  if (url.origin === self.location.origin && url.pathname === '/static/media/campus-intro.mp4') return;

  if (url.origin !== self.location.origin) {
    if (TRUSTED_EXTERNAL_ORIGINS.has(url.origin)) {
      event.respondWith(cachedExternal(request).catch(() => new Response("", { status: 503 })));
    }
    return;
  }

  if (request.mode === "navigate") {
    const legacyName = url.pathname.startsWith('/static/') ? url.pathname.slice('/static/'.length) : '';
    if (Object.hasOwn(LEGACY_PAGE_URLS, legacyName)) {
      event.respondWith(Response.redirect(new URL(LEGACY_PAGE_URLS[legacyName] + url.search, url.origin), 308));
      return;
    }
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        if (preload) return await cacheResponse(SHELL_CACHE, request, preload);
        const online = await fetch(request);
        return await cacheResponse(SHELL_CACHE, request, online);
      } catch (_) {
        return (await caches.match(request, { ignoreSearch: true }))
          || (await caches.match(url.pathname, { ignoreSearch: true }))
          || (await caches.match("/"));
      }
    })());
    return;
  }

  const isShellAsset = url.pathname === "/favicon.ico"
    || url.pathname === "/branding/logo"
    || url.pathname.startsWith("/static/");
  if (isShellAsset) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      return (await networkFirst(request, SHELL_CACHE)) || offlineJson("This app file is not available offline.");
    })());
    return;
  }

  // Previously viewed profiles, modules, quizzes, lessons, results, images and
  // public content are refreshed online and reused when there is no connection.
  event.respondWith((async () => {
    const key = await accountCacheKey(request);
    const response = await networkFirst(request, DATA_CACHE, key);
    return response || offlineJson("You are offline and this content has not been downloaded on this device yet.");
  })());
});

self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) { payload = {}; }
  const title = payload.title || "Arounus";
  const options = {
    body: payload.body || "You have a new Arounus update.",
    icon: "/static/icons/icon-192x192.png?v=5",
    badge: "/static/icons/favicon-96x96.png?v=5",
    tag: payload.tag || "nucleocampus-update",
    renotify: true,
    data: { url: payload.url || "/students" }
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
