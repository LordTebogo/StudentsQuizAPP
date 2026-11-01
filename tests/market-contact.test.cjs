const {JSDOM} = require('jsdom');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('a signed-in learner can message a provider from the market home', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../static/index.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '../static/market-contact.js'), 'utf8');
  const auth = fs.readFileSync(path.join(__dirname, '../static/market-auth.js'), 'utf8');
  const dom = new JSDOM(html, {url:'https://arounus.test/market', runScripts:'outside-only'});
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.sessionStorage.setItem('studentToken', 'learner-token');
  let sent;
  w.fetch = async (url, options) => {
    if(url==='/marketing/session')return {ok:true,json:async()=>({role:'student',token:'learner-token',market_token:'market-token',profile:{id:2,full_name:'Learner'}})};
    sent = {url, options}; return {ok:true, json:async()=>({ok:true})};
  };
  w.eval(auth);
  w.eval(script);
  const button = w.document.createElement('button');
  button.dataset.contactProvider = '7';
  button.dataset.providerName = 'Campus host';
  w.document.body.appendChild(button);
  button.click();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(w.document.getElementById('contactDialog').open, true);
  w.document.getElementById('contactText').value = 'Is this available?';
  w.document.getElementById('contactForm').dispatchEvent(new w.Event('submit', {bubbles:true,cancelable:true}));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(sent.url, '/marketing/provider/messages');
  assert.equal(sent.options.headers['X-Landlord-Token'], 'market-token');
  assert.equal(JSON.parse(sent.options.body).recipient_id, 7);
  assert.match(w.document.getElementById('contactStatus').textContent, /Message sent/);
  dom.window.close();
});
