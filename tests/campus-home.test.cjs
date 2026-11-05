const {JSDOM}=require('jsdom');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../static/index.html'),'utf8');
const script=fs.readFileSync(path.join(__dirname,'../static/campus-home.js'),'utf8');
const rooms=[{id:1,title:'Garden room',campus:'University of Limpopo',is_available:true,monthly_rent:1800},{id:2,title:'Filled room',campus:'University of Limpopo',is_available:false},{id:3,title:'City room',campus:'Other College',is_available:true}];
const ads=[{id:1,headline:'Campus shuttle',campus:'University of Limpopo',category:'Ride & transport',price:60},{id:2,headline:'Biology textbooks',campus:'University of Limpopo',category:'Sales & retail',price:250,description:'<img src=x onerror=alert(1)>',website_url:'javascript:alert(1)'},{id:3,headline:'Math tutoring',campus:'Other College',category:'Tutoring',is_featured:true}];
async function setup(failed=[],options={}){const dom=new JSDOM(html,{url:options.url||'https://campus.test/',runScripts:'outside-only'});const w=dom.window;if(options.saved!==undefined)w.localStorage.setItem('arounusSavedListings',JSON.stringify(options.saved));if(options.geolocation)Object.defineProperty(w.navigator,'geolocation',{value:options.geolocation});w.AbortSignal=AbortSignal;w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.fetch=async url=>({ok:!failed.includes(url),json:async()=>url.includes('adverts')?(options.ads || ads):(options.rooms || rooms)});w.eval(script);await new Promise(resolve=>setTimeout(resolve,20));return {w,d:w.document};}
test('public home shows available and filled rooms plus approved offers without a login gate',async()=>{const {d}=await setup();assert.equal(d.querySelectorAll('.campus-card').length,6);assert.ok(d.getElementById('campusListings').textContent.includes('Filled room'));assert.equal(d.querySelector('.academic-link').getAttribute('href'),'/learning');});
test('search filters are shareable and listing detail links to its public page',async()=>{const {w,d}=await setup();d.getElementById('campus').value='University of Limpopo';d.getElementById('campusSearch').dispatchEvent(new w.Event('submit',{cancelable:true}));assert.match(w.location.search,/campus=University\+of\+Limpopo/);d.querySelector('[data-offer="room-1"]').click();assert.equal(d.querySelector('#offerDetails a[href="/listing/room/1"]')?.textContent,'Open and share this listing');});
test('campus, search and category filters combine; clear restores all',async()=>{const {w,d}=await setup();d.getElementById('campus').value='University of Limpopo';d.getElementById('campusSearch').dispatchEvent(new w.Event('submit',{cancelable:true}));assert.equal(d.querySelectorAll('.campus-card').length,4);d.querySelector('[data-category="items"]').click();assert.equal(d.querySelectorAll('.campus-card').length,1);assert.match(d.getElementById('campusListings').textContent,/Biology textbooks/);assert.equal(w.localStorage.getItem('marketCampus'),'University of Limpopo');d.getElementById('search').value='missing';d.getElementById('campusSearch').dispatchEvent(new w.Event('submit',{cancelable:true}));assert.match(d.getElementById('campusListings').textContent,/No listings here yet/);d.getElementById('clearFilters').click();assert.equal(d.querySelectorAll('.campus-card').length,6);});
test('details escape seller content and reject unsafe website links',async()=>{const {d}=await setup();d.querySelector('[data-offer="offer-2"]').click();assert.equal(d.getElementById('offerDialog').open,true);assert.equal(d.getElementById('offerDetails').querySelectorAll('img').length,0);assert.ok(!d.getElementById('offerDetails').innerHTML.includes('href="javascript:'));d.getElementById('closeOffer').click();assert.equal(d.getElementById('offerDialog').open,false);});
test('partial failure keeps available data with a retry; total failure is not an empty market',async()=>{let {d}=await setup(['/marketing/adverts']);assert.equal(d.querySelectorAll('.campus-card').length,3);assert.equal(d.getElementById('retryListings').hidden,false);assert.match(d.getElementById('marketStatus').textContent,/Some listings/);({d}=await setup(['/marketing/adverts','/marketing/listings']));assert.match(d.getElementById('marketStatus').textContent,/could not be loaded/);assert.equal(d.querySelectorAll('.market-empty').length,0);});
test('shows prices, labels only featured offers, and filters and sorts by price',async()=>{const {w,d}=await setup();assert.match(d.querySelector('[data-offer="offer-2"]').closest('.campus-card').textContent,/R250/);assert.doesNotMatch(d.querySelector('[data-offer="offer-2"]').closest('.campus-card').textContent,/Sponsored/);assert.match(d.querySelector('[data-offer="offer-3"]').closest('.campus-card').textContent,/Sponsored/);d.getElementById('maxPrice').value='100';d.getElementById('maxPrice').dispatchEvent(new w.Event('input'));assert.equal(d.querySelectorAll('.campus-card').length,1);assert.match(d.getElementById('campusListings').textContent,/Campus shuttle/);d.getElementById('clearFilters').click();d.getElementById('sortListings').value='price-low';d.getElementById('sortListings').dispatchEvent(new w.Event('change'));assert.match(d.querySelector('.campus-card h3').textContent,/Campus shuttle/);});

