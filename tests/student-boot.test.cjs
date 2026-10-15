const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const studentPage = fs.readFileSync(path.join(__dirname, '../static/student.html'), 'utf8');
const enterAppSource = studentPage.match(/^async function enterApp\(profile\)\{[^\n]+\}/m)?.[0];

test('saved learner sees loading view until modules are ready', async () => {
  assert.ok(enterAppSource);
  const dom = new JSDOM('<!doctype html><html class="student-session-loading"><body><div id="gateWrap"></div><main id="appWrap" class="hidden"></main><section id="studentBootScreen"></section></body></html>');
  const { window } = dom;
  let finishModules;
  const modules = new Promise(resolve => { finishModules = resolve; });
  const enterApp = new Function('$', 'applyStudent', 'loadModules', 'window', 'document', 'token', `${enterAppSource};return enterApp;`)(
    id => window.document.getElementById(id),
    () => {},
    () => modules,
    { ensureStudentModuleEnrollment: async () => ({ completed: true }) },
    window.document,
    'test-token',
  );
  const ready = enterApp({ module_selection_completed: true });
  assert.equal(window.document.getElementById('gateWrap').classList.contains('hidden'), true);
  assert.equal(window.document.documentElement.classList.contains('student-session-loading'), true);
  finishModules();
  await ready;
  assert.equal(window.document.documentElement.classList.contains('student-session-loading'), false);
  assert.equal(window.document.getElementById('appWrap').classList.contains('hidden'), false);
  dom.window.close();
});

test('first-time module selection is not covered by the loading view', async () => {
  const dom = new JSDOM('<!doctype html><html class="student-session-loading"><body><div id="gateWrap"></div><main id="appWrap" class="hidden"></main></body></html>');
  const { window } = dom;
  let finishEnrollment;
  const enrollment = new Promise(resolve => { finishEnrollment = resolve; });
  const enterApp = new Function('$', 'applyStudent', 'loadModules', 'window', 'document', 'token', `${enterAppSource};return enterApp;`)(
    id => window.document.getElementById(id),
    () => {},
    async () => {},
    { ensureStudentModuleEnrollment: () => enrollment },
    window.document,
    'test-token',
  );
  const ready = enterApp({ module_selection_completed: false });
  assert.equal(window.document.documentElement.classList.contains('student-session-loading'), false);
  finishEnrollment();
  await ready;
  dom.window.close();
});
