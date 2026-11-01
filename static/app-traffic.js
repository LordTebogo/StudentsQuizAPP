(() => {
  // Administration itself does not add to the app's visitor totals.
  if (/^\/admin(?:\/|$)/.test(location.pathname) || location.pathname === '/static/admin.html') return;
  let pending = false;
  let lastSent = 0;
  async function report() {
    if (document.visibilityState !== 'visible' || !navigator.onLine || pending || Date.now() - lastSent < 30000) return;
    pending = true;
    try {
      const send = () => document.visibilityState === 'visible' && navigator.onLine
        ? fetch('/traffic/heartbeat', { method: 'POST', credentials: 'same-origin', cache: 'no-store' }) : null;
      // Let the first tab receive its cookie before another tab's first report.
      const response = navigator.locks ? await navigator.locks.request('arounus-traffic', send) : await send();
      if (response?.ok) lastSent = Date.now();
    } catch (_) { /* Traffic reporting must never interrupt using the app. */ }
    finally { pending = false; }
  }
  report();
  window.setInterval(report, 60000);
  document.addEventListener('visibilitychange', report);
  window.addEventListener('pageshow', report);
  window.addEventListener('online', report);
})();