test('nearest sort uses coordinates and the open listing shows metres away',async()=>{
  let calls=0;
  const {w,d}=await setup([],{rooms:[
    {id:10,title:'Far room',latitude:0,longitude:0.01,is_available:true},
    {id:11,title:'Near room',latitude:0,longitude:0.00009,is_available:true},
    {id:12,title:'Unpinned room',is_available:true}
  ],ads:[],geolocation:{getCurrentPosition(ok){calls++;ok({coords:{latitude:0,longitude:0}})}}});
  try{
    assert.equal(calls,0);
    d.getElementById('sortListings').value='nearest';d.getElementById('sortListings').dispatchEvent(new w.Event('change'));
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(calls,1);
    assert.deepEqual([...d.querySelectorAll('.campus-card')].map(card=>card.dataset.entryKey),['room-11','room-10','room-12']);
    assert.match(w.location.search,/sort=nearest/);
    d.querySelector('[data-offer="room-11"]').click();
    assert.match(d.querySelector('.offer-distance').textContent,/About 10 m away/);
    d.getElementById('closeOffer').click();d.querySelector('[data-offer="room-12"]').click();
    assert.match(d.querySelector('.offer-distance').textContent,/no map pin/);
  }finally{w.close()}
});

test('denied location leaves listings usable and explains how to retry',async()=>{
  let calls=0;
  const {w,d}=await setup([],{rooms:[{id:10,title:'Pinned room',latitude:-23.9,longitude:31.1,is_available:true}],ads:[],geolocation:{getCurrentPosition(_ok,fail){calls++;fail({code:1})}}});
  try{
    d.getElementById('sortListings').value='nearest';d.getElementById('sortListings').dispatchEvent(new w.Event('change'));
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(calls,1);assert.match(d.getElementById('nearestStatus').textContent,/Allow location access/);
    assert.equal(d.getElementById('retryNearestLocation').hidden,false);
    assert.equal(d.querySelectorAll('.campus-card').length,1);
    d.querySelector('[data-offer="room-10"]').click();await new Promise(resolve=>setTimeout(resolve,10));
    assert.match(d.querySelector('.offer-distance').textContent,/Distance unavailable/);
  }finally{w.close()}
});

test('listings load immediately while search and filters stay inside the closed search dialog',async()=>{const {w,d}=await setup();try{const dialog=d.getElementById('marketSearchDialog'),toggle=d.getElementById('openMarketSearch');assert.equal(dialog.open,false);assert.equal(toggle.getAttribute('aria-expanded'),'false');assert.equal(d.querySelector('.campus-intro'),null);assert.equal(d.querySelector('.campus-brand small').textContent,'Around us');assert.equal(d.getElementById('campusSearch').closest('dialog'),dialog);assert.equal(d.querySelector('.market-refine').closest('dialog'),dialog);assert.equal(d.querySelector('.market-categories').closest('dialog'),dialog);assert.equal(d.querySelectorAll('.campus-card').length,6);toggle.click();assert.equal(dialog.open,true);assert.equal(toggle.getAttribute('aria-expanded'),'true');assert.equal(d.activeElement.id,'search');d.getElementById('closeMarketSearch').click();assert.equal(dialog.open,false);assert.equal(toggle.getAttribute('aria-expanded'),'false');}finally{w.close();}});

test('search icon opens filters, showing results closes it, and active filters can be cleared',async()=>{const {w,d}=await setup();try{const dialog=d.getElementById('marketSearchDialog'),toggle=d.getElementById('openMarketSearch');toggle.click();d.getElementById('search').value='textbooks';d.getElementById('campusSearch').dispatchEvent(new w.Event('submit',{cancelable:true}));assert.equal(dialog.open,false);assert.equal(toggle.getAttribute('aria-expanded'),'false');assert.equal(d.querySelectorAll('.campus-card').length,1);assert.match(d.getElementById('campusListings').textContent,/Biology textbooks/);assert.equal(d.getElementById('marketFilterCount').hidden,false);assert.match(toggle.getAttribute('aria-label'),/1 active filter/);toggle.click();d.getElementById('clearFilters').click();assert.equal(d.getElementById('marketFilterCount').hidden,true);assert.equal(d.querySelectorAll('.campus-card').length,6);assert.equal(dialog.open,true);}finally{w.close();}});

