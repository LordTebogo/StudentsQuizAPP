(() => {
  const dialog = document.getElementById('marketAuthDialog');
  if (!dialog) return;
  const content = document.getElementById('marketAuthContent');
  const title = document.getElementById('marketAuthTitle');
  const status = document.getElementById('marketAuthStatus');
  const roles = {student:{key:'studentToken',header:'X-Student-Token',active:'student'},lecturer:{key:'lecturerToken',header:'X-Lecturer-Token',active:'lecturer'},landlord:{key:'landlordToken',header:'X-Landlord-Token',active:'advertiser'}};
  let pending = null, complete = null, mode = 'question';
  const clearMarketSession = () => ['marketToken','marketSessionSource','marketProfile'].forEach(key=>sessionStorage.removeItem(key));
  function sources() {
    const active = sessionStorage.getItem('activeRole');
    return Object.entries(roles).filter(([,value])=>sessionStorage.getItem(value.key)).sort((a,b)=>Number(b[1].active===active)-Number(a[1].active===active));
  }
  function save(result) {
    const role = roles[result.role];
    if (!role || !result.token || !result.market_token) throw new Error('Sign in could not be completed. Please try again.');
    Object.values(roles).forEach(value=>sessionStorage.removeItem(value.key));
    sessionStorage.setItem(role.key,result.token);
    sessionStorage.setItem('activeRole',role.active);
    cache(result,role);
  }
  function cache(result,role) {
    sessionStorage.setItem('marketToken',result.market_token);
    sessionStorage.setItem('marketSessionSource',role.key+':'+result.token);
    sessionStorage.setItem('marketProfile',JSON.stringify(result.profile));
    document.dispatchEvent(new Event('market-session-changed'));
  }
  async function post(path,body,headers={}) {
    const response=await fetch(path,{method:'POST',headers:body instanceof FormData?headers:{'Content-Type':'application/json',...headers},body:body instanceof FormData?body:JSON.stringify(body)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){const error=new Error(typeof data.detail==='string'?data.detail:'Sign in could not be completed. Please try again.');error.status=response.status;throw error;}
    return data;
  }
  function render(next='question') {
    mode=next;status.textContent='';status.classList.remove('error');
    if(mode==='question') {
      title.textContent='Your Arounus account';
      content.innerHTML='<p>Do you already have an account in Arounus?</p><div class="sell-tabs market-account-choice"><button type="button" data-account-answer="yes">Yes, sign in</button><button type="button" data-account-answer="no">No, create an account</button></div>';
    } else {
      const register=mode==='register';
      title.textContent=register?'Create an advertiser account':'Sign in to Arounus';
      content.innerHTML=`<button class="sell-back" type="button" data-account-back>← Back</button><p>${register?'Create one account to message providers, rate listings, and sell or list.':'Use your learner, tutor or advertiser account. We will recognise your account automatically.'}</p><form id="marketAuthForm" class="sell-form">
        ${register?'<label>Full name<input name="full_name" autocomplete="name" required></label><label>Business or service name <span>(optional)</span><input name="business_name" autocomplete="organization"></label><label>Contact number<input name="phone" type="tel" autocomplete="tel" required></label>':''}
        <label>${register?'Email':'Email or learner username'}<input name="${register?'email':'identifier'}" type="${register?'email':'text'}" autocomplete="${register?'email':'username'}" required></label>
        <label>Password<input name="password" type="password" autocomplete="${register?'new-password':'current-password'}" ${register?'minlength="8"':''} required></label>
        ${register?'<label>Confirm password<input name="confirm_password" type="password" autocomplete="new-password" minlength="8" required></label>':''}
        <button type="submit">${register?'Create advertiser account':'Sign in'}</button></form>`;
    }
    (content.querySelector('input')||content.querySelector('button'))?.focus();
  }
  function finish(result) {
    const resolve=complete;complete=null;
    if(dialog.open)dialog.close();
    resolve?.(result);
  }
  async function connect() {
    for(const [kind,role] of sources()) {
      const token=sessionStorage.getItem(role.key);
      if(sessionStorage.getItem('marketToken')&&sessionStorage.getItem('marketSessionSource')===role.key+':'+token) {
        try{return {market_token:sessionStorage.getItem('marketToken'),profile:JSON.parse(sessionStorage.getItem('marketProfile')),role:kind};}catch{clearMarketSession();}
      }
      try {
        const result=await post('/marketing/session',{}, {[role.header]:token});
        cache(result,role);
        return result;
      } catch(error) {
        if(error.status!==401)throw error;
        sessionStorage.removeItem(role.key);clearMarketSession();
      }
    }
    clearMarketSession();
    return new Promise(resolve=>{
      complete=resolve;
      if(!dialog.open)dialog.showModal();
      render();
    });
  }
  function ensureSignedIn() {
    if(!pending)pending=connect().finally(()=>{pending=null;});
    return pending;
  }
  dialog.addEventListener('click',event=>{
    const choice=event.target.closest('[data-account-answer]');
    if(choice)render(choice.dataset.accountAnswer==='yes'?'login':'register');
    if(event.target.closest('[data-account-back]'))render();
    if(event.target.closest('[data-close-market-auth]'))finish(null);
  });
  dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null);});
  dialog.addEventListener('close',()=>{if(complete)finish(null);});
  dialog.addEventListener('submit',async event=>{
    if(event.target.id!=='marketAuthForm')return;
    event.preventDefault();
    const form=event.target,button=form.querySelector('[type=submit]');
    button.disabled=true;status.textContent=mode==='register'?'Creating your account…':'Signing in…';status.classList.remove('error');
    try {
      let result;
      if(mode==='register') {
        const data=new FormData(form);
        if(data.get('password')!==data.get('confirm_password'))throw new Error('Passwords do not match.');
        const registered=await post('/marketing/landlords/register',data);
        result={...registered,role:'landlord',market_token:registered.token};
      } else result=await post('/marketing/login',{identifier:form.elements.identifier.value.trim(),password:form.elements.password.value});
      if(!dialog.open)return;
      save(result);finish(result);
    } catch(error) {status.textContent=error.message;status.classList.add('error');}
    finally {if(form.isConnected)button.disabled=false;}
  });
  async function request(path,options={},retry=true) {
    const session=await ensureSignedIn();
    if(!session)return null;
    const response=await fetch(path,{...options,headers:{...options.headers,'X-Landlord-Token':session.market_token}});
    const data=await response.json().catch(()=>({}));
    if(response.status===401&&retry){clearMarketSession();return request(path,options,false);}
    if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'The request could not be completed.');
    return data;
  }
  function signOut() {
    Object.values(roles).forEach(role=>sessionStorage.removeItem(role.key));
    sessionStorage.removeItem('activeRole');clearMarketSession();
    document.dispatchEvent(new Event('market-session-changed'));
  }
  window.ArounusMarketAuth={ensureSignedIn,request,signOut};
})();
