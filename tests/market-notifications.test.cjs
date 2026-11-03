const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const vm=require('node:vm');
const tick=()=>new Promise(resolve=>setTimeout(resolve,35));
const script=fs.readFileSync('static/market-notifications.js','utf8');
function setup({permission='default',standalone=false,enabled=true}={}){
  const dom=new JSDOM('<button data-market-messages>Messages</button><p data-market-notification-note></p>',{url:'https://arounus.com/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,d=w.document,calls=[];let prompts=0;
  w.sessionStorage.setItem('marketToken','market-token');
  w.matchMedia=()=>({matches:standalone});
  w.Notification={permission,requestPermission:async()=>{prompts++;w.Notification.permission='granted';return 'granted'}};
  w.PushManager=function(){};
  const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/test',toJSON(){return {endpoint:this.endpoint,keys:{p256dh:'test',auth:'test'}}}};
  Object.defineProperty(w.navigator,'serviceWorker',{value:{ready:Promise.resolve({pushManager:{getSubscription:async()=>subscription,subscribe:async()=>subscription}})}});
  w.fetch=async(path,options={})=>{calls.push({path,options});return {ok:true,json:async()=>path==='/notifications/config'?{enabled,public_key:'AA'}:path.endsWith('/unread')?{count:2}:{ok:true}}};
  w.setInterval=()=>1;w.eval(script);
  return {w,d,calls,prompts:()=>prompts};
}
test('installation asks for permission and registers the advertiser device without adding buttons',async()=>{
  const {w,d,calls,prompts}=setup();
  try{
    await tick();assert.equal(prompts(),0);
    w.dispatchEvent(new w.Event('appinstalled'));await tick();
    assert.equal(prompts(),1);assert.equal(d.querySelectorAll('button').length,1);
    const post=calls.find(c=>c.path==='/marketing/notifications/subscribe'&&c.options.method==='POST');
    assert.ok(post);assert.equal(post.options.headers['X-Landlord-Token'],'market-token');
    assert.match(d.querySelector('[data-market-notification-note]').textContent,/enabled/);
  }finally{w.close()}
});
test('an already installed app asks on its existing Messages action, once',async()=>{
  const {w,d,prompts}=setup({standalone:true});
  try{await tick();assert.equal(prompts(),0);d.querySelector('button').click();await tick();d.querySelector('button').click();await tick();assert.equal(prompts(),1)}finally{w.close()}
});
test('allowed devices reconnect automatically and detach on sign-out',async()=>{
  const {w,d,calls,prompts}=setup({permission:'granted'});
  try{
    await tick();assert.ok(calls.some(c=>c.options.method==='POST'));assert.equal(prompts(),0);
    assert.equal(d.querySelector('.market-unread-badge').textContent,'2');
    w.sessionStorage.removeItem('marketToken');d.dispatchEvent(new w.Event('market-session-changed'));await tick();
    assert.ok(calls.some(c=>c.options.method==='DELETE'&&c.options.headers['X-Landlord-Token']==='market-token'));
    assert.equal(d.querySelector('.market-unread-badge').hidden,true);
  }finally{w.close()}
});
test('blocked permission is explained without repeatedly prompting',async()=>{
  const {w,d,calls,prompts}=setup({permission:'denied',standalone:true});
  try{await tick();d.querySelector('button').click();await tick();assert.equal(prompts(),0);assert.ok(!calls.some(c=>c.options.method==='POST'));assert.match(d.querySelector('[data-market-notification-note]').textContent,/blocked/)}finally{w.close()}
});
test('unconfigured delivery is not reported as enabled',async()=>{
  const {w,d,calls}=setup({permission:'granted',enabled:false});
  try{await tick();assert.ok(!calls.some(c=>c.options.method==='POST'));assert.match(d.querySelector('[data-market-notification-note]').textContent,/not available/)}finally{w.close()}
});
test('tapping a push notification navigates an already-open app to its inbox',async()=>{
  const handlers={},actions=[];
  const self={location:{origin:'https://arounus.com'},addEventListener(type,handler){handlers[type]=handler}};
  const clients={matchAll:async()=>[{url:'https://arounus.com/',navigate:async url=>actions.push(['navigate',url]),focus:async()=>actions.push(['focus'])}],openWindow:async url=>actions.push(['open',url])};
  vm.runInNewContext(fs.readFileSync('static/service-worker.js','utf8'),{self,clients,URL,Response});
  let work;handlers.notificationclick({notification:{data:{url:'/?messages=1'},close(){}},waitUntil(p){work=p}});await work;
  assert.deepEqual(actions,[['navigate','https://arounus.com/?messages=1'],['focus']]);
});