test('location search accepts companies, mines, schools and nearby areas',async()=>{const {w,d}=await setup();try{const offers=[{id:51,headline:'Office lunch delivery',campus:'Acme Company',area:'Business Park',category:'Food'},{id:52,headline:'Worker transport',campus:'Kopano Mine',area:'North Gate',category:'Transport'},{id:53,headline:'After-school tutoring',campus:'Sunrise School',area:'Town Centre',category:'Tutoring'}];w.fetch=async url=>({ok:true,json:async()=>url.includes('adverts')?offers:[]});d.dispatchEvent(new w.Event('market-listing-changed'));await new Promise(resolve=>setTimeout(resolve,20));for(const location of ['Acme Company','Kopano Mine','Sunrise School','Business Park']){d.getElementById('campus').value=location;d.getElementById('campusSearch').dispatchEvent(new w.Event('submit',{cancelable:true}));assert.equal(d.querySelectorAll('.campus-card').length,1,location);assert.match(d.getElementById('resultsTitle').textContent,new RegExp(location));}assert.ok([...d.querySelectorAll('#campusOptions option')].some(option=>option.value==='Business Park'));}finally{w.close();}});

test('saved view shows bookmarks together, removes an unsaved card, and returns to browsing',async()=>{const {w,d}=await setup();try{const toggle=d.getElementById('showSavedListings');assert.equal(d.querySelector('[data-saved-count]').textContent,'0');d.querySelector('[data-save="offer-2"]').click();assert.equal(d.querySelector('[data-saved-count]').textContent,'1');toggle.click();assert.equal(d.getElementById('resultsTitle').textContent,'Saved listings');assert.equal(toggle.getAttribute('aria-pressed'),'true');assert.equal(d.querySelectorAll('.campus-card').length,1);assert.match(w.location.search,/saved=1/);d.querySelector('[data-save="offer-2"]').click();assert.equal(d.querySelectorAll('.campus-card').length,0);assert.match(d.querySelector('.market-empty').textContent,/No saved listings yet/);assert.deepEqual(JSON.parse(w.localStorage.getItem('arounusSavedListings')),[]);assert.equal(d.activeElement,toggle);d.querySelector('[data-show-all-listings]').click();assert.equal(d.querySelectorAll('.campus-card').length,6);assert.doesNotMatch(w.location.search,/saved=/);}finally{w.close();}});

test('existing saved items load by direct link across locations despite previous browse filters',async()=>{const {w,d}=await setup([],{url:'https://campus.test/?saved=1&campus=Missing&q=missing&max=0',saved:['offer-1','room-3']});try{assert.equal(d.querySelectorAll('.campus-card').length,2);assert.ok(d.querySelector('[data-save="offer-1"]'));assert.ok(d.querySelector('[data-save="room-3"]'));assert.equal(d.getElementById('openMarketSearch').hidden,true);d.getElementById('showSavedListings').click();assert.equal(d.getElementById('campus').value,'Missing');assert.equal(d.querySelectorAll('.campus-card').length,0);assert.equal(d.getElementById('openMarketSearch').hidden,false);assert.match(d.getElementById('showSavedListings').getAttribute('aria-label'),/2 saved/);}finally{w.close();}});

test('failed loading preserves saved items and distinguishes failure from unavailable listings',async()=>{const {w,d}=await setup(['/marketing/adverts'],{url:'https://campus.test/?saved=1',saved:['offer-1']});try{assert.match(d.querySelector('.market-empty').textContent,/could not be loaded/);assert.doesNotMatch(d.getElementById('marketStatus').textContent,/no longer available/);assert.equal(d.getElementById('retryListings').hidden,false);assert.deepEqual(JSON.parse(w.localStorage.getItem('arounusSavedListings')),['offer-1']);}finally{w.close();}const fresh=await setup([],{url:'https://campus.test/?saved=1',saved:['room-999']});try{assert.match(fresh.d.querySelector('.market-empty').textContent,/no longer available/);assert.deepEqual(JSON.parse(fresh.w.localStorage.getItem('arounusSavedListings')),['room-999']);}finally{fresh.w.close();}});

test('saved counts and results update after a bookmark is removed in another tab',async()=>{const {w,d}=await setup([],{url:'https://campus.test/?saved=1',saved:['offer-1','room-3']});try{w.localStorage.setItem('arounusSavedListings',JSON.stringify(['room-3']));w.dispatchEvent(new w.StorageEvent('storage',{key:'arounusSavedListings'}));assert.equal(d.querySelectorAll('.campus-card').length,1);assert.ok(d.querySelector('[data-save="room-3"]'));w.localStorage.clear();w.dispatchEvent(new w.StorageEvent('storage',{key:null}));assert.match(d.querySelector('.market-empty').textContent,/No saved listings yet/);}finally{w.close();}});


