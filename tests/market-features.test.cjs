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

test('video source is assigned only after Play is chosen', async () => {
  const dom = new JSDOM('<html><head></head><body><video controls data-free-video="https://example.test/480.mp4" data-video-kind="advert" data-video-id="4" data-premium-available="true"></video></body></html>', {url:'https://arounus.test', runScripts:'outside-only'});
  const w = dom.window;
  w.HTMLMediaElement.prototype.pause = () => {};
  w.HTMLMediaElement.prototype.load = () => {};
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  w.eval(videos); await tick();
  const video = w.document.querySelector('video');
  assert.equal(video.hasAttribute('src'), false);
  w.document.querySelector('.arounus-video-actions button').click();
  assert.equal(video.src, 'https://example.test/480.mp4');
});
