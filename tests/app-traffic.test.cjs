const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const read = name => fs.readFileSync(`static/${name}`, 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function tracker(path = '/') {
  const dom = new JSDOM('<html><body></body></html>', {url:`https://arounus.test${path}`, runScripts:'outside-only'});
  let visible = 'visible', online = true, calls = 0, timer;
  const w = dom.window;
  Object.defineProperty(w.document, 'visibilityState', {get:() => visible});
  Object.defineProperty(w.navigator, 'onLine', {get:() => online});
  w.setInterval = callback => {timer = callback;};
  w.fetch = async (url, options) => {
    calls++;
    assert.equal(url, '/traffic/heartbeat');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.method, 'POST');
    return {ok:true};
  };
  return {dom, w, get calls(){return calls;}, run(){w.eval(read('app-traffic.js'));},
    timer:() => timer?.(), visible:value => {visible=value;}, online:value => {online=value;}};
}

test('reports a visible app open, pauses hidden/offline, resumes when visible', async () => {
  const t = tracker();
  try {
    let now = 100000;
    t.w.Date.now = () => now;
    t.run(); await tick(); assert.equal(t.calls, 1);
    t.timer(); await tick(); assert.equal(t.calls, 1);
    now += 60000; t.visible('hidden'); t.timer(); await tick(); assert.equal(t.calls, 1);
    t.visible('visible'); t.online(false); t.timer(); await tick(); assert.equal(t.calls, 1);
    t.online(true); t.w.dispatchEvent(new t.w.Event('online')); await tick(); assert.equal(t.calls, 2);
    now += 60000;
    t.w.document.dispatchEvent(new t.w.Event('visibilitychange')); await tick(); assert.equal(t.calls, 3);
  } finally {t.dom.window.close();}
});

test('admin pages never send a visitor heartbeat', async () => {
  for (const path of ['/admin', '/admin/', '/static/admin.html']) {
    const t = tracker(path);
    try {t.run(); await tick(); assert.equal(t.calls, 0);} finally {t.dom.window.close();}
  }
});

test('reporting failure is quiet and can retry; same-browser lock is used', async () => {
  const t = tracker('/students');
  try {
    let locks = 0, calls = 0;
    t.w.navigator.locks = {request:async (name, callback) => {assert.equal(name, 'arounus-traffic'); locks++; return callback();}};
    t.w.fetch = async () => {if (++calls === 1) throw new Error('offline'); return {ok:true};};
    t.run(); await tick(); t.timer(); await tick();
    assert.equal(calls, 2); assert.equal(locks, 2);
  } finally {t.dom.window.close();}
});

function admin() {
  const dom = new JSDOM(read('admin.html'), {url:'https://arounus.test/admin', runScripts:'outside-only', pretendToBeVisual:true});
  const w = dom.window;
  const now = '2026-11-01T10:30:00.000000Z';
  let calls = 0, timer, fail = false;
  w.setInterval = callback => {timer = callback;};
  w.api = async url => {
    calls++;
    assert.match(url, /^\/admin\/traffic\?start_date=/);
    if (fail) throw new Error('Unavailable');
    return {generated_at:now, tracking_started_at:'2026-10-30T10:00:00.000000Z', start_date:'2026-10-26', end_date:'2026-11-01',
      summary:{active_now:3,past_hour:5,today:7,all_time:9,selected_period:9},
      daily:[{date:'2026-10-29',visitors:0},{date:'2026-10-30',visitors:4},{date:'2026-11-01',visitors:7}],
      hourly:[{hour:'2026-11-01T11:00:00+02:00',visitors:2},{hour:'2026-11-01T12:00:00+02:00',visitors:3}]};
  };
  return {dom,w,get calls(){return calls;},timer:() => timer?.(), fail:() => {fail=true;}};
}

test('admin loads only after unlock, renders daily/hourly history, and polls only on overview', async () => {
  const t = admin(), d = t.w.document;
  try {
    t.w.eval(read('admin-traffic.js')); await tick(); assert.equal(t.calls, 0);
    d.getElementById('appWrap').classList.remove('hidden');
    t.w.dispatchEvent(new t.w.Event('admin:unlocked')); await tick();
    assert.equal(t.calls, 1);
    assert.equal(d.getElementById('trafficActive').textContent, '3');
    assert.equal(d.getElementById('trafficAllTime').textContent, '9');
    const rows = d.querySelectorAll('#trafficHistoryRows tr');
    assert.equal(rows.length, 3);
    assert.match(rows[0].textContent, /Today/);
    assert.match(rows[1].textContent, /2 days ago/);
    assert.equal(rows[1].children[1].textContent, '4');
    assert.equal(rows[2].children[1].textContent, '—');
    const view = d.getElementById('trafficHistoryView'); view.value='hourly'; view.dispatchEvent(new t.w.Event('change')); await tick();
    assert.equal(d.getElementById('trafficStartDate').disabled, true);
    assert.match(d.querySelector('#trafficHistoryRows tr').textContent, /Current hour/);
    assert.match(d.querySelectorAll('#trafficHistoryRows tr')[1].textContent, /1 hour ago/);
    d.getElementById('appTrafficCard').hidden=true;
    const previous=t.calls; t.timer(); await tick(); assert.equal(t.calls,previous);
    d.getElementById('appTrafficCard').hidden=false;
    t.w.dispatchEvent(new t.w.CustomEvent('admin:area',{detail:'overview'})); await tick(); assert.equal(t.calls,previous+1);
    t.fail(); t.timer(); await tick();
    assert.match(d.getElementById('appTrafficMessage').textContent,/last successful update/);
    assert.equal(d.getElementById('trafficActive').textContent,'3');
  } finally {t.dom.window.close();}
});

test('offline worker does not cache administrator traffic responses', async () => {
  const vm = require('node:vm'), handlers = {};
  let stores = 0, result;
  const self = {location:{origin:'https://arounus.test'},addEventListener:(type,fn) => {handlers[type]=fn;}};
  vm.runInNewContext(read('service-worker.js'), {self, URL, Response,
    fetch:async () => new Response('{}',{headers:{'Cache-Control':'no-store'}}),
    caches:{open:async () => ({put:async () => {stores++;}})}});
  const request = {method:'GET',mode:'cors',url:'https://arounus.test/admin/traffic',headers:new Headers()};
  handlers.fetch({request, respondWith:value => {result=value;}});
  assert.equal((await result).status,200); assert.equal(stores,0);
});
