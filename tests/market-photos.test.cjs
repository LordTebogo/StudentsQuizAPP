const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function setup(){
  const dom=new JSDOM('<img id="photo">',{url:'https://arounus.test/',runScripts:'outside-only'});
  const w=dom.window,loads=[];
  w.arounusThumb=(url,width)=>url+'?w='+width;
  w.Image=class{set src(value){this._src=value;loads.push(this)}get src(){return this._src}async decode(){}};
  w.eval(fs.readFileSync('static/market-photos.js','utf8'));
  const photo=w.document.getElementById('photo'),sources=['https://images.test/one.jpg','https://images.test/two.jpg','https://images.test/three.jpg'];
  async function finish(url,success=true){const image=loads.findLast(x=>x.src===url);assert.ok(image,url);if(success)await image.onload();else image.onerror();await tick()}
  return {w,photo,sources,loads,api:w.ArounusPhotos,finish};
}
test('preloads light copies and switches synchronously to the correct thumbnail while larger requests remain slow',async()=>{
  const {w,photo,sources,loads,api,finish}=setup();try{
    api.prepare(sources);
    assert.equal(loads.length,6);
    assert.ok(loads.every(x=>x.src.includes('?w=')));
    for(const src of sources)await finish(src+'?w=160');
    api.show(photo,sources[0]);
    assert.equal(photo.src,sources[0]+'?w=160');
    api.show(photo,sources[1]);
    assert.equal(photo.src,sources[1]+'?w=160');
    assert.equal(photo.hasAttribute('data-photo-pending'),false);
    assert.equal(loads.length,6);
    await finish(sources[1]+'?w=960');
    assert.equal(photo.src,sources[1]+'?w=960');
    api.show(photo,sources[1]);assert.equal(photo.src,sources[1]+'?w=960');
  }finally{w.close()}
});
test('rapid arrow changes cannot be overwritten by late downloads for an earlier photo',async()=>{
  const {w,photo,sources,api,finish}=setup();try{
    api.prepare(sources);for(const src of sources)await finish(src+'?w=160');
    api.show(photo,sources[0]);api.show(photo,sources[1]);api.show(photo,sources[2]);
    await finish(sources[0]+'?w=960');await finish(sources[1]+'?w=960');
    assert.equal(photo.src,sources[2]+'?w=160');
    await finish(sources[2]+'?w=960');assert.equal(photo.src,sources[2]+'?w=960');
  }finally{w.close()}
});
test('zoom alone requests the original, keeps the ready image visible, and closing prevents late replacement',async()=>{
  const {w,photo,sources,loads,api,finish}=setup();try{
    api.prepare(sources);await finish(sources[0]+'?w=960');
    api.show(photo,sources[0]);assert.equal(photo.src,sources[0]+'?w=960');
    assert.ok(loads.every(x=>x.src!==sources[0]));
    api.show(photo,sources[0],{full:true});
    assert.ok(loads.some(x=>x.src===sources[0]));
    assert.equal(photo.src,sources[0]+'?w=960');assert.equal(photo.hasAttribute('data-photo-pending'),false);
    api.cancel(photo);photo.removeAttribute('src');await finish(sources[0]);
    assert.equal(photo.hasAttribute('src'),false);
  }finally{w.close()}
});
test('a failed larger image leaves its small copy visible; failed photos can retry',async()=>{
  const {w,photo,sources,api,finish}=setup();try{
    api.prepare(sources);await finish(sources[0]+'?w=160');
    let errors=0;api.show(photo,sources[0],{onError:()=>errors++});await finish(sources[0]+'?w=960',false);
    assert.equal(photo.src,sources[0]+'?w=160');assert.equal(errors,0);
    api.show(photo,sources[0]);await finish(sources[0]+'?w=960');assert.equal(photo.src,sources[0]+'?w=960');
    api.show(photo,sources[1],{onError:()=>errors++});await finish(sources[1]+'?w=160',false);await finish(sources[1]+'?w=960',false);
    assert.equal(errors,1);
    api.show(photo,sources[1]);await finish(sources[1]+'?w=160');assert.equal(photo.src,sources[1]+'?w=160');
  }finally{w.close()}
});
