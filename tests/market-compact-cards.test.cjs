const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const tick=()=>new Promise(resolve=>setTimeout(resolve,30));
async function setup(url='https://arounus.test/'){
  const dom=new JSDOM(fs.readFileSync('static/index.html','utf8'),{url,runScripts:'outside-only'});
  const w=dom.window,d=w.document;let views=0,ratings=0;
  w.AbortSignal=AbortSignal;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;w.setTimeout(()=>this.dispatchEvent(new w.Event('close')),0)};
  w.fetch=async path=>{
    if(path.endsWith('/view')){views++;return {ok:true,json:async()=>({views:1})}}
    if(path.endsWith('/rating')){ratings++;return {ok:true,json:async()=>({rating:4.5,rating_count:3,your_rating:5})}}
    return {ok:true,json:async()=>path==='/marketing/listings'?[{id:7,title:'Garden room',description:'Private bathroom and WiFi',monthly_rent:1500,is_available:true,rating:4.2,rating_count:2,contact:'0723456789',landlord:{id:9,name:'Provider'}}]:[]};
  };
  w.ArounusMarketAuth={request:async(path,options)=>(await w.fetch(path,options)).json()};
  for(const path of ['static/market-metrics.js','static/campus-home.js'])w.eval(fs.readFileSync(path,'utf8'));
  await tick();return {w,d,counts:()=>({views,ratings})};
}
test('browse shows rating summary; rating, share and contact actions are in the listing screen',async()=>{
  const {w,d,counts}=await setup();try{
    const card=d.querySelector('.campus-card');
    assert.match(card.textContent,/R1[\s\u00a0]?500/);
    assert.match(card.querySelector('[data-rating-summary]').textContent,/4.2 \(2\)/);
    assert.equal(card.querySelector('.market-stars,[data-share],[data-report-listing],.card-provider'),null);
    card.querySelector('[data-save]').click();assert.equal(counts().views,0);
    card.querySelector('.card-title').click();await tick();
    assert.equal(d.getElementById('offerDialog').open,true);
    assert.match(d.getElementById('offerDetails').textContent,/Private bathroom and WiFi/);
    assert.match(d.getElementById('offerDetails').textContent,/0723456789/);
    assert.ok(d.querySelector('#offerDetails [data-share]'));
    assert.equal(d.querySelectorAll('#offerDetails .market-stars button').length,5);
    assert.equal(d.querySelector('#offerDetails [data-save]').getAttribute('aria-pressed'),'true');
    assert.equal(counts().views,1);
    d.querySelector('#offerDetails [data-stars="5"]').click();await tick();
    assert.match(card.querySelector('[data-rating-summary]').textContent,/4.5 \(3\)/);
    d.querySelector('#offerDetails [data-save]').click();
    assert.equal(card.querySelector('[data-save]').getAttribute('aria-pressed'),'false');
    assert.equal(d.querySelector('[data-saved-count]').textContent,'0');
    d.getElementById('sortListings').value='price-low';d.getElementById('sortListings').dispatchEvent(new w.Event('change'));await tick();
    assert.match(d.querySelector('.campus-card [data-rating-summary]')?.textContent||'',/4.5 \(3\)/);
  }finally{w.close()}
});
test('browser Back restores browsing and Forward reopens the listing with details',async()=>{
  const {w,d}=await setup();try{
    d.querySelector('.card-title').click();await tick();
    assert.match(w.location.search,/listing=room-7/);
    assert.equal(d.documentElement.classList.contains('listing-open'),true);
    assert.equal(w.history.length,2);
    d.querySelector('#offerDetails [data-share]').click();
    assert.equal(d.getElementById('listingShareDialog').open,true);
    w.history.back();await tick();
    assert.equal(d.getElementById('offerDialog').open,false);
    assert.equal(d.getElementById('listingShareDialog').open,false);
    assert.doesNotMatch(w.location.search,/listing=/);
    assert.equal(d.documentElement.classList.contains('listing-open'),false);
    w.history.forward();await tick();
    assert.equal(d.getElementById('offerDialog').open,true);
    assert.match(d.getElementById('offerTitle').textContent,/Garden room/);
    d.getElementById('closeOffer').click();await tick();
    assert.doesNotMatch(w.location.search,/listing=/);
    assert.equal(w.history.length,2);
  }finally{w.close()}
});
test('a direct listing link opens its full details and closes without leaving the market',async()=>{
  const {w,d,counts}=await setup('https://arounus.test/?listing=room-7');try{
    assert.equal(d.getElementById('offerDialog').open,true);
    assert.equal(w.history.length,1);
    assert.equal(counts().views,1);
    d.getElementById('closeOffer').click();await tick();
    assert.equal(w.location.pathname,'/');
    assert.equal(w.location.search,'');
    assert.equal(d.documentElement.classList.contains('listing-open'),false);
  }finally{w.close()}
});
