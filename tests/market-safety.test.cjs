const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
const safety=fs.readFileSync('static/market-safety.js','utf8');
const home=fs.readFileSync('static/campus-home.js','utf8');
function setup(fetch){
  const dom=new JSDOM(fs.readFileSync('static/index.html','utf8'),{url:'https://arounus.com/',runScripts:'outside-only'});
  const w=dom.window;
  w.AbortSignal=AbortSignal;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
  w.HTMLDialogElement.prototype.close=function(){this.open=false};
  w.fetch=fetch;
  w.eval(safety);
  return {w,d:w.document};
}
test('grid report opens a prefilled guest form without opening listing; content is escaped',async()=>{
  const {w,d}=setup(async url=>({ok:true,json:async()=>url.includes('adverts')?[]:[{id:7,title:'Room <script>bad</script>',is_available:true,is_verified:true,landlord:{name:'Provider',verified:true}}]}));
  try{
    w.eval(home); await tick();
    d.querySelector('[data-report-listing]').click();
    assert.equal(d.getElementById('offerDialog').open,false);
    assert.equal(d.getElementById('marketReportDialog').open,true);
    assert.equal(d.querySelector('.market-report-name').textContent,'Room <script>bad</script>');
    assert.equal(d.querySelector('.market-report-name script'),null);
    assert.equal(d.querySelector('[name=listing]').value,'https://arounus.com/listing/room/7');
    assert.equal(d.querySelector('.verified-badge'),null);
  }finally{w.close()}
});
for(const success of [true,false])test(`report ${success?'success gives a reference':'failure allows retry and offers support'}`,async()=>{
  let sent;
  const {w,d}=setup(async(url,options)=>{sent={url,body:JSON.parse(options.body)};return {ok:success,json:async()=>success?{reference:42}:{detail:'Please retry later.'}}});
  try{
    const trigger=d.createElement('a');trigger.dataset.reportListing='offer-9';d.body.append(trigger);trigger.click();
    d.querySelector('[name=reason]').value='suspicious';
    d.querySelector('[name=details]').value='  Unusual payment request  ';
    d.querySelector('.market-report-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();
    assert.deepEqual(sent,{url:'/marketing/reports',body:{kind:'offer',listing_id:9,reason:'suspicious',details:'Unusual payment request'}});
    assert.match(d.querySelector('.market-report-status').textContent,success?/#42/:/arounus.com@gmail.com/);
    assert.equal(d.querySelector('.market-report-form button').disabled,success);
  }finally{w.close()}
});
test('report form rejects a link to another website',async()=>{
  let called=false; const {w,d}=setup(async()=>{called=true});
  try{
    const trigger=d.createElement('a');trigger.dataset.reportListing='room-7';d.body.append(trigger);trigger.click();
    d.querySelector('[name=listing]').value='https://evil.example/listing/room/7';
    d.querySelector('[name=reason]').value='outdated';
    d.querySelector('form.market-report-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
    assert.equal(called,false);assert.match(d.querySelector('.market-report-status').textContent,/Arounus listing link/);
  }finally{w.close()}
});
test('administrator queue escapes report text and supports reviewed and reopened states',async()=>{
  const dom=new JSDOM('<div id="appWrap"><div class="admin-content"><section id="mediaFinanceCard"></section></div></div>',{url:'https://arounus.com/admin',runScripts:'outside-only'});
  const w=dom.window,d=w.document;let status='open';const changes=[];
  w.api=async(url,options)=>{
    if(options){changes.push(JSON.parse(options.body));status=JSON.parse(options.body).status;return {ok:true};}
    if(url.startsWith('/admin/market-reports'))return [{id:4,kind:'room',listing_id:7,listing_title:'Room <img src=x>',details:'<script>bad</script>',reason:'outdated',status,created_at:'2026-11-02T00:00:00Z'}];
    return [];
  };
  try{
    w.eval(fs.readFileSync('static/admin-market-ads.js','utf8'));
    d.dispatchEvent(new w.Event('DOMContentLoaded'));await tick();
    const list=d.getElementById('marketReportAdminList');
    assert.equal(list.querySelector('img,script'),null);
    assert.match(list.textContent,/<script>bad<\/script>/);
    list.querySelector('[data-review-status]').click();await tick();
    assert.deepEqual(changes,[{status:'resolved'}]);
    assert.equal(list.querySelector('[data-review-status]').textContent,'Reopen report');
    list.querySelector('[data-review-status]').click();await tick();
    assert.deepEqual(changes,[{status:'resolved'},{status:'open'}]);
  }finally{w.close()}
});
