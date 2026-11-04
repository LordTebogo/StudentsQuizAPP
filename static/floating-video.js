(() => {
  const player = document.getElementById('campusVideo');
  if (!player) return;
  const video = player.querySelector('video');
  const dismissalKey = 'arounusIntroDismissed';
  try {
    if (localStorage.getItem(dismissalKey) === '1') {
      player.hidden = true;
      return;
    }
  } catch (_) { /* The video still works when browser storage is unavailable. */ }
  if (video.dataset.videoSrc) video.src = video.dataset.videoSrc;
  const drag = player.querySelector('[data-video-drag]');
  const close = player.querySelector('[data-video-close]');
  const play = player.querySelector('[data-video-play]');
  const mute = player.querySelector('[data-video-mute]');
  const fullscreen = player.querySelector('[data-video-fullscreen]');
  const captions = player.querySelector('[data-video-captions]');
  const seek = player.querySelector('[data-video-seek]');
  const notice = player.querySelector('[data-video-notice]');
  const error = player.querySelector('[data-video-error]');
  const icons = {
    play: '<path d="m8 5 11 7-11 7Z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    muted: '<path d="M11 5 6 9H3v6h3l5 4ZM16 9l5 6m0-6-5 6"/>',
    sound: '<path d="M11 5 6 9H3v6h3l5 4ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
    expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    collapse: '<path d="M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5"/>'
  };
  function control(button, label, icon) {
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[icon]}</svg>`;
  }
  function sync() {
    control(play, video.paused ? 'Play video' : 'Pause video', video.paused ? 'play' : 'pause');
    const silent = video.muted || video.volume === 0;
    control(mute, silent ? 'Unmute video' : 'Mute video', silent ? 'muted' : 'sound');
    mute.setAttribute('aria-pressed', String(!silent));
    const expanded = document.fullscreenElement === player;
    control(fullscreen, expanded ? 'Exit full screen' : 'Full screen', expanded ? 'collapse' : 'expand');
  }
  async function start() {
    try { await video.play(); notice.hidden = true; }
    catch (_) {
      notice.textContent = 'Tap Play to watch with sound.';
      notice.hidden = false;
    }
    sync();
  }
  play.addEventListener('click', () => video.paused ? start() : video.pause());
  mute.addEventListener('click', () => {
    video.muted = !(video.muted || video.volume === 0);
    if (!video.muted && video.volume === 0) video.volume = 1;
    sync();
  });
  captions.addEventListener('click', () => {
    const track = video.textTracks[0];
    if (!track) return;
    const showing = track.mode !== 'showing';
    track.mode = showing ? 'showing' : 'hidden';
    captions.setAttribute('aria-label', showing ? 'Hide captions' : 'Show captions');
    captions.setAttribute('aria-pressed', String(showing));
  });
  fullscreen.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement === player) await document.exitFullscreen();
      else if (player.requestFullscreen) await player.requestFullscreen();
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
      else throw new Error('Fullscreen unavailable');
    } catch (_) {
      notice.textContent = 'Full screen is unavailable in this browser.';
      notice.hidden = false;
    }
  });
  close.addEventListener('click', async () => {
    try { localStorage.setItem(dismissalKey, '1'); } catch (_) {}
    video.pause();
    if (document.fullscreenElement === player) {
      try { await document.exitFullscreen(); } catch (_) {}
    }
    player.hidden = true;
    // Stop downloading as soon as the visitor dismisses the video.
    video.removeAttribute('src');
    video.load();
  });
  ['play', 'pause', 'volumechange'].forEach(type => video.addEventListener(type, sync));
  const updateSeek = () => {
    seek.disabled = !Number.isFinite(video.duration) || video.duration <= 0;
    if (!seek.disabled) {
      seek.value = String(video.currentTime / video.duration * 100);
      seek.setAttribute('aria-valuetext', `${Math.floor(video.currentTime)} of ${Math.floor(video.duration)} seconds`);
    }
  };
  ['timeupdate', 'loadedmetadata', 'durationchange'].forEach(type => video.addEventListener(type, updateSeek));
  seek.addEventListener('input', () => {
    if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Number(seek.value) / 100 * video.duration;
  });
  video.addEventListener('error', () => {
    if (player.hidden) return;
    error.hidden = false;
    notice.hidden = true;
    play.disabled = true;
    seek.disabled = true;
  });
  let position = null;
  let gesture = null;
  function place(x, y) {
    const bounds = player.getBoundingClientRect();
    const view = window.visualViewport;
    const left = view?.offsetLeft || 0;
    const top = view?.offsetTop || 0;
    const width = view?.width || window.innerWidth;
    const height = view?.height || window.innerHeight;
    position = {
      x: Math.max(left + 8, Math.min(x, left + width - bounds.width - 8)),
      y: Math.max(top + 8, Math.min(y, top + height - bounds.height - 8))
    };
    player.style.left = `${position.x}px`;
    player.style.top = `${position.y}px`;
    player.style.right = 'auto';
    player.style.bottom = 'auto';
  }
  drag.addEventListener('pointerdown', event => {
    if (event.button !== 0 || document.fullscreenElement === player) return;
    const bounds = player.getBoundingClientRect();
    gesture = {id: event.pointerId, x: event.clientX - bounds.left, y: event.clientY - bounds.top};
    drag.setPointerCapture(event.pointerId);
    player.classList.add('is-dragging');
    event.preventDefault();
  });
  drag.addEventListener('pointermove', event => {
    if (gesture?.id === event.pointerId) place(event.clientX - gesture.x, event.clientY - gesture.y);
  });
  function stopDrag(event) {
    if (gesture?.id !== event.pointerId) return;
    gesture = null;
    player.classList.remove('is-dragging');
    if (drag.hasPointerCapture(event.pointerId)) drag.releasePointerCapture(event.pointerId);
  }
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => drag.addEventListener(type, stopDrag));
  drag.addEventListener('keydown', event => {
    const steps = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]};
    if (!steps[event.key] || document.fullscreenElement === player) return;
    event.preventDefault();
    const bounds = player.getBoundingClientRect();
    const step = event.shiftKey ? 40 : 16;
    place(bounds.left + steps[event.key][0] * step, bounds.top + steps[event.key][1] * step);
  });
  function reflow() {
    if (position && !document.fullscreenElement) place(position.x, position.y);
  }
  window.addEventListener('resize', reflow);
  window.visualViewport?.addEventListener('resize', reflow);
  window.visualViewport?.addEventListener('scroll', reflow);
  document.addEventListener('fullscreenchange', () => { sync(); reflow(); });
  // Try autoplay with sound. Browsers that block it keep the Play action available.
  video.muted = false;
  sync();
  start();
})();
