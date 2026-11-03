(() => {
  const token = () => sessionStorage.getItem('marketToken') || sessionStorage.getItem('landlordToken') || '';
  const supported = () => 'Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator;
  const installed = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  let previousToken = token(), queue = Promise.resolve(), asking = null, askedOnGesture = false, installationSeen = false;
  let note = 'Allow message notifications when Arounus asks during installation or first use.';
  let unreadBusy = false;

  function paintNote(text = note) {
    note = text;
    document.querySelectorAll('[data-market-notification-note]').forEach(node => { node.textContent = note; });
  }
  function paintUnread(count) {
    document.querySelectorAll('button[data-market-messages]').forEach(button => {
      let badge = button.querySelector('.market-unread-badge');
      if (!badge) { badge = document.createElement('span'); badge.className = 'market-unread-badge'; button.append(badge); }
      badge.hidden = count === 0; badge.textContent = count > 99 ? '99+' : String(count);
      button.setAttribute('aria-label', count ? `My market messages, ${count} unread` : 'My market messages');
    });
  }
  async function readyRegistration() {
    let timer;
    try {
      return await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The app is still preparing notifications. Reopen it to finish setup.')), 15000); })]);
    } finally { clearTimeout(timer); }
  }
  async function api(path, accountToken, method = 'GET', body) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(path, {method, cache:'no-store', headers:{'Content-Type':'application/json','X-Landlord-Token':accountToken}, ...(body ? {body:JSON.stringify(body)} : {}), signal:controller.signal});
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Message notifications could not connect. Reopen the app to retry.');
      return data;
    } finally { clearTimeout(timer); }
  }
  function serverKey(value) {
    const encoded = (value + '='.repeat((4 - value.length % 4) % 4)).replace(/-/g,'+').replace(/_/g,'/');
    return Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  }
  async function syncNow() {
    if (!supported()) { paintNote('This browser cannot deliver app message notifications. Your messages are still available in the inbox.'); return; }
    if (Notification.permission === 'denied') { paintNote('Notifications are blocked on this device. Allow Arounus notifications in your app or browser settings to receive message alerts.'); return; }
    if (Notification.permission !== 'granted') { paintNote(); return; }
    const accountToken = token();
    if (!accountToken) return;
    const response = await fetch('/notifications/config', {cache:'no-store'});
    const config = response.ok ? await response.json() : {};
    if (!config.enabled || !config.public_key) { paintNote('Message notifications are not available on the server right now. New messages still appear in your inbox.'); return; }
    const registration = await readyRegistration();
    let subscription = await registration.pushManager.getSubscription();
    if (accountToken !== token()) return;
    if (!subscription) subscription = await registration.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:serverKey(config.public_key)});
    if (accountToken !== token()) return;
    await api('/marketing/notifications/subscribe', accountToken, 'POST', subscription.toJSON());
    if (accountToken === token()) paintNote('Message notifications are enabled on this device.');
  }
  function sync() {
    queue = queue.catch(() => {}).then(syncNow).catch(() => paintNote('Message notifications could not connect. We will retry when you reopen the app.'));
    return queue;
  }
  function requestPermission(fromGesture = true) {
    if (!supported()) return Promise.resolve('unsupported');
    if (Notification.permission === 'granted') { sync(); return Promise.resolve('granted'); }
    if (Notification.permission === 'denied') { paintNote('Notifications are blocked on this device. Allow Arounus notifications in your app or browser settings to receive message alerts.'); return Promise.resolve('denied'); }
    if (asking) return asking;
    if (fromGesture && askedOnGesture) return Promise.resolve(Notification.permission);
    if (fromGesture) askedOnGesture = true;
    try {
      // Called directly during an app interaction; never request permission from a timer.
      asking = Promise.resolve(Notification.requestPermission()).then(permission => {
        if (permission === 'granted') sync();
        else if (permission === 'denied') paintNote('Notifications are blocked on this device. You can allow them later in your app or browser settings.');
        return permission;
      }).finally(() => { asking = null; });
      return asking;
    } catch (_) { asking = null; return Promise.resolve('default'); }
  }
  async function detach(accountToken) {
    if (!accountToken || !supported()) return;
    try {
      const registration = await readyRegistration();
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) await api('/marketing/notifications/subscribe', accountToken, 'DELETE', {endpoint:subscription.endpoint});
    } catch (_) { /* Keep account sign-out usable while offline. */ }
  }
  async function refreshUnread() {
    if (unreadBusy || document.visibilityState === 'hidden') return;
    const accountToken = token();
    if (!accountToken) { paintUnread(0); return; }
    unreadBusy = true;
    try {
      const result = await api('/marketing/provider/messages/unread', accountToken);
      if (accountToken === token()) paintUnread(Math.max(0, Math.trunc(Number(result.count) || 0)));
    } catch (_) { /* An offline badge does not interrupt browsing or sign-in. */ }
    finally { unreadBusy = false; }
  }
  document.addEventListener('market-session-changed', () => {
    const nextToken = token(), oldToken = previousToken;
    previousToken = nextToken;
    if (oldToken !== nextToken) paintUnread(0);
    if (oldToken && oldToken !== nextToken) queue = queue.catch(() => {}).then(() => detach(oldToken));
    sync(); refreshUnread();
  });
  document.addEventListener('market-messages-updated', refreshUnread);
  document.addEventListener('market-notifications-view', () => { paintNote(); refreshUnread(); });
  document.addEventListener('click', () => {
    if (supported() && (installed() || installationSeen) && Notification.permission === 'default') requestPermission(true).catch(() => {});
  });
  window.addEventListener('appinstalled', () => {
    installationSeen = true;
    // Some browsers can ask here; others require the first tap in the installed app.
    requestPermission(false).catch(() => {});
  });
  window.addEventListener('load', () => { sync(); refreshUnread(); });
  window.addEventListener('online', () => { sync(); refreshUnread(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'hidden') { sync(); refreshUnread(); } });
  setInterval(refreshUnread, 30000);
  window.ArounusMessageNotifications = {requestPermission, sync};
})();
