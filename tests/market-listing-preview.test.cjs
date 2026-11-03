const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
const html=fs.readFileSync('static/index.html','utf8');
const script=fs.readFileSync('static/market-sell.js','utf8');

async function setup(kind='room',request=async()=>({ok:true})){
  const dom=new JSDOM(html,{url:'https://arounus.test/',runScripts:'outside-only'}),w=dom.window,d=w.document;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};
  const urls=[],revoked=[],requests=[];
  w.URL.createObjectURL=file=>{const url=`blob:https://arounus.test/${urls.length}`;urls.push({url,file});return url};
  w.URL.revokeObjectURL=url=>revoked.push(url);
  w.ArounusMarketAuth={ensureSignedIn:async()=>({profile:{full_name:'Test provider',business_name:'Village shop'}}),request:async(path,options)=>{requests.push({path,options});return request(path,options)}};
  w.eval(script);d.querySelector('[data-open-sell]').click();await tick();
  d.querySelector(`[data-sell-kind="${kind}"]`).click();
  const form=d.getElementById('sellListingForm');
  const data=kind==='room'?{title:'Village room',campus:'Village',area:'Centre',monthly_rent:'1200',description:'A quiet room',contact:'0791112233'}:{headline:'Textbooks',category:'Sales & retail',price:'250',stock_quantity:'4',campus:'Village',description:'Good condition',contact:'0791112233',website_url:'https://example.test/shop'};
  for(const [name,value] of Object.entries(data))form.elements[name].value=value;
  const submit=()=>form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  return {w,d,form,submit,requests,urls,revoked};
}

test('new room preview does not publish, and editing preserves the original form and selected photos',async()=>{
  const {w,d,form,submit,requests,urls,revoked}=await setup();
  try{
    const files=[new w.File(['photo'],'room.jpg',{type:'image/jpeg'})];
    Object.defineProperty(form.elements.images,'files',{value:files});
    form.elements.latitude.value='-23.9';form.elements.longitude.value='31.1';
    submit();await tick();
    assert.equal(requests.length,0);assert.equal(form.hidden,true);
    assert.match(d.querySelector('.sell-preview-card').textContent,/Village room/);
    assert.match(d.querySelector('.sell-preview-card').textContent,/R1.?200/);
    assert.match(d.querySelector('.sell-preview-note').textContent,/administrator approval/);
    assert.equal(d.querySelector('[data-preview-main]').src,urls[0].url);
    d.querySelector('[data-edit-preview]').click();
    assert.equal(d.getElementById('sellListingForm'),form);assert.equal(form.hidden,false);
    assert.equal(form.elements.images.files[0],files[0]);assert.equal(form.elements.latitude.value,'-23.9');
    assert.deepEqual(revoked,[urls[0].url]);
    form.elements.title.value='Updated village room';submit();
    assert.match(d.querySelector('.sell-preview-card').textContent,/Updated village room/);
    assert.equal(requests.length,0);
  }finally{w.close()}
});

test('publishing shows a busy animation state, blocks repeats and Escape, then confirms success',async()=>{
  let finish;const pending=new Promise(resolve=>{finish=resolve});
  const {w,d,submit,requests}=await setup('room',()=>pending);
  try{
    submit();const confirm=d.querySelector('[data-confirm-listing]');confirm.click();confirm.click();await tick();
    assert.equal(requests.length,1);assert.equal(requests[0].path,'/marketing/listings');
    assert.equal(confirm.disabled,true);assert.equal(d.querySelector('[data-edit-preview]').disabled,true);
    assert.equal(d.querySelector('.sell-publish-progress').hidden,false);
    assert.ok(d.querySelector('.sell-publish-spinner'));
    assert.equal(d.getElementById('sellContent').getAttribute('aria-busy'),'true');
    assert.equal(d.getElementById('closeSell').disabled,true);
    const cancel=new w.Event('cancel',{cancelable:true});d.getElementById('sellDialog').dispatchEvent(cancel);assert.equal(cancel.defaultPrevented,true);
    finish({ok:true});await tick();
    assert.equal(d.querySelector('.sell-preview'),null);
    assert.match(d.getElementById('sellMessage').textContent,/submitted for approval/);
    assert.equal(d.getElementById('closeSell').disabled,false);
    assert.equal(d.getElementById('sellContent').getAttribute('aria-busy'),'false');
  }finally{finish?.({ok:true});w.close()}
});

