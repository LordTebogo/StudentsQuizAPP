const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const experience = fs.readFileSync(path.join(__dirname, '../static/experience.js'), 'utf8');
const loading = fs.readFileSync(path.join(__dirname, '../static/loading.js'), 'utf8');

function page(route, token, markup) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${markup}</body></html>`, {
    url: `https://arounus.test${route}`,
    runScripts: 'outside-only',
  });
  const { window } = dom;
  if (token) window.sessionStorage.setItem(token, 'test-token');
  window.fetch = async () => ({ ok: true, json: async () => ({}) });
  window.matchMedia = () => ({ matches: false });
  window.requestAnimationFrame = () => 0;
  window.Element.prototype.scrollIntoView = function () { this.dataset.scrolledTo = 'true'; };
  window.scrollTo = () => {};
  window.eval(experience);
  window.eval(loading);
  return window;
}

function click(window, link) {
  link.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}

test('admin header moves to a section without a loading spinner and opens collapsed cards', () => {
  const window = page('/admin', 'lecturerPin', `<main id="appWrap"><header class="top"><nav></nav></header>
    <h1>Content studio</h1><p class="lede">Admin workspace</p>
    <div class="admin-grid"><section class="card"><h2>Quizzes</h2></section></div>
    <section class="card collapsed"><h2>Tutor management</h2><button class="card-toggle" type="button">+</button></section>
    <section class="card" id="marketAdvertAdmin"><h2>Advert approvals</h2></section></main>`);
  const links = [...window.document.querySelectorAll('#appWrap header nav > a')];
  window.document.querySelector('.card-toggle').addEventListener('click', event => event.currentTarget.parentElement.classList.toggle('collapsed'));
  assert.deepEqual(links.map(link => link.textContent), ['Overview', 'Content', 'Users', 'Approvals']);
  for (const [index, targetId] of [[0, 'adminOverview'], [1, 'adminContent']]) {
    click(window, links[index]);
    assert.equal(window.document.getElementById(targetId).dataset.scrolledTo, 'true');
    assert.equal(links[index].classList.contains('is-navigating'), false);
  }
  const users = links[2];
  click(window, users);
  assert.equal(window.location.hash, '#adminPeople');
  assert.equal(window.document.getElementById('adminPeople').dataset.scrolledTo, 'true');
  assert.equal(window.document.getElementById('adminPeople').classList.contains('collapsed'), false);
  assert.equal(users.classList.contains('is-navigating'), false);
  click(window, links[3]);
  assert.equal(window.document.getElementById('marketAdvertAdmin').dataset.scrolledTo, 'true');
  assert.equal(links[3].classList.contains('is-navigating'), false);
  window.close();
});

for (const [route, token, label, homePath] of [
  ['/lecturers', 'lecturerToken', 'Overview', '/lecturers'],
  ['/students', 'studentToken', 'Home', '/students'],
]) {
  test(`${label} stays in the ${route} workspace`, () => {
    const window = page(route, token, '<main id="appWrap"><header class="top"><nav></nav></header></main>');
    const home = [...window.document.querySelectorAll('#appWrap header nav > a')].find(link => link.textContent === label);
    assert.equal(new URL(home.href).pathname, homePath);
    click(window, home);
    assert.equal(home.classList.contains('is-navigating'), false);
    window.close();
  });
}
