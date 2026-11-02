const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../static/index.html'),'utf8');
const script=fs.readFileSync(path.join(__dirname,'../static/campus-home.js'),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,15));
async function setup(clipboard){
  const dom=new JSDOM(html,{url:'https://arounus.com/',runScripts:'outside-only'});
  const w=dom.window,d=w.document;
  w.AbortSignal=AbortSignal;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};
  w.navigator.share=()=>{throw new Error('Native share should not open')};
  if(clipboard)Object.defineProperty(w.navigator,'clipboard',{value:{writeText:clipboard}});
  w.fetch=async url=>({ok:true,json:async()=>url.includes('adverts')?[{id:3,headline:'Tutorials <&>',campus:'Limpopo',category:'Tutoring'}]:[{id:7,title:'Nearby room',is_available:true}]});
  w.eval(script);await tick();
  return {w,d,open:(key='offer-3')=>d.querySelector(`[data-share="${key}"]`).click()};
}
test('Share directly offers Copy link and WhatsApp for the selected listing',async()=>{
  const {w,d,open}=await setup();try{
    open();assert.equal(d.getElementById('listingShareDialog').open,true);
    assert.equal(d.getElementById('listingShareName').textContent,'Tutorials <&>');
    assert.equal(d.getElementById('listingShareName').children.length,0);
    assert.equal(d.getElementById('listingShareUrl').value,'https://arounus.com/listing/offer/3');
    const whatsapp=new URL(d.getElementById('listingShareWhatsApp').href);
    assert.equal(whatsapp.origin,'https://wa.me');
    assert.equal(whatsapp.searchParams.get('text'),'Tutorials <&> on Arounus\nhttps://arounus.com/listing/offer/3');
    d.getElementById('closeListingShare').click();assert.equal(d.getElementById('listingShareDialog').open,false);
    open('room-7');assert.equal(d.getElementById('listingShareUrl').value,'https://arounus.com/listing/room/7');
  }finally{w.close()}
});
test('Copy link writes the public URL and confirms success',async()=>{
  let copied;const {w,d,open}=await setup(async value=>{copied=value});try{
    open();d.getElementById('copyListingLink').click();await tick();
    assert.equal(copied,'https://arounus.com/listing/offer/3');
    assert.match(d.getElementById('listingShareStatus').textContent,/Link copied/);
    assert.equal(d.getElementById('copyListingLink').disabled,false);
  }finally{w.close()}
});
for(const mode of ['unavailable','denied','timeout'])test(`Clipboard ${mode} leaves a selectable link and a responsive panel`,async()=>{
  const clipboard=mode==='unavailable'?undefined:mode==='denied'?async()=>{throw new Error('Denied')}:()=>new Promise(()=>{});
  const {w,d,open}=await setup(clipboard);try{
    const original=w.setTimeout.bind(w);if(mode==='timeout')w.setTimeout=(fn,ms,...args)=>original(fn,ms===2000?1:ms,...args);
    let selected=false;d.getElementById('listingShareUrl').select=()=>{selected=true};
    open();d.getElementById('copyListingLink').click();await tick();
    assert.equal(selected,true);assert.match(d.getElementById('listingShareStatus').textContent,/Link selected/);
    assert.equal(d.getElementById('copyListingLink').disabled,false);
    d.getElementById('closeListingShare').click();assert.equal(d.getElementById('listingShareDialog').open,false);
  }finally{w.close()}
});
test('closing a pending copy does not change or steal focus from the next share',async()=>{
  let reject;const {w,d,open}=await setup(()=>new Promise((_,fail)=>{reject=fail}));try{
    open();d.getElementById('copyListingLink').click();d.getElementById('closeListingShare').click();
    open('room-7');d.getElementById('copyListingLink').focus();reject(new Error('Denied'));await tick();
    assert.equal(d.getElementById('listingShareStatus').textContent,'');
    assert.equal(d.activeElement.id,'copyListingLink');assert.equal(d.getElementById('copyListingLink').disabled,false);
  }finally{w.close()}
});
