(() => {
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]));
  const studentToken = () => sessionStorage.getItem('studentToken') || '';
  const providerToken = () => sessionStorage.getItem('landlordToken') || '';
  const headers = () => studentToken() ? {'X-Student-Token': studentToken()} : providerToken() ? {'X-Landlord-Token': providerToken()} : {};
  const request = async (path, options = {}) => {
    options.headers = Object.assign({}, options.headers, headers());
    const response = await fetch(path, options); const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || 'Could not complete that request'); return data;
  };
  const formatTime = value => { try { return new Intl.DateTimeFormat('en-ZA',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Johannesburg'}).format(new Date(value)); } catch (_) { return value; } };

  const messageDialog = document.createElement('dialog');
  messageDialog.id = 'providerMessageDialog'; messageDialog.className = 'market-auth-dialog provider-message-dialog';
  messageDialog.innerHTML = `<form method="dialog"><button class="provider-message-close" value="cancel" aria-label="Close">×</button></form><span class="market-kicker">Private conversation</span><h2 id="providerMessageTitle">Message provider</h2><p>Only you and this provider can see this message.</p><textarea id="providerMessageText" maxlength="2000" placeholder="Write your private message..."></textarea><div class="market-auth-actions"><button class="btn" id="sendProviderMessage" type="button">Send message</button><button class="btn secondary" id="cancelProviderMessage" type="button">Cancel</button></div><div id="providerMessageStatus" aria-live="polite"></div>`;
  document.body.appendChild(messageDialog);
  let messageRecipient = null;
  const closeComposer = () => messageDialog.open ? messageDialog.close() : messageDialog.removeAttribute('open');
  document.getElementById('cancelProviderMessage').addEventListener('click', closeComposer);
  document.getElementById('sendProviderMessage').addEventListener('click', async event => {
    const content = document.getElementById('providerMessageText').value.trim(); const status = document.getElementById('providerMessageStatus');
    if (!content) { status.textContent = 'Write a message first.'; return; }
    event.currentTarget.disabled = true;
    try {
      const endpoint = studentToken() ? '/student/messages' : '/marketing/provider/messages';
      await request(endpoint, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({recipient_type:'landlord',recipient_id:messageRecipient.id,content,is_anonymous:false})});
      document.getElementById('providerMessageText').value = ''; status.textContent = 'Private message sent.';
      window.setTimeout(closeComposer, 650); loadProviderInbox();
    } catch (error) { status.textContent = error.message; }
    finally { event.currentTarget.disabled = false; }
  });
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-provider-message]'); if (!trigger) return;
    if (!studentToken() && !providerToken()) { window.showMarketAuthDialog?.(); return; }
    messageRecipient = {id:Number(trigger.dataset.providerMessage), name:trigger.dataset.providerName || 'provider'};
    document.getElementById('providerMessageTitle').textContent = `Message ${messageRecipient.name}`;
    document.getElementById('providerMessageStatus').textContent = '';
    if (typeof messageDialog.showModal === 'function') messageDialog.showModal(); else messageDialog.setAttribute('open','');
    window.setTimeout(() => document.getElementById('providerMessageText').focus(), 50);
  });

  const panel = document.getElementById('landlordPanel');
  if (!panel) return;
  const inbox = document.createElement('section'); inbox.id = 'providerInbox'; inbox.className = 'provider-inbox hidden';
  inbox.innerHTML = `<div class="provider-inbox-head"><div><span class="market-kicker">Private communication</span><h3>Customer messages</h3><p class="notice">Reply separately or send one availability update to everyone who contacted you.</p></div><button class="btn secondary" id="refreshProviderInbox" type="button">Refresh</button></div><div class="provider-broadcast"><label for="providerBroadcastText">Message everyone who contacted you</label><textarea id="providerBroadcastText" maxlength="2000" placeholder="Example: Sorry for not responding earlier. I am unavailable this week. Please remind me next Monday."></textarea><div class="listing-actions"><button class="btn" id="sendProviderBroadcast" type="button">Send to all contacts</button><span id="providerBroadcastStatus" aria-live="polite"></span></div></div><div class="provider-conversations"><div id="providerThreadList" class="provider-thread-list"></div><div id="providerThreadView" class="provider-thread-view"><p class="notice">Choose a conversation to read and reply.</p></div></div>`;
  panel.appendChild(inbox);
  let providerProfile = null, providerMessages = [], activeKey = '';
  const conversationKey = message => {
    const sent = message.sender_type === 'landlord' && message.sender_id === providerProfile?.id;
    return `${sent ? message.recipient_type : message.sender_type}:${sent ? message.recipient_id : message.sender_id}`;
  };
  const conversationName = message => message.sender_type === 'landlord' && message.sender_id === providerProfile?.id ? message.recipient_name : message.sender_name;
  function renderProviderInbox() {
    const groups = new Map();
    [...providerMessages].reverse().forEach(message => { const key=conversationKey(message); if(!groups.has(key))groups.set(key,{key,name:conversationName(message),messages:[]}); groups.get(key).messages.push(message); });
    const conversations = [...groups.values()].sort((a,b) => String(b.messages.at(-1)?.created_at).localeCompare(String(a.messages.at(-1)?.created_at)));
    const list = document.getElementById('providerThreadList');
    list.innerHTML = conversations.length ? conversations.map(item => `<button type="button" data-provider-thread="${esc(item.key)}" class="${item.key===activeKey?'active':''}"><strong>${esc(item.name)}</strong><span>${esc(item.messages.at(-1).content.slice(0,70))}</span></button>`).join('') : '<p class="notice">No private messages yet.</p>';
    list.querySelectorAll('[data-provider-thread]').forEach(button => button.addEventListener('click', () => { activeKey=button.dataset.providerThread; renderProviderInbox(); }));
    if (!activeKey && conversations.length) activeKey = conversations[0].key;
    const active = groups.get(activeKey); const view = document.getElementById('providerThreadView');
    if (!active) { view.innerHTML='<p class="notice">Choose a conversation to read and reply.</p>'; return; }
    const [recipient_type, recipient_id] = active.key.split(':');
    view.innerHTML = `<div class="provider-thread-title"><strong>${esc(active.name)}</strong><span>Private conversation</span></div><div class="provider-message-history">${active.messages.map(message=>{const sent=message.sender_type==='landlord'&&message.sender_id===providerProfile.id;return `<article class="provider-message ${sent?'sent':'received'}"><p>${esc(message.content)}</p><time>${esc(formatTime(message.created_at))}</time></article>`}).join('')}</div><label for="providerReplyText">Reply to ${esc(active.name)}</label><textarea id="providerReplyText" maxlength="2000" placeholder="Write a private reply..."></textarea><div class="listing-actions"><button class="btn" id="sendProviderReply" type="button">Send reply</button><span id="providerReplyStatus" aria-live="polite"></span></div>`;
    document.getElementById('sendProviderReply').addEventListener('click', async event => {
      const content=document.getElementById('providerReplyText').value.trim(),status=document.getElementById('providerReplyStatus');if(!content){status.textContent='Write a reply first.';return}event.currentTarget.disabled=true;
      try{await request('/marketing/provider/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipient_type,recipient_id:Number(recipient_id),content,is_anonymous:false})});await loadProviderInbox()}catch(error){status.textContent=error.message}finally{event.currentTarget.disabled=false}
    });
  }
  async function loadProviderInbox() {
    if (!providerToken() || panel.classList.contains('hidden')) { inbox.classList.add('hidden'); return; }
    inbox.classList.remove('hidden');
    try { [providerProfile, providerMessages] = await Promise.all([request('/marketing/landlords/me'),request('/marketing/provider/messages')]); renderProviderInbox(); }
    catch (error) { document.getElementById('providerThreadView').innerHTML=`<div class="msg error">${esc(error.message)}</div>`; }
  }
  document.getElementById('refreshProviderInbox').addEventListener('click', loadProviderInbox);
  document.getElementById('sendProviderBroadcast').addEventListener('click', async event => {
    const content=document.getElementById('providerBroadcastText').value.trim(),status=document.getElementById('providerBroadcastStatus');if(!content){status.textContent='Write an update first.';return}event.currentTarget.disabled=true;
    try{const result=await request('/marketing/provider/messages/broadcast',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content})});document.getElementById('providerBroadcastText').value='';status.textContent=`Sent privately to ${result.recipient_count} contact${result.recipient_count===1?'':'s'}.`;await loadProviderInbox()}catch(error){status.textContent=error.message}finally{event.currentTarget.disabled=false}
  });
  new MutationObserver(loadProviderInbox).observe(panel,{attributes:true,attributeFilter:['class']});
  loadProviderInbox();
})();
