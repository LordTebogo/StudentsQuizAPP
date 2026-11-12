const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'static/module-names.js'), 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context);

test('module labels show subject names without university codes', () => {
  assert.equal(context.window.moduleLabel('SBIA021'), 'Introduction to Biochemistry');
  assert.equal(context.window.moduleLabel('SBIA022'), 'Biochemistry');
  assert.equal(context.window.moduleLabel('SBTA032'), 'Immunology');
  assert.equal(context.window.moduleName('ADVANCED_IMMUNOLOGY'), 'Advanced Immunology');
  assert.equal(context.window.moduleDisplayTitle('SBTA032 — Innate Immunity', 'SBTA032'), 'Innate Immunity');
  assert.equal(context.window.moduleSlug('SMIB032'), 'molecular-biology');
  assert.equal(context.window.moduleCodeFromSlug('molecular-biology'), 'SMIB032');
  assert.equal(context.window.moduleLabel('CHEM101'), 'CHEM101');
  assert.equal(context.window.moduleLabel('ARU-HS-GE10'), 'Geography — Grade 10 (ARU-HS-GE10)');
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
  const newNames = JSON.parse(execFileSync('python', ['-c', 'import json; from subject_catalog import SUBJECT_NAMES; print(json.dumps(SUBJECT_NAMES))'], {cwd:root,encoding:'utf8'}));
  assert.deepEqual(JSON.parse(JSON.stringify(context.window.moduleNames)), {...serverNames,...newNames});
});
