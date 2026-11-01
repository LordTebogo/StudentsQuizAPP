const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const read = name => fs.readFileSync(path.join(__dirname, '../static', name), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(name, marker, query = '') {
  const html = read(name);
  const dom = new JSDOM(html, { url: 'https://arounus.test/learning' + query,
    runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  const script = [...dom.window.document.scripts].find(s => s.textContent.includes(marker));
  dom.window.eval(script.textContent);
  return dom;
}

test('all changed page scripts parse', () => {
  for (const name of fs.readdirSync(path.join(__dirname, '../static')).filter(name => name.endsWith('.html'))) {
    const dom = new JSDOM(read(name));
    for (const script of dom.window.document.scripts) {
      if (!script.src && script.type !== 'module' && script.type !== 'application/ld+json') {
        new vm.Script(script.textContent, { filename: name });
      }
    }
    dom.window.close();
  }
});

test('role and mode tabs retain keyboard focus and have a labelled panel', () => {
  const dom = setup('academics.html', 'function renderEntry()');
  const { document, KeyboardEvent } = dom.window;
  const learner = document.getElementById('roleTab-learner');
  learner.focus();
  learner.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(document.activeElement.id, 'roleTab-lecturer');
  assert.equal(document.getElementById('roleTab-lecturer').getAttribute('aria-selected'), 'true');
  assert.equal(learner.tabIndex, -1);
  assert.equal(document.getElementById('accountEntry').getAttribute('aria-labelledby'), 'roleTab-lecturer');
  const mode = document.getElementById('modeTab-login');
  mode.focus();
  mode.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  assert.equal(document.activeElement.id, 'modeTab-register');
  assert.equal(document.getElementById('entryForm').getAttribute('aria-labelledby'), 'modeTab-register');
  assert.equal(document.querySelectorAll('h1').length, 1);
  assert.ok(document.querySelector('main #entryForm'));
  dom.window.close();
});

test('invalid registration focuses and describes the first invalid field', () => {
  const dom = setup('academics.html', 'function renderEntry()', '?mode=register');
  const { document, Event } = dom.window;
  document.getElementById('entryForm').dispatchEvent(new Event('submit', { cancelable: true }));
  assert.equal(document.activeElement.id, 'entryUsername');
  const invalid = document.querySelectorAll('[aria-invalid="true"]');
  assert.equal(invalid.length, 5);
  for (const field of invalid) assert.ok(field.getAttribute('aria-describedby').includes(field.id + '-error'));
  const username = document.getElementById('entryUsername');
  const pattern = new RegExp('^(?:' + username.pattern + ')$', 'v');
  assert.ok(pattern.test('Learner-01'));
  assert.ok(!pattern.test('!bad'));
  dom.window.close();
});

test('password reveal works on sign in', () => {
  const dom = setup('academics.html', 'function renderEntry()');
  const { document } = dom.window;
  const button = document.querySelector('[data-pw-toggle]');
  button.click();
  assert.equal(document.getElementById('entryPassword').type, 'text');
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  button.click();
  assert.equal(document.getElementById('entryPassword').type, 'password');
  dom.window.close();
});

for (const role of ['learner', 'lecturer']) {
  test(`${role} registration sends confirmation and saves the returned session`, async () => {
    const dom = setup('academics.html', 'function renderEntry()', `?role=${role}&mode=register`);
    const { document, Event } = dom.window;
    for (const [id, value] of Object.entries({ entryUsername: 'Learner-01', entryFullName: 'Test Learner',
      entryEmail: 'learner@example.test', entryPassword: 'A-password-123', entryConfirmPassword: 'A-password-123' })) {
      if (document.getElementById(id)) document.getElementById(id).value = value;
    }
    dom.window.fetch = async (url, options) => {
      assert.equal(url, role === 'learner' ? '/students/register' : '/lecturers/register');
      assert.equal(options.body.get('confirm_password'), 'A-password-123');
      return { ok: true, json: async () => ({ token: 'test-session' }) };
    };
    document.getElementById('entryForm').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    assert.equal(dom.window.sessionStorage.getItem(role === 'learner' ? 'studentToken' : 'lecturerToken'), 'test-session');
    dom.window.close();
  });
}

test('unconfigured email keeps recovery on the request form', async () => {
  const dom = setup('reset-password.html', 'function syncRole()');
  const { document, Event } = dom.window;
  dom.window.fetch = async () => ({ ok: true, json: async () => ({ recovery_available: false, message: 'Contact your administrator.' }) });
  document.getElementById('resetEmail').value = 'learner@example.test';
  document.getElementById('requestForm').dispatchEvent(new Event('submit', { cancelable: true }));
  await tick();
  assert.equal(document.getElementById('requestForm').hidden, false);
  assert.equal(document.getElementById('confirmForm').hidden, true);
  assert.match(document.getElementById('resetStatus').textContent, /administrator/);
  dom.window.close();
});

for (const [name, marker, end, sessionKey] of [
  ['student.html', "$('registerBtn').addEventListener", '\n', 'studentToken'],
  ['lecturer.html', "$('registerBtn').addEventListener", "\n$('editProfileBtn')", 'lecturerToken'],
]) {
  test(`${name} legacy registration also saves the returned session`, async () => {
    const page = read(name);
    const start = page.indexOf(marker);
    const source = page.slice(start, page.indexOf(end, start));
    const dom = new JSDOM(page, { url: 'https://arounus.test', runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
    const { window } = dom;
    for (const input of window.document.querySelectorAll('input:not([type=file]),textarea')) input.value = 'Test-password-123';
    window.api = async () => ({ token: 'legacy-session' });
    window.showMsg = () => {};
    window.NucleoLiveInvite = { postLoginUrl: () => '/students' };
    window.eval("const $=id=>document.getElementById(id); let token, LECTURER_TOKEN;" + source);
    window.document.getElementById('registerBtn').click();
    await tick();
    assert.equal(window.sessionStorage.getItem(sessionKey), 'legacy-session');
    window.close();
  });
}

test('switching recovery role returns to the code request step', async () => {
  const dom = setup('reset-password.html', 'function syncRole()');
  const { document, Event } = dom.window;
  dom.window.fetch = async () => ({ ok: true, json: async () => ({ message: 'Check your inbox.' }) });
  document.getElementById('resetEmail').value = 'learner@example.test';
  document.getElementById('requestForm').dispatchEvent(new Event('submit', { cancelable: true }));
  await tick();
  assert.equal(document.getElementById('confirmForm').hidden, false);
  document.querySelector('[data-role="lecturer"]').click();
  assert.equal(document.getElementById('requestForm').hidden, false);
  assert.equal(document.getElementById('confirmForm').hidden, true);
  assert.equal(document.getElementById('stepRequest').getAttribute('aria-current'), 'step');
  dom.window.close();
});

test('joining or closing the lobby cancels pending camera preview and releases tracks', async () => {
  const dom = setup('live_lesson.html', 'const panel = document.getElementById(\'prejoinPanel\')');
  const { document } = dom.window;
  let resolve;
  let stopped = 0;
  Object.defineProperty(dom.window.navigator, 'mediaDevices', { value: {
    enumerateDevices: async () => [],
    getUserMedia: () => new Promise(r => { resolve = r; }),
  }});
  document.getElementById('prejoinTest').click();
  dom.window.arounusPrejoin.stop();
  resolve({ getTracks: () => [{ stop() { stopped++; } }] });
  await tick();
  assert.equal(stopped, 1);
  assert.equal(document.getElementById('prejoinVideo').srcObject, null);
  assert.equal(document.getElementById('prejoinStop').hidden, true);
  dom.window.close();
});