test('an advert previews public details and publishes only after confirmation',async()=>{
  const {w,d,submit,requests}=await setup('advert');
  try{
    submit();assert.equal(requests.length,0);
    assert.match(d.querySelector('.sell-preview').textContent,/Textbooks/);
    assert.match(d.querySelector('.sell-preview-details').textContent,/0791112233/);
    assert.match(d.querySelector('.sell-preview-details').textContent,/https:\/\/example.test\/shop/);
    assert.equal(d.querySelector('[data-confirm-listing]').textContent,'Publish listing');
    d.querySelector('[data-confirm-listing]').click();await tick();
    assert.equal(requests.length,1);assert.equal(requests[0].path,'/marketing/adverts');
    assert.equal(requests[0].options.body.get('headline'),'Textbooks');
    assert.match(d.getElementById('sellMessage').textContent,/listing is published/);
  }finally{w.close()}
});

test('failed publishing keeps the draft and preview available for editing and retry',async()=>{
  let attempts=0;const {w,d,form,submit}=await setup('advert',async()=>{if(++attempts===1)throw new Error('Connection failed.');return {ok:true}});
  try{
    submit();d.querySelector('[data-confirm-listing]').click();await tick();
    assert.match(d.getElementById('sellMessage').textContent,/draft is kept/);
    assert.equal(d.querySelector('[data-confirm-listing]').disabled,false);
    assert.equal(d.querySelector('.sell-publish-progress').hidden,true);
    assert.equal(d.getElementById('closeSell').disabled,false);
    d.querySelector('[data-edit-preview]').click();assert.equal(form.hidden,false);
    assert.equal(form.elements.headline.value,'Textbooks');
    form.elements.headline.value='Updated books';submit();d.querySelector('[data-confirm-listing]').click();await tick();
    assert.equal(attempts,2);assert.match(d.getElementById('sellMessage').textContent,/published/);
  }finally{w.close()}
});

test('invalid inputs and excess photos cannot enter preview or publish, and preview text is escaped',async()=>{
  const {w,d,form,submit,requests}=await setup();
  try{
    form.elements.contact.value='12';submit();assert.equal(d.querySelector('.sell-preview'),null);
    assert.match(d.getElementById('sellMessage').textContent,/valid contact number/);
    form.elements.contact.value='0791112233';
    Object.defineProperty(form.elements.images,'files',{configurable:true,value:Array.from({length:4},()=>new w.File(['x'],'x.png',{type:'image/png'}))});
    submit();assert.equal(d.querySelector('.sell-preview'),null);assert.match(d.getElementById('sellMessage').textContent,/3 photos/);
    Object.defineProperty(form.elements.images,'files',{value:[]});
    form.elements.title.value='<img src=x onerror=alert(1)>';
    form.elements.description.value='<script>bad</script>';submit();
    assert.equal(d.querySelector('.sell-preview script,.sell-preview h3 img'),null);
    assert.match(d.querySelector('.sell-preview-description').textContent,/<script>bad<\/script>/);
    assert.equal(requests.length,0);
  }finally{w.close()}
});

test('editing a listing previews retained photos and does not update until confirmed',async()=>{
  const item={id:7,title:'Existing room',campus:'Village',area:'Centre',monthly_rent:1000,description:'Room',contact:'0791112233',is_available:false,is_approved:true,image_urls:['https://images.example.test/room.jpg']};
  const {w,d,requests}=await setup('room',async path=>path==='/marketing/landlord/listings'?[item]:path==='/marketing/my-adverts'?[]:{ok:true});
  try{
    d.querySelector('[data-sell-back]').click();d.querySelector('[data-my-listings]').click();await tick();
    d.querySelector('[data-edit-room="7"]').click();
    const form=d.getElementById('editListingForm');form.elements.monthly_rent.value='1400';
    form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    assert.equal(requests.filter(r=>r.options?.method==='PUT').length,0);
    assert.equal(d.querySelector('[data-preview-main]').src,item.image_urls[0]);
    assert.match(d.querySelector('.sell-preview-card .room-availability').textContent,/Filled/);
    d.querySelector('[data-confirm-listing]').click();await tick();
    const update=requests.find(r=>r.options?.method==='PUT');
    assert.equal(update.path,'/marketing/listings/7');
    assert.equal(update.options.body.get('monthly_rent'),'1400');
    assert.deepEqual(JSON.parse(update.options.body.get('retained_image_urls')),item.image_urls);
  }finally{w.close()}
});
