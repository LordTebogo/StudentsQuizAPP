const {JSDOM} = require('jsdom');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('choosing a room reveals the accommodation form on the create page', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../static/marketing.html'), 'utf8');
  const ads = fs.readFileSync(path.join(__dirname, '../static/market-ads.js'), 'utf8');
  const dom = new JSDOM(html, {url:'https://arounus.test/static/marketing.html?create=1', runScripts:'outside-only'});
  const w = dom.window;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.fetch = async () => ({ok:true, json:async()=>[]});
  w.eval([...w.document.querySelectorAll('script:not([src])')][0].textContent);
  w.eval(ads);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await new Promise(resolve => setTimeout(resolve, 20));
  const desk = w.document.querySelector('.market-side > .landlord-desk');
  assert.equal(desk.classList.contains('hidden'), true);
  w.document.querySelector('[data-create-kind="room"]').click();
  assert.equal(desk.classList.contains('hidden'), false);
  assert.equal(w.getComputedStyle(desk).display === 'none', false);
  assert.equal(w.document.getElementById('listingForm').classList.contains('hidden'), false);
  dom.window.close();
});
