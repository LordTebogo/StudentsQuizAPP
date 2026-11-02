const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../static/index.html'),'utf8');
const script=fs.readFileSync(path.join(__dirname,'../static/market-sell.js'),'utf8');
async function setup(geolocation){
  const dom=new JSDOM(html,{url:'https://arounus.test/',runScripts:'outside-only'}),w=dom.window,d=w.document;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
  w.HTMLDialogElement.prototype.close=function(){this.open=false};
  w.ArounusMarketAuth={ensureSignedIn:async()=>({profile:{full_name:'Test seller'}})};
  if(geolocation)Object.defineProperty(w.navigator,'geolocation',{value:geolocation});
  w.eval(script);d.querySelector('[data-open-sell]').click();await new Promise(resolve=>setTimeout(resolve,15));
  d.querySelector('[data-sell-kind="room"]').click();
  return {w,d,form:d.getElementById('sellListingForm'),button:d.querySelector('[data-use-location]'),status:d.querySelector('.sell-location-status')};
}
test('location is requested only on click and fills coordinates without publishing',async()=>{
  let calls=0,success;const {w,d,form,button,status}=await setup({getCurrentPosition(ok,fail,options){calls++;success=ok;assert.equal(options.timeout,15000);assert.equal(options.maximumAge,60000)}});
  try{
    assert.equal(calls,0);button.click();assert.equal(calls,1);assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-busy'),'true');
    success({coords:{latitude:-23.91234567,longitude:31.12345678}});
    assert.equal(form.elements.latitude.value,'-23.912346');assert.equal(form.elements.longitude.value,'31.123457');
    assert.equal(button.disabled,false);assert.equal(button.hasAttribute('aria-busy'),false);assert.match(status.textContent,/Location added/);
    assert.equal(form.elements.latitude.required,false);assert.equal(form.elements.longitude.required,false);
  }finally{w.close()}
});
for(const [code,message]of [[1,/Location access is blocked.*site settings/],[2,/could not find its location/],[3,/took too long/],[0,/could not be fetched/]])test(`location error ${code} explains recovery and preserves form values`,async()=>{
  let fail;const {w,form,button,status}=await setup({getCurrentPosition(ok,error){fail=error}});
  try{
    form.elements.area.value='Phalaborwa';form.elements.latitude.value='-23.9';button.click();fail({code});
    assert.match(status.textContent,message);assert.match(status.textContent,/optional|leave coordinates blank/);
    assert.equal(form.elements.area.value,'Phalaborwa');assert.equal(form.elements.latitude.value,'-23.9');assert.equal(button.disabled,false);
    button.click();assert.equal(button.disabled,true);fail({code});assert.equal(button.disabled,false);
  }finally{w.close()}
});
for(const mode of ['missing','throws'])test(`location API ${mode} leaves the form usable`,async()=>{
  const {w,button,status}=await setup(mode==='missing'?undefined:{getCurrentPosition(){throw new Error('Blocked')}});
  try{button.click();assert.equal(button.disabled,false);assert.match(status.textContent,/leave coordinates blank/);assert.equal(status.hidden,false)}finally{w.close()}
});
test('a late result cannot update a closed form or another listing',async()=>{
  let success;const {w,d,form,button}=await setup({getCurrentPosition(ok){success=ok}});
  try{
    button.click();d.getElementById('closeSell').click();success({coords:{latitude:1,longitude:2}});
    assert.equal(form.elements.latitude.value,'');assert.equal(d.getElementById('sellMessage').textContent,'');
    d.getElementById('sellDialog').showModal();button.click();d.querySelector('[data-sell-back]').click();d.querySelector('[data-sell-kind="room"]').click();
    success({coords:{latitude:1,longitude:2}});assert.equal(d.getElementById('sellListingForm').elements.latitude.value,'');assert.equal(d.getElementById('sellMessage').textContent,'');
  }finally{w.close()}
});
