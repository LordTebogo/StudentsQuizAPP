(() => {
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  let installed = false;
  const time = value => { try { return new Intl.DateTimeFormat('en-ZA',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Johannesburg'}).format(new Date(value)); } catch (_) { return value; } };
  async function load() {
    const list=document.getElementById('adminMessageHistory'); if(!list)return;
    try { const messages=await api('/admin/messages'); list.innerHTML=messages.length?messages.map(message=>`<article class="message-bubble ${message.sender_type==='admin'?'sent':'received'}"><header><strong>${esc(message.sender_type==='admin'?`To ${message.recipient_name}`:`From ${message.sender_name}`)}</strong>${message.is_anonymous?'<span class="privacy-pill">Anonymous</span>':''}<time>${esc(time(message.created_at))}</time></header><p>${esc(message.content)}</p></article>`).join(''):'<p class="muted">No messages yet.</p>'; } catch(error){list.innerHTML=`<div class="msg error">${esc(error.message)}</div>`;}
  }
  function install(){
    if(installed||!document.getElementById('appWrap'))return;installed=true;
    const card=document.createElement('section');card.className='card';card.id='adminMessagingCenter';card.innerHTML=`<div class="admin-editor-heading"><div><span class="kicker">Platform communication</span><h2>Student messages</h2></div><button class="btn secondary" id="refreshAdminMessages" type="button">Refresh</button></div>
      <div class="message-mode"><button class="active" type="button">All students</button></div><p class="muted">Send one private copy to every active, approved student. Individual messaging remains available from each student or lecturer profile.</p>
      <label for="adminBroadcastText">Announcement</label><textarea id="adminBroadcastText" maxlength="2000" placeholder="Write an important platform message"></textarea>
      <div class="message-compose-actions"><button class="btn" id="sendAdminBroadcast" type="button">Send to all students</button><span id="adminBroadcastMsg" aria-live="polite"></span></div>
      <details class="message-history" open><summary>All message history</summary><div id="adminMessageHistory" class="message-timeline"></div></details>`;
    const studentCard=[...document.querySelectorAll('#appWrap .card')].find(item=>item.querySelector('h2')?.textContent.trim()==='Student management'); studentCard?.insertAdjacentElement('afterend',card);
    document.getElementById('refreshAdminMessages').addEventListener('click',load);
    document.getElementById('sendAdminBroadcast').addEventListener('click',async()=>{const content=document.getElementById('adminBroadcastText').value.trim(),status=document.getElementById('adminBroadcastMsg');if(!content){status.textContent='Write a message first.';return;}if(!confirm('Send this message to every active student?'))return;try{const result=await api('/admin/messages/broadcast',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content,module_codes:[]})});document.getElementById('adminBroadcastText').value='';status.textContent=`Sent to ${result.recipient_count} student${result.recipient_count===1?'':'s'}.`;load();}catch(error){status.textContent=error.message;}});load();
  }
  document.addEventListener('DOMContentLoaded',()=>{const wrap=document.getElementById('appWrap');if(!wrap)return;new MutationObserver(()=>{if(!wrap.classList.contains('hidden')){install();load();}}).observe(wrap,{attributes:true,attributeFilter:['class']});if(!wrap.classList.contains('hidden'))install();});
})();
