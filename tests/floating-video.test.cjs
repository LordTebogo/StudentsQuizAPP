const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const html = fs.readFileSync('static/index.html', 'utf8');
const script = fs.readFileSync('static/floating-video.js', 'utf8');

async function setup(blockAutoplay = false) {
  const dom = new JSDOM(html, {url: 'https://arounus.test/', runScripts: 'outside-only'});
  const w = dom.window;
  const d = w.document;
  const player = d.getElementById('campusVideo');
  const video = player.querySelector('video');
  let paused = true, calls = 0, loads = 0;
  Object.defineProperty(video, 'paused', {get: () => paused});
  Object.defineProperty(video, 'duration', {value: 148});
  video.play = async () => {
    if (blockAutoplay && ++calls === 1) throw new Error('Autoplay blocked');
    paused = false;
    video.dispatchEvent(new w.Event('play'));
  };
  video.pause = () => { paused = true; video.dispatchEvent(new w.Event('pause')); };
  video.load = () => { loads++; };
  const drag = player.querySelector('[data-video-drag]');
  let captured = false;
  drag.setPointerCapture = () => { captured = true; };
  drag.hasPointerCapture = () => captured;
  drag.releasePointerCapture = () => { captured = false; };
  player.getBoundingClientRect = () => ({
    left: parseFloat(player.style.left) || 668, top: parseFloat(player.style.top) || 440,
    width: 340, height: 300
  });
  player.requestFullscreen = async () => {
    Object.defineProperty(d, 'fullscreenElement', {value: player, configurable: true});
    d.dispatchEvent(new w.Event('fullscreenchange'));
  };
  d.exitFullscreen = async () => {
    Object.defineProperty(d, 'fullscreenElement', {value: null, configurable: true});
    d.dispatchEvent(new w.Event('fullscreenchange'));
  };
  w.eval(script);
  await new Promise(setImmediate);
  const click = name => player.querySelector(`[data-video-${name}]`).click();
  return {dom, w, d, player, video, drag, click, loads: () => loads};
}

test('homepage requests autoplay with sound, supports mute and pause, and closes without downloading', async t => {
  const s = await setup(); t.after(() => s.dom.window.close());
  assert.equal(s.video.paused, false);
  assert.equal(s.video.muted, false);
  s.click('mute'); assert.equal(s.video.muted, true);
  s.click('mute'); assert.equal(s.video.muted, false);
  s.click('play'); assert.equal(s.video.paused, true);
  s.click('close');
  assert.equal(s.player.hidden, true);
  assert.equal(s.video.hasAttribute('src'), false);
  assert.equal(s.loads(), 1);
});

test('blocked autoplay leaves an obvious working Play action', async t => {
  const s = await setup(true); t.after(() => s.dom.window.close());
  assert.match(s.player.querySelector('[data-video-notice]').textContent, /Tap Play/);
  assert.equal(s.video.paused, true);
  s.click('play'); await new Promise(setImmediate);
  assert.equal(s.video.paused, false);
  assert.equal(s.video.muted, false);
  assert.equal(s.player.querySelector('[data-video-notice]').hidden, true);
});

test('touch or mouse drag is clamped to screen and remains reachable after resizing', async t => {
  const s = await setup(); t.after(() => s.dom.window.close());
  const pointer = (type, x, y) => s.drag.dispatchEvent(new s.w.MouseEvent(type, {clientX:x, clientY:y, button:0}));
  pointer('pointerdown', 700, 460);
  pointer('pointermove', -100, -200);
  assert.equal(s.player.style.left, '8px'); assert.equal(s.player.style.top, '8px');
  pointer('pointermove', 2000, 2000);
  assert.equal(s.player.style.left, '676px'); assert.equal(s.player.style.top, '460px');
  pointer('pointerup', 2000, 2000);
  Object.defineProperty(s.w, 'innerWidth', {value:390});
  Object.defineProperty(s.w, 'innerHeight', {value:700});
  s.w.dispatchEvent(new s.w.Event('resize'));
  assert.equal(s.player.style.left, '42px'); assert.equal(s.player.style.top, '392px');
  s.drag.dispatchEvent(new s.w.KeyboardEvent('keydown', {key:'ArrowLeft'}));
  assert.equal(s.player.style.left, '26px');
});

test('full screen toggles, closing full screen exits and stops playback', async t => {
  const s = await setup(); t.after(() => s.dom.window.close());
  s.click('fullscreen'); await new Promise(setImmediate);
  assert.equal(s.d.fullscreenElement, s.player);
  assert.equal(s.player.querySelector('[data-video-fullscreen]').getAttribute('aria-label'), 'Exit full screen');
  s.click('close'); await new Promise(setImmediate);
  assert.equal(s.d.fullscreenElement, null);
  assert.equal(s.player.hidden, true); assert.equal(s.video.paused, true);
});

test('seeking updates playback and a failed video offers the supplied YouTube fallback', async t => {
  const s = await setup(); t.after(() => s.dom.window.close());
  s.video.dispatchEvent(new s.w.Event('loadedmetadata'));
  const seek = s.player.querySelector('[data-video-seek]');
  seek.value = '50'; seek.dispatchEvent(new s.w.Event('input'));
  assert.equal(s.video.currentTime, 74);
  s.video.dispatchEvent(new s.w.Event('error'));
  const error = s.player.querySelector('[data-video-error]');
  assert.equal(error.hidden, false);
  assert.equal(error.querySelector('a').href, 'https://www.youtube.com/watch?v=ADFLC6hHawA');
  assert.equal(s.player.querySelector('[data-video-play]').disabled, true);
});

test('captions can be hidden and shown without changing playback', async t => {
  const s = await setup(); t.after(() => s.dom.window.close());
  const track = {mode:'showing'};
  Object.defineProperty(s.video, 'textTracks', {value:[track]});
  s.click('captions'); assert.equal(track.mode, 'hidden');
  s.click('captions'); assert.equal(track.mode, 'showing');
  assert.equal(s.video.paused, false);
});

test('service worker leaves promotional video range requests to the browser', () => {
  const handlers = {};
  const self = {location:{origin:'https://arounus.test'}, addEventListener(type, fn) {handlers[type] = fn;}};
  require('node:vm').runInNewContext(fs.readFileSync('static/service-worker.js', 'utf8'), {self, URL, Response});
  let intercepted = false;
  handlers.fetch({request:{method:'GET', url:'https://arounus.test/static/media/campus-intro.mp4', headers:{Range:'bytes=0-1023'}}, respondWith() {intercepted = true;}});
  assert.equal(intercepted, false);
});
