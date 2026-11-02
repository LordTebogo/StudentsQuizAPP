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

test('sign-in is role-free and registration asks for the account type first', () => {
  const dom = setup('academics.html', 'function renderEntry()');
  const {document,KeyboardEvent}=dom.window;
  assert.equal(document.getElementById('entryRoleChoices').hidden,true);
  assert.equal(document.querySelectorAll('#entryForm input').length,2);
  assert.equal(document.querySelector('#entryForm select'),null);
  assert.equal(document.querySelector('#entryForm [type=submit]').textContent,'Sign in');
  assert.equal(document.getElementById('entryForgotPassword').getAttribute('href'),'/reset-password');
  document.getElementById('modeTab-register').click();
  assert.equal(document.getElementById('entryRoleChoices').hidden,false);
  assert.equal(document.getElementById('entryForm').hidden,true);
  assert.equal(document.activeElement.id,'roleTab-learner');
  const student=document.getElementById('roleTab-learner');
  student.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  assert.equal(document.activeElement.id,'roleTab-lecturer');
  assert.equal(document.getElementById('roleTab-lecturer').getAttribute('aria-selected'),'true');
  assert.equal(document.getElementById('entryForm').getAttribute('aria-labelledby'),'roleTab-lecturer');
  document.getElementById('roleTab-advertiser').click();
  assert.ok(document.getElementById('entryPhone'));
  assert.equal(document.getElementById('entryHeading').textContent,'Create advertiser account');
  document.getElementById('modeTab-login').click();
  assert.equal(document.getElementById('entryRoleChoices').hidden,true);
  assert.equal(document.activeElement.id,'entryIdentifier');
  assert.equal(document.querySelectorAll('h1').length,1);
  dom.window.close();
});

for(const [detected,key,active] of [['student','studentToken','student'],['lecturer','lecturerToken','lecturer'],['landlord','landlordToken','advertiser']]) {
  test(`one sign-in detects ${detected} and stores the correct session`,async()=>{
    const dom=setup('academics.html','function renderEntry()');
    const {document,Event}=dom.window;let calls=0;
    document.getElementById('entryIdentifier').value='  person@example.test  ';
    document.getElementById('entryPassword').value='short';
    dom.window.sessionStorage.setItem('studentToken','old-session');
    dom.window.sessionStorage.setItem('lecturerToken','old-session');
    dom.window.fetch=async(url,options)=>{calls++;assert.equal(url,'/marketing/login');assert.deepEqual(JSON.parse(options.body),{identifier:'person@example.test',password:'short'});return {ok:true,json:async()=>({role:detected,token:'detected-session',market_token:'market-session',profile:{full_name:'Person'}})}};
    document.getElementById('entryForm').dispatchEvent(new Event('submit',{cancelable:true}));
    await tick();
    assert.equal(calls,1);
    assert.equal(dom.window.sessionStorage.getItem(key),'detected-session');
    assert.equal(dom.window.sessionStorage.getItem('activeRole'),active);
    assert.equal(dom.window.sessionStorage.getItem('marketSessionSource'),key+':detected-session');
    for(const other of ['studentToken','lecturerToken','landlordToken'].filter(item=>item!==key))assert.equal(dom.window.sessionStorage.getItem(other),null);
    dom.window.close();
  });
}

test('a rejected unified sign-in keeps the form usable and shows the server message',async()=>{
  const dom=setup('academics.html','function renderEntry()');const {document,Event}=dom.window;
  document.getElementById('entryIdentifier').value='person@example.test';document.getElementById('entryPassword').value='wrong';
  dom.window.fetch=async()=>({ok:false,json:async()=>({detail:'Email, username or password is incorrect'})});
  document.getElementById('entryForm').dispatchEvent(new Event('submit',{cancelable:true}));await tick();
  assert.match(document.getElementById('entryMessage').textContent,/password is incorrect/);
  assert.equal(document.querySelector('#entryForm [type=submit]').disabled,false);
  assert.equal(dom.window.sessionStorage.getItem('studentToken'),null);dom.window.close();
});

test('invalid registration focuses and describes the first invalid field', () => {
  const dom = setup('academics.html', 'function renderEntry()', '?mode=register&role=learner');
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

for (const role of ['learner', 'lecturer', 'advertiser']) {
  test(`${role} registration sends confirmation and saves the returned session`, async () => {
    const dom = setup('academics.html', 'function renderEntry()', `?role=${role}&mode=register`);
    const { document, Event } = dom.window;
    for (const [id, value] of Object.entries({ entryUsername: 'Learner-01', entryFullName: 'Test Learner',
      entryPhone:'0712345678', entryEmail: 'learner@example.test', entryPassword: 'A-password-123', entryConfirmPassword: 'A-password-123' })) {
      if (document.getElementById(id)) document.getElementById(id).value = value;
    }
    dom.window.fetch = async (url, options) => {
      assert.equal(url, role === 'learner' ? '/students/register' : role === 'lecturer' ? '/lecturers/register' : '/marketing/landlords/register');
      assert.equal(options.body.get('confirm_password'), 'A-password-123');
      return { ok: true, json: async () => ({ token: 'test-session' }) };
    };
    document.getElementById('entryForm').dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    assert.equal(dom.window.sessionStorage.getItem(role === 'learner' ? 'studentToken' : role === 'lecturer' ? 'lecturerToken' : 'landlordToken'), 'test-session');
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
