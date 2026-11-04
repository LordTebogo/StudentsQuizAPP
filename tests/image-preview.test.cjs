const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const tick=()=>new Promise(resolve=>setTimeout(resolve,25));
async function setup(photos=['/one.jpg','/two.jpg','/three.jpg']){
  const dom=new JSDOM(fs.readFileSync('static/index.html','utf8'),{url:'https://arounus.test/',runScripts:'outside-only'});
  const w=dom.window,d=w.document;
  w.AbortSignal=AbortSignal;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};
  w.fetch=async path=>({ok:true,json:async()=>path==='/marketing/listings'?[{id:1,title:'Room <&>',image_urls:photos,is_available:true}]:[]});
  for(const name of ['image-preview','campus-home'])w.eval(fs.readFileSync(`static/${name}.js`,'utf8'));
  await tick();d.querySelector('[data-offer]').click();
  const viewer=d.getElementById('listingImagePreview'),stage=viewer.querySelector('.image-preview-stage'),img=viewer.querySelector('img');
  Object.defineProperty(stage,'clientWidth',{value:800});Object.defineProperty(stage,'clientHeight',{value:600});
  Object.defineProperty(img,'naturalWidth',{value:1600});Object.defineProperty(img,'naturalHeight',{value:1200});
  stage.hasPointerCapture=()=>false;
  return {w,d,viewer,stage,img};
}
test('preview opens the selected original photo, moves through the gallery and returns to the listing',async()=>{
  const {w,d,viewer,img}=await setup();try{
    d.querySelector('[data-gallery-index="1"]').click();
    const trigger=d.querySelector('[data-image-preview]');assert.equal(trigger.getAttribute('aria-label'),'Preview photo 2 of 3');
    trigger.click();assert.equal(viewer.open,true);assert.equal(img.src,'https://arounus.test/two.jpg');
    assert.equal(viewer.querySelector('[data-preview-title]').textContent,'Room <&>');
    assert.equal(viewer.querySelector('[data-preview-title]').children.length,0);
    viewer.querySelector('[data-preview-step="1"]').click();
    assert.equal(img.src,'https://arounus.test/three.jpg');
    assert.equal(d.querySelector('.offer-gallery-main').src,img.src);
    viewer.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    assert.equal(img.src,'https://arounus.test/one.jpg');
    viewer.querySelector('[data-preview-close]').click();
    assert.equal(viewer.open,false);assert.equal(d.getElementById('offerDialog').open,true);
    assert.equal(img.hasAttribute('src'),false);
  }finally{w.close()}
});
test('zoom fits the image, enlarges to a bounded size, resets on photo change and supports swiping',async()=>{
  const {w,d,viewer,stage,img}=await setup();try{
    d.querySelector('[data-image-preview]').click();img.dispatchEvent(new w.Event('load'));
    assert.equal(img.style.width,'800px');assert.equal(img.style.height,'600px');
    for(let i=0;i<6;i++)viewer.querySelector('[data-preview-zoom="0.5"]').click();
    assert.equal(img.style.width,'2400px');assert.equal(viewer.querySelector('[data-preview-zoom="0.5"]').disabled,true);
    viewer.querySelector('[data-preview-fit]').click();assert.equal(img.style.width,'800px');
    assert.equal(viewer.querySelector('[data-preview-zoom="-0.5"]').disabled,true);
    img.click();assert.equal(img.style.width,'1600px');
    viewer.querySelector('[data-preview-step="1"]').click();img.dispatchEvent(new w.Event('load'));
    assert.equal(img.style.width,'800px');
    for(const [type,x] of [['pointerdown',250],['pointerup',100]]){
      const event=new w.Event(type,{bubbles:true});for(const [key,value] of Object.entries({pointerId:1,isPrimary:true,button:0,clientX:x,clientY:50,pointerType:'touch'}))Object.defineProperty(event,key,{value});stage.dispatchEvent(event);
    }
    assert.equal(img.src,'https://arounus.test/three.jpg');
  }finally{w.close()}
});
test('single-photo preview hides gallery arrows, reports image errors, and closes with its listing',async()=>{
  const {w,d,viewer,img}=await setup(['/one.jpg']);try{
    d.querySelector('[data-image-preview]').click();
    assert.ok([...viewer.querySelectorAll('[data-preview-step]')].every(button=>button.hidden));
    img.dispatchEvent(new w.Event('error'));assert.match(viewer.querySelector('[role="status"]').textContent,/could not load/);
    img.dispatchEvent(new w.Event('load'));assert.equal(viewer.querySelector('[role="status"]').textContent,'');
    d.getElementById('closeOffer').click();assert.equal(viewer.open,false);
  }finally{w.close()}
});
