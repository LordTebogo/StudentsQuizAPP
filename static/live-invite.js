/* Shared, same-origin navigation for classroom invitations. */
(function (root) {
  const roomPattern = /^[A-Z0-9_-]{4,32}$/;

  function roomCode(value) {
    const code = String(value || '').trim().toUpperCase();
    return roomPattern.test(code) ? code : '';
  }

  function destination(value, origin) {
    if (!value || typeof value !== 'string') return '';
    try {
      const url = new URL(value, origin);
      if (url.origin !== origin || !['/live', '/static/live_lesson.html'].includes(url.pathname)) return '';
      const code = roomCode(url.searchParams.get('room'));
      return code ? `/live?room=${encodeURIComponent(code)}` : '';
    } catch (_) {
      return '';
    }
  }

  function loginUrl(location) {
    const next = destination(location.href, location.origin);
    const params = new URLSearchParams({role: 'learner'});
    if (next) params.set('next', next);
    return `/static/index.html?${params}`;
  }

  function postLoginUrl(location) {
    return destination(new URLSearchParams(location.search).get('next'), location.origin) || '/static/student.html';
  }

  function shareUrl(origin, value) {
    const code = roomCode(value);
    return code ? `${origin}/live?room=${encodeURIComponent(code)}` : '';
  }

  const api = {roomCode, destination, loginUrl, postLoginUrl, shareUrl};
  root.NucleoLiveInvite = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
