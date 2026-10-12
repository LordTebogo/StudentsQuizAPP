(() => {
  const style = document.createElement('style');
  style.textContent = '.arounus-video-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:8px 0}.arounus-video-actions button{border:1px solid #bfd6d2;border-radius:10px;background:#f3faf7;color:#17313a;padding:8px 12px;font:inherit;cursor:pointer}.arounus-video-actions button:hover{background:#e2f4ec}.arounus-video-actions span{font-size:.82rem;color:var(--muted,#526675)}';
  document.head.appendChild(style);
  function setup(video) {
    if (!video?.dataset.freeVideo) return;
    video.removeAttribute('src');
    video.pause();
    video.preload = 'none';
    video.load();
    video.previousElementSibling?.classList.contains('arounus-video-actions') && video.previousElementSibling.remove();
    const controls = document.createElement('div');
    controls.className = 'arounus-video-actions';
    const free = document.createElement('button');
    free.type = 'button'; free.textContent = '▶ Play · up to 480p';
    const note = document.createElement('span');
    free.addEventListener('click', () => { video.src = video.dataset.freeVideo; video.load(); video.play().catch(() => {}); note.textContent = '480p or lower'; });
    controls.appendChild(free);
    if (video.dataset.premiumAvailable === 'true') {
      const premium = document.createElement('button');
      premium.type = 'button'; premium.textContent = '▶ HD · Premium';
      premium.addEventListener('click', async () => {
        const token = sessionStorage.getItem('studentToken');
        if (!token) { note.textContent = 'Sign in as a learner for premium access.'; return; }
        premium.disabled = true; note.textContent = 'Opening HD video…';
        try {
          const response = await fetch(`/media/premium/${video.dataset.videoKind}/${video.dataset.videoId}`, {headers:{'X-Student-Token':token}, cache:'no-store'});
          const result = await response.json();
          if (!response.ok) throw new Error(result.detail || 'HD video unavailable');
          video.src = result.url; video.load(); await video.play(); note.textContent = 'Premium HD';
        } catch (error) { note.textContent = error.message; }
        finally { premium.disabled = false; }
      });
      controls.appendChild(premium);
    }
    controls.appendChild(note);
    video.before(controls);
    video.dataset.videoReady = 'true';
  }
  window.arounusSetupVideo = setup;
  let queued = false;
  function scan() { queued = false; document.querySelectorAll('video[data-free-video]:not([data-video-ready])').forEach(setup); }
  new MutationObserver(() => { if (!queued) { queued = true; queueMicrotask(scan); } }).observe(document.body, {childList:true,subtree:true});
  scan();
})();