test('available rooms lead the default feed even when filled rooms and other offers are newer',async()=>{
  const {w,d}=await setup([],{rooms:[
    {id:20,title:'New filled room',is_available:false,created_at:'2026-11-03'},
    {id:21,title:'Older available room',is_available:true,created_at:'2026-01-01'}
  ],ads:[{id:30,headline:'New service',category:'Tutoring',created_at:'2026-12-01'}]});
  try{
    assert.deepEqual([...d.querySelectorAll('.campus-card h3')].map(h=>h.textContent),['Older available room','New service','New filled room']);
    const available=d.querySelector('[data-entry-key="room-21"] .room-availability');
    const filled=d.querySelector('[data-entry-key="room-20"] .room-availability');
    assert.match(available.className,/--available/);assert.match(available.textContent,/Available/);
    assert.match(filled.className,/--filled/);assert.match(filled.textContent,/Filled/);
    assert.equal(d.querySelector('[data-entry-key="offer-30"] .room-availability'),null);
    assert.match(d.getElementById('marketStatus').textContent,/1 available room · 1 filled/);
  }finally{w.close()}
});

test('room category keeps filled rooms below available rooms for either price order',async()=>{
  const {w,d}=await setup([],{rooms:[
    {id:20,title:'Filled cheapest',is_available:false,monthly_rent:1},
    {id:21,title:'Available expensive',is_available:true,monthly_rent:2000},
    {id:22,title:'Available cheaper',is_available:true,monthly_rent:1000}
  ],ads:[]});
  try{
    d.querySelector('[data-category="rooms"]').click();
    for(const [sort,expected] of [['price-low',['room-22','room-21','room-20']],['price-high',['room-21','room-22','room-20']]]){
      d.getElementById('sortListings').value=sort;d.getElementById('sortListings').dispatchEvent(new w.Event('change'));
      assert.deepEqual([...d.querySelectorAll('.campus-card')].map(card=>card.dataset.entryKey),expected);
    }
  }finally{w.close()}
});

test('a filled saved room stays visible and its detail shows the filled status',async()=>{
  const {w,d}=await setup([],{url:'https://campus.test/?saved=1&listing=room-2',saved:['room-2']});
  try{
    assert.equal(d.querySelectorAll('.campus-card').length,1);
    assert.match(d.querySelector('.campus-card .room-availability').textContent,/Filled/);
    assert.equal(d.getElementById('offerDialog').open,true);
    assert.match(d.querySelector('#offerDetails .room-availability').textContent,/Filled/);
    assert.match(d.getElementById('offerDetails').textContent,/not currently available/);
    assert.doesNotMatch(d.getElementById('marketStatus').textContent,/no longer available/);
  }finally{w.close()}
});

test('provider status changes refresh room labels and ordering',async()=>{
  const options={rooms:[{id:20,title:'Changed room',is_available:false,created_at:'2026-11-03'},{id:21,title:'Other room',is_available:true,created_at:'2026-01-01'}],ads:[]};
  const {w,d}=await setup([],options);
  try{
    assert.equal(d.querySelector('.campus-card').dataset.entryKey,'room-21');
    options.rooms[0].is_available=true;
    d.dispatchEvent(new w.Event('market-listing-changed'));await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(d.querySelector('.campus-card').dataset.entryKey,'room-20');
    assert.match(d.querySelector('.campus-card .room-availability').textContent,/Available/);
    options.rooms[0].is_available=false;
    d.dispatchEvent(new w.Event('market-listing-changed'));await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(d.querySelector('.campus-card').dataset.entryKey,'room-21');
    assert.match(d.querySelector('[data-entry-key="room-20"] .room-availability').textContent,/Filled/);
  }finally{w.close()}
});


test('compact market keeps Saved access and announces counts without a visible summary panel',async()=>{
  const {w,d}=await setup();
  try {
    assert.equal(d.querySelector('.market-introduction'),null);
    assert.equal(d.querySelector('.market-trust-note'),null);
    assert.ok(d.getElementById('resultsTitle').classList.contains('sr-only'));
    assert.ok(d.getElementById('marketStatus').classList.contains('sr-only'));
    assert.equal(d.getElementById('marketStatus').getAttribute('aria-live'),'polite');
    assert.equal(d.getElementById('showSavedListings').hidden,false);
    d.querySelector('[data-save="offer-2"]').click();
    d.getElementById('showSavedListings').click();
    assert.equal(d.querySelectorAll('.campus-card').length,1);
    assert.match(w.location.search,/saved=1/);
  } finally {w.close();}
  const failed=await setup(['/marketing/adverts']);
  try {assert.equal(failed.d.getElementById('marketStatus').classList.contains('sr-only'),false);}
  finally {failed.w.close();}
});
