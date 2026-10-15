const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../static/username-suggestion.js'), 'utf8');

for (const [label, html, usernameId, nameId] of [
  ['learning sign up', '<form id="entryForm"><input id="entryUsername"><input id="entryFullName"></form>', 'entryUsername', 'entryFullName'],
  ['learner workspace sign up', '<section id="registerCard"><label for="regNumber">Student number</label><input id="regNumber"><input id="regName"></section>', 'regNumber', 'regName'],
]) {
  test(`Generate username fills an available name in ${label}`, async () => {
    const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { url: 'https://arounus.test', runScripts: 'outside-only' });
    const { window } = dom;
    window.fetch = async (url, options) => {
      assert.equal(url, '/students/username-suggestion');
      assert.equal(JSON.parse(options.body).full_name, 'Alice');
      return { ok: true, json: async () => ({ username: 'ALICE-123456' }) };
    };
    window.document.getElementById(nameId).value = 'Alice';
    window.eval(source);
    window.document.querySelector('button[aria-label="Generate an available username"]').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(window.document.getElementById(usernameId).value, 'ALICE-123456');
    assert.match(window.document.querySelector('[role="status"]').textContent, /available suggestion/i);
    if (usernameId === 'entryUsername') {
      window.document.getElementById('entryForm').innerHTML = '<input id="entryUsername"><input id="entryFullName">';
      await new Promise(resolve => setImmediate(resolve));
      assert.ok(window.document.querySelector('button[aria-label="Generate an available username"]'));
    }
    window.close();
  });
}
