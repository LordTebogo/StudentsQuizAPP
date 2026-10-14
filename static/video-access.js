(() => {
  const style = document.createElement('style');
  style.textContent = `
    .arounus-player{position:relative;width:100%;overflow:hidden;border-radius:10px;background:#101a1b;color:#fff}
    .arounus-player video{display:block;width:100%;max-height:70vh;cursor:pointer}
    .arounus-player:fullscreen{display:flex;align-items:center;justify-content:center;width:100vw;height:100vh;border-radius:0;background:#000}
    .arounus-player:fullscreen video{width:100%;height:100%;max-height:none;object-fit:contain}
    .arounus-player-bar{position:absolute;right:0;bottom:0;left:0;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px;background:linear-gradient(transparent,rgba(0,0,0,.9));color:#fff}
    .arounus-player-bar button{flex:none;min-width:36px;min-height:36px;padding:5px 8px;border:0;border-radius:7px;background:rgba(0,0,0,.5);color:#fff;font:inherit;cursor:pointer}
    .arounus-player-bar>button:hover,.arounus-player-bar>button:focus-visible,.arounus-player-settings>button:hover,.arounus-player-settings>button:focus-visible{background:#087f70;outline:2px solid #fff;outline-offset:2px}
    .arounus-player-bar input[type=range]{flex:1;min-width:35px;accent-color:#50dbc0;cursor:pointer}
    .arounus-player-bar .arounus-player-volume{flex:0 0 76px;min-width:55px}
    .arounus-player-time{flex:none;font:12px/1.2 sans-serif;white-space:nowrap}
    .arounus-player-settings{position:relative;flex:none}
    .arounus-player-menu{position:absolute;right:0;bottom:44px;z-index:2;min-width:190px;padding:8px;border:1px solid #526b65;border-radius:10px;background:#fff;color:#19312e;box-shadow:0 12px 26px rgba(0,0,0,.35)}
    .arounus-player-menu[hidden],.arounus-player-notice[hidden]{display:none}
    .arounus-player-menu strong{display:block;padding:5px 8px;font-size:.8rem}
    .arounus-player-menu button{display:block;width:100%;margin:2px 0;text-align:left;background:transparent;color:#19312e}
    .arounus-player-menu button:hover,.arounus-player-menu button:focus-visible{background:#e5f5ed;color:#19312e;outline:2px solid #087f70}
    .arounus-player-menu button[aria-checked=true]{font-weight:700;background:#e5f5ed}
    .arounus-player-menu button.premium-quality{color:#a01f35;font-weight:700}
    .arounus-player-menu button.premium-quality:hover,.arounus-player-menu button.premium-quality:focus-visible{background:#fff0f2;color:#842539}
    .arounus-player-notice{position:absolute;right:12px;bottom:64px;left:12px;z-index:1;margin:0;padding:8px 11px;border-radius:8px;background:rgba(0,0,0,.85);color:#fff;font-size:.85rem}
    @media(max-width:540px){.arounus-player-bar{flex-wrap:wrap;gap:4px;padding:8px}.arounus-player-bar button{min-width:32px;padding:4px}.arounus-player-time{font-size:10px}.arounus-player-bar .arounus-player-volume{flex:0 0 58px}}
  `;
  document.head.appendChild(style);

  const formatTime = seconds => Number.isFinite(seconds)
    ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '0:00';

  function setup(video) {
    if (!video?.dataset.freeVideo) return;
    video._arounusEvents?.abort();
    const events = new AbortController();
    video._arounusEvents = events;
    const on = (element, name, callback) => element.addEventListener(name, callback, {signal:events.signal});

    video.pause();
    video.removeAttribute('src');
    video.removeAttribute('controls');
    video.setAttribute('controlslist', 'nodownload noplaybackrate');
    video.removeAttribute('disablepictureinpicture');
    video.disablePictureInPicture = false;
    video.setAttribute('disableremoteplayback', '');
    video.preload = 'none';
    video.playsInline = true;
    video.load();

    let player = video.parentElement;
    if (!player?.classList.contains('arounus-player')) {
      player = document.createElement('div');
      player.className = 'arounus-player';
      video.before(player);
      player.appendChild(video);
    }
    player.querySelector('.arounus-player-bar')?.remove();
    player.querySelector('.arounus-player-notice')?.remove();

    const bar = document.createElement('div'); bar.className = 'arounus-player-bar';
    const play = document.createElement('button'); play.type = 'button'; play.textContent = '▶'; play.setAttribute('aria-label', 'Play video');
    const seek = document.createElement('input'); seek.type = 'range'; seek.min = '0'; seek.max = '100'; seek.value = '0'; seek.setAttribute('aria-label', 'Video position');
    const clock = document.createElement('span'); clock.className = 'arounus-player-time'; clock.textContent = '0:00 / 0:00';
    const mute = document.createElement('button'); mute.type = 'button'; mute.textContent = '🔊'; mute.setAttribute('aria-label', 'Mute video');
    const volume = document.createElement('input'); volume.type = 'range'; volume.min = '0'; volume.max = '100'; volume.value = String(Math.round(video.volume * 100)); volume.className = 'arounus-player-volume'; volume.setAttribute('aria-label', 'Volume');
    const pip = document.createElement('button'); pip.type = 'button'; pip.textContent = '▣'; pip.setAttribute('aria-label', 'Enter picture in picture'); pip.title = 'Picture in picture';
    const fullscreen = document.createElement('button'); fullscreen.type = 'button'; fullscreen.textContent = '⤢'; fullscreen.setAttribute('aria-label', 'Enter full screen'); fullscreen.title = 'Full screen';
    const settings = document.createElement('div'); settings.className = 'arounus-player-settings';
    const gear = document.createElement('button'); gear.type = 'button'; gear.textContent = '⚙'; gear.setAttribute('aria-label', 'Video settings'); gear.setAttribute('aria-expanded', 'false');
    const menu = document.createElement('div'); menu.className = 'arounus-player-menu'; menu.hidden = true;
    const heading = document.createElement('strong'); heading.textContent = 'Quality';
    const free = document.createElement('button'); free.type = 'button'; free.textContent = '480p · Free'; free.setAttribute('aria-checked', 'true');
    const premium = document.createElement('button'); premium.type = 'button'; premium.className = 'premium-quality'; premium.textContent = 'HD (above 480p) · Premium'; premium.setAttribute('aria-checked', 'false');
    menu.append(heading, free, premium); settings.append(gear, menu);
    const notice = document.createElement('p'); notice.className = 'arounus-player-notice'; notice.hidden = true; notice.setAttribute('role', 'status');
    bar.append(play, seek, clock, mute, volume, settings, pip, fullscreen); player.append(bar, notice);

    const showNotice = message => { notice.textContent = message; notice.hidden = !message; };
    const closeMenu = () => { menu.hidden = true; gear.setAttribute('aria-expanded', 'false'); };
    const select = (button, url) => {
      const position = video.currentTime || 0;
      const wasPlaying = !video.paused;
      if (video.src !== url) {
        video.src = url;
        video.load();
        if (position) video.addEventListener('loadedmetadata', () => { video.currentTime = Math.min(position, video.duration || position); }, {once:true, signal:events.signal});
      }
      free.setAttribute('aria-checked', String(button === free));
      premium.setAttribute('aria-checked', String(button === premium));
      if (wasPlaying) video.play().catch(() => {});
      closeMenu();
    };
    const togglePlay = () => {
      if (video.paused) {
        if (!video.src) select(free, video.dataset.freeVideo);
        video.play().catch(() => showNotice('This video could not play. Please try again.'));
      } else video.pause();
    };
    on(play, 'click', togglePlay);
    on(video, 'click', togglePlay);
    on(video, 'play', () => { play.textContent = '❚❚'; play.setAttribute('aria-label', 'Pause video'); });
    on(video, 'pause', () => { play.textContent = '▶'; play.setAttribute('aria-label', 'Play video'); });
    on(video, 'timeupdate', () => { clock.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`; seek.value = video.duration ? String(Math.round(video.currentTime / video.duration * 100)) : '0'; });
    on(video, 'loadedmetadata', () => { clock.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`; });
    on(seek, 'input', () => { if (video.duration) video.currentTime = Number(seek.value) / 100 * video.duration; });
    let previousVolume = video.volume || 0.5;
    const syncVolume = () => {
      const level = video.muted ? 0 : video.volume;
      volume.value = String(Math.round(level * 100));
      mute.textContent = level === 0 ? '🔇' : level < 0.5 ? '🔈' : '🔊';
      mute.setAttribute('aria-label', level === 0 ? 'Unmute video' : 'Mute video');
    };
    on(mute, 'click', () => {
      if (video.muted || video.volume === 0) { video.volume = video.volume || previousVolume; video.muted = false; }
      else { previousVolume = video.volume; video.muted = true; }
      syncVolume();
    });
    on(volume, 'input', () => {
      video.volume = Number(volume.value) / 100;
      video.muted = video.volume === 0;
      if (video.volume) previousVolume = video.volume;
      syncVolume();
    });
    on(video, 'volumechange', syncVolume);
    const syncFullscreen = () => {
      const active = document.fullscreenElement === player;
      fullscreen.textContent = active ? '⤡' : '⤢';
      fullscreen.setAttribute('aria-label', active ? 'Exit full screen' : 'Enter full screen');
      fullscreen.title = active ? 'Exit full screen' : 'Full screen';
    };
    on(fullscreen, 'click', async () => {
      try {
        if (document.fullscreenElement === player) await document.exitFullscreen();
        else if (player.requestFullscreen) await player.requestFullscreen();
        else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
        else throw new Error('Full screen is not available on this device.');
        syncFullscreen();
      } catch (error) { showNotice(error.message || 'Full screen is not available on this device.'); }
    });
    on(document, 'fullscreenchange', syncFullscreen);
    const syncPip = () => {
      const active = document.pictureInPictureElement === video || video.webkitPresentationMode === 'picture-in-picture';
      pip.setAttribute('aria-label', active ? 'Exit picture in picture' : 'Enter picture in picture');
      pip.title = active ? 'Exit picture in picture' : 'Picture in picture';
    };
    on(pip, 'click', async () => {
      try {
        if (document.pictureInPictureElement === video) await document.exitPictureInPicture();
        else if (!video.src) throw new Error('Play the video first to use picture in picture.');
        else if (video.requestPictureInPicture) await video.requestPictureInPicture();
        else if (video.webkitSupportsPresentationMode?.('picture-in-picture')) {
          video.webkitSetPresentationMode(video.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
        } else throw new Error('Picture in picture is not available on this device.');
        syncPip();
      } catch (error) { showNotice(error.message || 'Picture in picture is not available on this device.'); }
    });
    on(video, 'enterpictureinpicture', syncPip);
    on(video, 'leavepictureinpicture', syncPip);
    on(video, 'webkitpresentationmodechanged', syncPip);
    on(gear, 'click', () => { menu.hidden = !menu.hidden; gear.setAttribute('aria-expanded', String(!menu.hidden)); });
    on(free, 'click', () => { showNotice(''); select(free, video.dataset.freeVideo); });
    on(premium, 'click', async () => {
      closeMenu();
      if (video.dataset.premiumAvailable !== 'true') { showNotice('Higher quality is not available for this video.'); return; }
      const token = sessionStorage.getItem('studentToken');
      if (!token) { showNotice('Join Premium to see higher quality. Sign in as a learner first.'); return; }
      premium.disabled = true;
      try {
        const response = await fetch(`/media/premium/${encodeURIComponent(video.dataset.videoKind)}/${encodeURIComponent(video.dataset.videoId)}`, {headers:{'X-Student-Token':token},cache:'no-store'});
        const result = await response.json();
        if (response.status === 403) { showNotice('Join Premium to see higher quality.'); return; }
        if (!response.ok || !result.url) throw new Error(result.detail || 'Higher quality is unavailable right now.');
        showNotice(''); select(premium, result.url);
        video.play().catch(() => showNotice('This video could not play. Please try again.'));
      } catch (error) { showNotice(error.message); }
      finally { premium.disabled = false; }
    });
    on(player, 'keydown', event => { if (event.key === 'Escape') closeMenu(); });
    video.dataset.videoReady = 'true';
  }

  window.arounusSetupVideo = setup;
  let queued = false;
  function scan() { queued = false; document.querySelectorAll('video[data-free-video]:not([data-video-ready])').forEach(setup); }
  new MutationObserver(() => { if (!queued) { queued = true; queueMicrotask(scan); } }).observe(document.body, {childList:true,subtree:true});
  scan();
})();
