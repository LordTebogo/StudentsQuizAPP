const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'static/module-names.js'), 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context);

test('module labels show names while retaining codes, including custom modules', () => {
  assert.equal(context.window.moduleLabel('SBIA021'), 'Introduction to Biochemistry (SBIA021)');
  assert.equal(context.window.moduleName('ADVANCED_IMMUNOLOGY'), 'Advanced Immunology');
  assert.equal(context.window.moduleLabel('CHEM101'), 'CHEM101');
});

test('learner, tutor, and admin pages load module names before their workspace scripts', () => {
  for (const page of ['student.html', 'lessons_student.html', 'lecturer.html', 'lessons_lecturer.html', 'admin.html']) {
    const html = fs.readFileSync(path.join(root, 'static', page), 'utf8');
    const names = html.indexOf('/static/module-names.js');
    assert.ok(names >= 0, `${page} is missing the module names helper`);
    assert.ok(names < html.indexOf('moduleLabel('), `${page} uses module labels before loading the helper`);
  }
});

test('browser and server have the same module names', () => {
  const python = fs.readFileSync(path.join(root, 'main.py'), 'utf8');
  const catalog = python.match(/MODULE_NAMES = \{([\s\S]*?)\n\}/)[1];
  const serverNames = Object.fromEntries([...catalog.matchAll(/"([A-Z0-9_]+)": "([^"]+)"/g)].map(([, code, name]) => [code, name]));
  assert.deepEqual(JSON.parse(JSON.stringify(context.window.moduleNames)), serverNames);
});
