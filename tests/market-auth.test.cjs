const {JSDOM}=require('jsdom');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../static/index.html'),'utf8');
const script=name=>fs.readFileSync(path.join(__dirname,'../static/'+name+'.js'),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,15));
const response=(data,status=200)=>({ok:status<400,status,json:async()=>data});
function setup(url='https://arounus.test/'){
  const dom=new JSDOM(html,{url,runScripts:'outside-only'}),w=dom.window;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
  w.HTMLDialogElement.prototype.close=function(){this.open=false};
  w.eval(script('market-auth'));
  return {dom,w,auth:w.ArounusMarketAuth};
}

test('footer account links open market sign in and customer sign up',()=>{
  for(const mode of ['login','register']){
    const {dom,w}=setup('https://arounus.test/?account='+mode);
    w.dispatchEvent(new w.Event('load'));
    assert.equal(w.document.getElementById('marketAuthDialog').open,true);
    assert.equal(Boolean(w.document.getElementById('marketAuthForm')),true);
    if(mode==='register')assert.equal(w.document.querySelector('[name=provider_type]').value,'customer');
    assert.equal(w.location.search,'');
    w.close();
  }
});

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
  assert.match(w.document.getElementById('marketAuthTitle').textContent,/market account/);
  for(const name of ['full_name','phone','email','password','confirm_password'])assert.ok(w.document.querySelector(`[name=${name}]`));
  w.document.querySelector('[data-close-market-auth]').click();
  assert.equal(await result,null);assert.equal(called,false);dom.window.close();
});

test('contact flow offers a customer account with optional phone and agent photo upload',async()=>{
  const {dom,w,auth}=setup();
  const pending=auth.ensureSignedIn('browse');
  w.document.querySelector('[data-account-answer="no"]').click();
  const form=w.document.getElementById('marketAuthForm');
  assert.equal(form.elements.provider_type.value,'customer');
  assert.equal(form.elements.phone.required,false);
  assert.ok(form.elements.profile_image);
  form.elements.provider_type.value='agent';
  form.elements.provider_type.dispatchEvent(new w.Event('change'));
  assert.equal(form.elements.phone.required,true);
  w.document.querySelector('[data-close-market-auth]').click();
  assert.equal(await pending,null);
  dom.window.close();
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
    if(url.endsWith('/read')||url.endsWith('/read-items'))return response({ok:true});
    if(options.method==='POST'){sent=JSON.parse(options.body);return response({ok:true});}
    return response([{id:1,peer_type:'landlord',peer_id:7,peer_name:'Campus provider',sender_type:'landlord',sender_id:7,recipient_type:'landlord',recipient_id:9,sender_name:'Campus provider',content:'Welcome',is_outgoing:false},{id:2,peer_type:'landlord',peer_id:7,peer_name:'Campus provider',sender_type:'landlord',sender_id:9,recipient_type:'landlord',recipient_id:7,sender_name:'Tutor',content:'Thank you',is_outgoing:true}]);
  };
  w.eval(script('chat-ui'));w.eval(script('market-sell'));w.document.querySelector('[data-market-messages]').click();await tick();
  assert.equal(w.document.querySelectorAll('.chat-contact').length,1);
  w.document.querySelector('.chat-contact').click();
  const form=w.document.querySelector('.chat-composer');
  form.elements.message.value='Is this available?';form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();
  assert.equal(sent.recipient_type,'landlord');assert.equal(sent.recipient_id,7);dom.window.close();
});
