const {JSDOM} = require('jsdom');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../static/index.html'), 'utf8');
const sellScript = fs.readFileSync(path.join(__dirname, '../static/market-sell.js'), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 20));

test('sell or list opens one advertiser registration and uses its login for rooms and items', async () => {
  const dom = new JSDOM(html, {url:'https://arounus.test/market', runScripts:'outside-only'});
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const posts = [];
  w.fetch = async (url, options = {}) => {
    if (options.method === 'POST') posts.push({url, options});
    if (url === '/marketing/landlords/register') return {ok:true, json:async()=>({token:'one-provider-token',profile:{full_name:'One seller',business_name:'Seller shop'}})};
    if (url === '/marketing/listings' || url === '/marketing/adverts') return {ok:true, json:async()=>({ok:true})};
    throw new Error(url);
  };
  w.eval(sellScript);
  w.document.querySelector('[data-open-sell]').click();
  assert.equal(w.document.getElementById('sellDialog').open, true);
  assert.equal(w.document.querySelectorAll('#sellAuthForm').length, 1);
  assert.equal(w.document.querySelector('[name="provider_type"]'), null);
  const auth = w.document.getElementById('sellAuthForm');
  for (const [name,value] of Object.entries({full_name:'One seller',phone:'0712345678',email:'one@example.com',password:'password123',confirm_password:'password123'})) auth.elements[name].value = value;
  auth.dispatchEvent(new w.Event('submit', {bubbles:true,cancelable:true}));
  await tick();
  assert.equal(w.sessionStorage.getItem('landlordToken'), 'one-provider-token');
  w.document.querySelector('[data-sell-kind="room"]').click();
  const room = w.document.getElementById('sellListingForm');
  for (const [name,value] of Object.entries({title:'Campus room',campus:'UL',area:'Mankweng',monthly_rent:'1500',description:'Near campus'})) room.elements[name].value = value;
  room.dispatchEvent(new w.Event('submit', {bubbles:true,cancelable:true}));
  await tick();
  w.document.querySelector('[data-sell-kind="advert"]').click();
  const advert = w.document.getElementById('sellListingForm');
  for (const [name,value] of Object.entries({headline:'Textbooks',category:'Sales & retail',description:'Used books',contact:'0712345678'})) advert.elements[name].value = value;
  advert.dispatchEvent(new w.Event('submit', {bubbles:true,cancelable:true}));
  await tick();
  assert.deepEqual(posts.map(post => post.url), ['/marketing/landlords/register','/marketing/listings','/marketing/adverts']);
  assert.equal(posts[1].options.headers['X-Landlord-Token'], 'one-provider-token');
  assert.equal(posts[2].options.headers['X-Landlord-Token'], 'one-provider-token');
  dom.window.close();
});
