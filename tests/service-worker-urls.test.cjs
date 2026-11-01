const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('installed app redirects legacy page navigation to the clean URL', async () => {
  const handlers = {};
  const self = {location: {origin: 'https://arounus.com'}, addEventListener(type, handler) { handlers[type] = handler; }};
  const script = fs.readFileSync('static/service-worker.js', 'utf8');
  vm.runInNewContext(script, {self, URL, Response});
  let response;
  handlers.fetch({
    request: {method: 'GET', mode: 'navigate', url: 'https://arounus.com/static/academics.html?role=tutor'},
    respondWith(value) { response = value; },
  });
  const redirect = await response;
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('location'), 'https://arounus.com/learning?role=tutor');
});
