const {JSDOM} = require('jsdom');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const metrics = fs.readFileSync(path.join(__dirname, '../static/market-metrics.js'), 'utf8');
const videos = fs.readFileSync(path.join(__dirname, '../static/video-access.js'), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

test('opening the same product repeatedly records one view and ratings update in place', async () => {
  const dom = new JSDOM('<html><head></head><body><article class="campus-card" data-market-kind="adverts" data-market-id="4" data-market-views="0" data-market-rating-count="0" data-view-on-open="true"><div class="campus-card-body"><button data-offer="offer-4">View</button></div></article></body></html>', {url:'https://arounus.test', runScripts:'outside-only'});
  const w = dom.window; let views = 0;
  w.fetch = async (url, options) => {
    if (url.endsWith('/view')) { views++; return {ok:true, json:async()=>({views:1,new_view:true})}; }
    if (url.endsWith('/rating')) return {ok:true,json:async()=>({rating:5,rating_count:1,your_rating:5})};
    throw new Error(url);
  };
  w.sessionStorage.setItem('studentToken', 'test-token');
  w.eval(metrics); await tick();
  w.document.querySelector('[data-offer]').click();
  w.document.querySelector('[data-offer]').click();
  await tick();
  assert.equal(views, 1);
  assert.match(w.document.querySelector('.market-metrics').textContent, /1 unique views/);
  w.document.querySelector('[data-stars="5"]').click(); await tick();
  assert.match(w.document.querySelector('.market-metrics').textContent, /★ 5 \(1\)/);
});

test('video uses custom controls and asks for premium on higher quality', async () => {
  const dom = new JSDOM('<html><head></head><body><video controls data-free-video="https://example.test/480.mp4" data-video-kind="advert" data-video-id="4" data-premium-available="true"></video></body></html>', {url:'https://arounus.test', runScripts:'outside-only'});
  const w = dom.window;
  w.HTMLMediaElement.prototype.pause = () => {};
  w.HTMLMediaElement.prototype.load = () => {};
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  w.eval(videos); await tick();
  const video = w.document.querySelector('video');
  assert.equal(video.hasAttribute('src'), false);
  assert.equal(video.hasAttribute('controls'), false);
  assert.equal(video.getAttribute('controlslist'), 'nodownload noplaybackrate');
  assert.equal(video.hasAttribute('disablepictureinpicture'), false);
  assert.equal(w.document.querySelector('.arounus-player button[aria-label="Video settings"]').textContent, '⚙');
  w.document.querySelector('.arounus-player button[aria-label="Video settings"]').click();
  w.document.querySelector('.premium-quality').click();
  assert.match(w.document.querySelector('.arounus-player-notice').textContent, /Join Premium/);
  assert.equal(video.hasAttribute('src'), false);
  w.document.querySelector('.arounus-player button[aria-label="Play video"]').click();
  assert.equal(video.src, 'https://example.test/480.mp4');
});

test('approved premium access opens the protected HD source from settings', async () => {
  const dom = new JSDOM('<html><head></head><body><video controls data-free-video="https://example.test/480.mp4" data-video-kind="lesson" data-video-id="9" data-premium-available="true"></video></body></html>', {url:'https://arounus.test', runScripts:'outside-only'});
  const w = dom.window;
  w.HTMLMediaElement.prototype.pause = () => {};
  w.HTMLMediaElement.prototype.load = () => {};
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  w.sessionStorage.setItem('studentToken', 'approved-token');
  w.fetch = async (url, options) => {
    assert.equal(url, '/media/premium/lesson/9');
    assert.equal(options.headers['X-Student-Token'], 'approved-token');
    return {ok:true, status:200, json:async()=>({url:'https://example.test/protected-hd.mp4'})};
  };
  w.eval(videos); await tick();
  w.document.querySelector('[aria-label="Video settings"]').click();
  w.document.querySelector('.premium-quality').click();
  await tick();
  assert.equal(w.document.querySelector('video').src, 'https://example.test/protected-hd.mp4');
  assert.equal(w.document.querySelector('.premium-quality').getAttribute('aria-checked'), 'true');
});

test('video volume, full screen and picture in picture controls can enter and exit', async () => {
  const dom = new JSDOM('<html><head></head><body><video data-free-video="https://example.test/480.mp4"></video></body></html>', {url:'https://arounus.test', runScripts:'outside-only'});
  const w = dom.window;
  w.HTMLMediaElement.prototype.pause = () => {};
  w.HTMLMediaElement.prototype.load = () => {};
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  let autoCloseVolume;
  w.setTimeout = callback => { autoCloseVolume = callback; return 1; };
  w.clearTimeout = () => {};
  let fullscreenElement = null;
  Object.defineProperty(w.document, 'fullscreenElement', {get:()=>fullscreenElement});
  w.HTMLElement.prototype.requestFullscreen = async function () { fullscreenElement = this; w.document.dispatchEvent(new w.Event('fullscreenchange')); };
  w.document.exitFullscreen = async () => { fullscreenElement = null; w.document.dispatchEvent(new w.Event('fullscreenchange')); };
  let pipElement = null;
  Object.defineProperty(w.document, 'pictureInPictureElement', {get:()=>pipElement});
  w.HTMLVideoElement.prototype.requestPictureInPicture = async function () { pipElement = this; this.dispatchEvent(new w.Event('enterpictureinpicture')); };
  w.document.exitPictureInPicture = async () => { const video = pipElement; pipElement = null; video.dispatchEvent(new w.Event('leavepictureinpicture')); };
  w.eval(videos); await tick();
  const video = w.document.querySelector('video');
  const panel = w.document.querySelector('.arounus-player-volume-panel');
  assert.equal(panel.hidden, true);
  const speaker = w.document.querySelector('[aria-label="Volume controls"]');
  speaker.click();
  assert.equal(panel.hidden, false);
  const slider = w.document.querySelector('[aria-label="Volume"]');
  slider.value = '25'; slider.dispatchEvent(new w.Event('input'));
  assert.equal(video.volume, 0.25);
  w.document.querySelector('[aria-label="Mute video"]').click();
  assert.equal(video.muted, true);
  w.document.querySelector('[aria-label="Unmute video"]').click();
  assert.equal(video.muted, false);
  assert.equal(video.volume, 0.25);
  autoCloseVolume();
  assert.equal(panel.hidden, true);
  speaker.click();
  assert.equal(panel.hidden, false);
  w.document.dispatchEvent(new w.Event('pointerdown'));
  assert.equal(panel.hidden, true);
  const fullButton = w.document.querySelector('[aria-label="Enter full screen"]');
  fullButton.click(); await tick();
  assert.equal(fullscreenElement, w.document.querySelector('.arounus-player'));
  w.document.querySelector('[aria-label="Exit full screen"]').click(); await tick();
  assert.equal(fullscreenElement, null);
  w.document.querySelector('[aria-label="Play video"]').click();
  w.document.querySelector('[aria-label="Enter picture in picture"]').click(); await tick();
  assert.equal(pipElement, video);
  w.document.querySelector('[aria-label="Exit picture in picture"]').click(); await tick();
  assert.equal(pipElement, null);
});
