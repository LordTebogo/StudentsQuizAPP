const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM, VirtualConsole} = require('jsdom');
const html = fs.readFileSync('static/premium.html','utf8');

async function setup({available=true,payu=false,signedIn=true,lifetime=false}={}) {
  const dom = new JSDOM(html,{url:'https://arounus.test/premium',runScripts:'outside-only',virtualConsole:new VirtualConsole()});
  const w=dom.window,requests=[];
  if(signedIn)w.sessionStorage.setItem('studentToken','test-token');
  w.fetch=async(url,options={})=>{
    requests.push({url,options});
    if(url==='/billing/premium/me')return {ok:true,json:async()=>({active:lifetime,lifetime})};
    if(url==='/billing/premium/plans')return {ok:true,json:async()=>({
      plans:[{id:'monthly',label:'30 days',amount_cents:1500,introductory:true}],
      checkout_available:payu,ozow_available:available,paystack_available:false
    })};
    if(url==='/billing/premium/checkout')return {ok:false,json:async()=>({detail:'Payment provider temporarily unavailable'})};
    throw new Error('Unexpected request');
  };
  const script=[...w.document.scripts].find(el=>el.textContent.includes('async function load()'));
  w.eval(script.textContent);
  await new Promise(setImmediate);
  return {dom,w,d:w.document,requests};
}

test('Ozow is the primary bank checkout',async t=>{
  const s=await setup();t.after(()=>s.w.close());
  const buttons=[...s.d.querySelectorAll('.payment-options button')];
  assert.equal(buttons.length,1);
  assert.equal(buttons[0].textContent,'Pay with Ozow');
  assert.equal(buttons[0].disabled,false);
  assert.match(s.d.querySelector('main').textContent,/Pay by Bank/);
  buttons[0].click();
  assert.equal(buttons[0].disabled,true);
  await new Promise(setImmediate);
  const request=s.requests.find(row=>row.url==='/billing/premium/checkout');
  assert.deepEqual(JSON.parse(request.options.body),{plan:'monthly',provider:'ozow'});
  assert.equal(request.options.headers['X-Student-Token'],'test-token');
  assert.equal(buttons[0].textContent,'Pay with Ozow');
  assert.equal(buttons[0].disabled,false);
  assert.match(s.d.getElementById('status').textContent,/temporarily unavailable/);
});

test('pending activation leaves checkout disabled and explains availability',async t=>{
  const s=await setup({available:false});t.after(()=>s.w.close());
  assert.equal(s.d.querySelector('.ozow-pay').disabled,true);
  assert.match(s.d.getElementById('status').textContent,/Payments are not available yet/);
});

test('guest and lifetime accounts cannot start a purchase',async t=>{
  for(const options of [{signedIn:false},{lifetime:true}]) {
    const s=await setup(options);t.after(()=>s.w.close());
    assert.equal(s.d.querySelector('.ozow-pay').disabled,true);
    if(options.lifetime)assert.equal(s.d.querySelector('.ozow-pay').textContent,'Already active');
    else assert.match(s.d.getElementById('status').textContent,/Sign in as a learner/);
  }
});

test('configured PayU remains available alongside Ozow',async t=>{
  const s=await setup({payu:true});t.after(()=>s.w.close());
  const buttons=[...s.d.querySelectorAll('.payment-options button')];
  assert.deepEqual(buttons.map(button=>button.textContent),['Pay with Ozow','Pay with PayU']);
  assert.ok(buttons.every(button=>!button.disabled));
});
