const {JSDOM}=require('jsdom');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../static/index.html'),'utf8');
const script=name=>fs.readFileSync(path.join(__dirname,'../static/'+name+'.js'),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,15));
const response=(data,status=200)=>({ok:status<400,status,json:async()=>data});
function setup(){
  const dom=new JSDOM(html,{url:'https://arounus.test/',runScripts:'outside-only'}),w=dom.window;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
  w.HTMLDialogElement.prototype.close=function(){this.open=false};
  w.eval(script('market-auth'));
  return {dom,w,auth:w.ArounusMarketAuth};
}

test('guest choice uses one role-free sign-in form and resumes the pending request',async()=>{
  const {dom,w,auth}=setup();const calls=[];
  w.fetch=async(url,options)=>{
    calls.push({url,options});
    return response(url==='/marketing/login'?{role:'lecturer',token:'tutor-token',market_token:'market-token',profile:{id:8,full_name:'Tutor'}}:{ok:true});
  };
  const action=auth.request('/marketing/test',{method:'PUT'});
  assert.match(w.document.getElementById('marketAuthContent').textContent,/already have an account/);
  w.document.querySelector('[data-account-answer="yes"]').click();
  const form=w.document.getElementById('marketAuthForm');
  assert.equal(form.querySelector('select'),null);
  form.elements.identifier.value='tutor@example.test';form.elements.password.value='password';
  form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  assert.deepEqual(JSON.parse(JSON.stringify(await action)),{ok:true});
  assert.equal(w.sessionStorage.getItem('lecturerToken'),'tutor-token');
  assert.equal(w.sessionStorage.getItem('studentToken'),null);
  assert.equal(calls[1].options.headers['X-Landlord-Token'],'market-token');
  dom.window.close();
});

test('no-account choice opens advertiser signup and cancellation stops the action',async()=>{
  const {dom,w,auth}=setup();let called=false;w.fetch=()=>{called=true};
  const result=auth.request('/marketing/test');
  w.document.querySelector('[data-account-answer="no"]').click();
  assert.match(w.document.getElementById('marketAuthTitle').textContent,/advertiser/);
  for(const name of ['full_name','phone','email','password','confirm_password'])assert.ok(w.document.querySelector(`[name=${name}]`));
  w.document.querySelector('[data-close-market-auth]').click();
  assert.equal(await result,null);assert.equal(called,false);dom.window.close();
});

for(const role of ['student','lecturer','landlord'])test(`existing ${role} session connects without a question and keeps its original login`,async()=>{
  const {dom,w,auth}=setup();const key=role+'Token';w.sessionStorage.setItem(key,'native-token');let calls=0;
  w.fetch=async(url,options)=>{
    calls++;assert.equal(url,'/marketing/session');
    assert.equal(options.headers[{'student':'X-Student-Token','lecturer':'X-Lecturer-Token','landlord':'X-Landlord-Token'}[role]],'native-token');
    return response({role,token:'native-token',market_token:'linked-token',profile:{id:9,full_name:'Account'}});
  };
  assert.equal((await auth.ensureSignedIn()).market_token,'linked-token');
  await auth.ensureSignedIn();assert.equal(calls,1);
  assert.equal(w.document.getElementById('marketAuthDialog').open,false);
  assert.equal(w.sessionStorage.getItem(key),'native-token');
  // Logging out in the learning area must also invalidate cached market access.
  w.sessionStorage.removeItem(key);
  const guest=auth.ensureSignedIn();assert.equal(w.document.getElementById('marketAuthDialog').open,true);
  w.document.querySelector('[data-close-market-auth]').click();assert.equal(await guest,null);
  dom.window.close();
});

test('expired source is cleared and shared sign-in recovers from a wrong password',async()=>{
  const {dom,w,auth}=setup();w.sessionStorage.setItem('studentToken','expired');
  w.fetch=async()=>response({detail:'Sign in again'},401);
  const result=auth.ensureSignedIn();await tick();
  assert.equal(w.sessionStorage.getItem('studentToken'),null);
  w.document.querySelector('[data-account-answer="yes"]').click();
  const form=w.document.getElementById('marketAuthForm');form.elements.identifier.value='learner';form.elements.password.value='wrong';
  form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();
  assert.equal(w.document.getElementById('marketAuthStatus').textContent,'Sign in again');
  assert.equal(form.querySelector('button').disabled,false);
  w.document.querySelector('[data-close-market-auth]').click();assert.equal(await result,null);dom.window.close();
});

test('market inbox groups provider conversations and replies to the actual account type',async()=>{
  const {dom,w}=setup();w.sessionStorage.setItem('lecturerToken','tutor-token');let sent;
  w.fetch=async(url,options={})=>{
    if(url==='/marketing/session')return response({role:'lecturer',token:'tutor-token',market_token:'market-token',profile:{id:9,full_name:'Tutor'}});
    if(url.endsWith('/read'))return response({ok:true});
    if(options.method==='POST'){sent=JSON.parse(options.body);return response({ok:true});}
    return response([{id:1,peer_type:'landlord',peer_id:7,peer_name:'Campus provider',sender_type:'landlord',sender_id:7,recipient_type:'landlord',recipient_id:9,sender_name:'Campus provider',content:'Welcome',is_outgoing:false},{id:2,peer_type:'landlord',peer_id:7,peer_name:'Campus provider',sender_type:'landlord',sender_id:9,recipient_type:'landlord',recipient_id:7,sender_name:'Tutor',content:'Thank you',is_outgoing:true}]);
  };
  w.eval(script('market-sell'));w.document.querySelector('[data-market-messages]').click();await tick();
  assert.equal(w.document.querySelectorAll('[data-reply-to]').length,1);
  const form=w.document.querySelector('[data-reply-to]');assert.equal(form.dataset.replyTo,'landlord:7');
  form.elements.content.value='Is this available?';form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();
  assert.equal(sent.recipient_type,'landlord');assert.equal(sent.recipient_id,7);dom.window.close();
});
