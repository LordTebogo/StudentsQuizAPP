/* Shared private conversation view. Drafts stay in memory for this view only. */
(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const roleName = type => ({student:'Learner',lecturer:'Tutor',landlord:'Market contact',admin:'Administrator'}[type] || 'Private conversation');
  const date = (value, short=false) => { const d=new Date(value); return isNaN(d)?'':new Intl.DateTimeFormat('en-ZA',short?{day:'numeric',month:'short'}:{hour:'2-digit',minute:'2-digit'}).format(d); };
  function avatar(name, url) {
    let safe=''; try { const u=new URL(url,location.origin); if(url && ['http:','https:'].includes(u.protocol))safe=u.href; } catch (_) {}
    const initials=String(name||'?').trim().split(/\s+/).slice(0,2).map(p=>Array.from(p)[0]||'').join('').toUpperCase();
    return `<span class="chat-avatar" aria-hidden="true"><span>${esc(initials)}</span>${safe?`<img src="${esc(safe)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:''}</span>`;
  }
  function mount(host, config) {
    host._arounusChat?.destroy();
    let rows=[],contacts=[],selected=null,filter='',busy=false,loading=false,dead=false,timer,signature='';
    const drafts=new Map(),readPending=new Set(); let threads=new Map();
    host.classList.add('arounus-chat');
    host.innerHTML=`<aside class="chat-sidebar" aria-label="Conversations"><div class="chat-list-heading"><div><span class="chat-kicker">YOUR INBOX</span><h3>Chats <span data-chat-count></span></h3></div><button type="button" class="chat-refresh" aria-label="Refresh conversations">↻</button></div><label class="chat-search"><span aria-hidden="true">⌕</span><input type="search" placeholder="Search people or messages" aria-label="Search conversations"></label><div class="chat-contacts"></div></aside><section class="chat-conversation" aria-label="Selected conversation"><div class="chat-welcome"><span aria-hidden="true">◌</span><h3>Your conversations, together</h3><p>Choose a name to read your conversation or send a message.</p></div></section><p class="chat-status" role="status" aria-live="polite"></p>`;
    const list=host.querySelector('.chat-contacts'),pane=host.querySelector('.chat-conversation'),status=host.querySelector('.chat-status');
    const keyFor=r=>r.review_only?`review:${[r.sender_type+':'+(r.sender_id??'anonymous-'+r.id),r.recipient_type+':'+r.recipient_id].sort().join('|')}`:`${r.peer_type}:${r.peer_id??('anonymous-'+r.id)}`;
    function build() {
      threads=new Map();
      contacts.forEach(c=>threads.set(`${c.type}:${c.id}`,{...c,key:`${c.type}:${c.id}`,messages:[],unread:0}));
      [...rows].sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))||a.id-b.id).forEach(r=>{
        const key=keyFor(r);let t=threads.get(key);
        if(!t){t={key,type:r.peer_type,id:r.peer_id,name:r.peer_name||'Arounus contact',image:r.peer_image_url,messages:[],unread:0,review:r.review_only};threads.set(key,t)}
        t.messages.push(r);t.unread+=r.unread?1:0;t.latest=r;
        if(r.peer_image_url)t.image=r.peer_image_url;
      });
      drawList();
    }
    function drawList() {
      const all=[...threads.values()].sort((a,b)=>String(b.latest?.created_at||'').localeCompare(String(a.latest?.created_at||''))||a.name.localeCompare(b.name));
      const matches=all.filter(t=>(t.name+' '+t.messages.map(m=>m.content).join(' ')).toLocaleLowerCase().includes(filter));
      host.querySelector('[data-chat-count]').textContent=all.length||'';
      list.innerHTML=matches.map(t=>`<button type="button" class="chat-contact ${t.key===selected?'is-selected':''}" data-chat-key="${esc(t.key)}" aria-pressed="${t.key===selected}">${avatar(t.name,t.image)}<span class="chat-contact-copy"><span class="chat-contact-top"><strong>${esc(t.name)}</strong><time>${esc(date(t.latest?.created_at,true))}</time></span><span class="chat-contact-bottom"><span>${esc(t.latest?(t.latest.is_outgoing?'You: ':'')+t.latest.content:'Start a conversation')}</span>${t.unread?`<span class="chat-unread" aria-label="${t.unread} unread messages">${t.unread}</span>`:''}</span></span></button>`).join('')||`<div class="chat-empty"><strong>${filter?'No matching chats':'No conversations yet'}</strong><p>${filter?'Try another name or word.':'Messages will appear here when someone gets in touch.'}</p></div>`;
      list.querySelectorAll('[data-chat-key]').forEach(b=>b.addEventListener('click',()=>open(b.dataset.chatKey,true)));
    }
    function remember() { const text=pane.querySelector('textarea'); if(text&&selected)drafts.set(selected,{text:text.value,anonymous:!!pane.querySelector('[name=anonymous]')?.checked}); }
    function canReply(t) { return !t.review && (t.id!=null || t.type==='admin') && (!config.canReply || config.canReply(t)); }
    async function markRead(t) {
      if(!t.unread||!config.read||readPending.has(t.key))return;
      readPending.add(t.key);
      const unread=t.messages.filter(m=>m.unread);
      try { await config.read(t,unread); const ids=new Set(unread.map(m=>m.id));rows.forEach(m=>{if(ids.has(m.id))m.unread=false}); const current=threads.get(t.key);if(current)current.unread=current.messages.filter(m=>m.unread).length;drawList();Promise.resolve(config.onRead?.()).catch(()=>{}); }
      catch (_) { status.textContent='Read status could not update. It will retry when this chat opens again.'; }
      finally {readPending.delete(t.key)}
    }
    function open(key, focus=false) {
      remember(); const t=threads.get(key);if(!t)return;selected=key;host.classList.add('chat-is-open');drawList();
      const draft=drafts.get(key)||{};
      let previousDay='';
      pane.innerHTML=`<header class="chat-header"><button class="chat-back" type="button" aria-label="Back to conversations">←</button>${avatar(t.name,t.image)}<div><h3 tabindex="-1">${esc(t.name)}</h3><p>${esc(t.review?'Conversation review':roleName(t.type))}</p></div><span class="chat-private">Private</span></header><div class="chat-log" role="log" aria-label="Conversation with ${esc(t.name)}" tabindex="0">${t.messages.map(m=>{const day=new Date(m.created_at).toLocaleDateString('en-ZA',{day:'numeric',month:'long',year:'numeric'});const divider=day!==previousDay?`<div class="chat-day">${esc(day)}</div>`:'';previousDay=day;return `${divider}<article class="chat-bubble ${m.is_outgoing?'chat-sent':'chat-received'}">${t.review?`<strong>${esc(m.sender_name)}</strong>`:''}<p>${esc(m.content)}</p><footer>${m.is_anonymous?'<span>Anonymous · </span>':''}<time datetime="${esc(m.created_at)}">${esc(date(m.created_at))}</time>${m.is_outgoing?`<span aria-label="${m.read_at?'Read':'Sent'}"> · ${m.read_at?'Read':'Sent'}</span>`:''}</footer></article>`}).join('')||'<div class="chat-empty"><p>This is the beginning of your conversation.</p></div>'}</div>${canReply(t)?`<form class="chat-composer"><label class="chat-input-label"><span class="chat-sr-only">Message ${esc(t.name)}</span><textarea name="message" rows="1" maxlength="2000" placeholder="Write a message…" required>${esc(draft.text||'')}</textarea></label><button type="submit" class="chat-send" aria-label="Send message">Send <span aria-hidden="true">↗</span></button>${config.anonymous?`<label class="chat-anonymous"><input name="anonymous" type="checkbox" ${draft.anonymous?'checked':''}> Send anonymously <small>Your name and photo will be hidden; personal replies are unavailable.</small></label>`:''}</form>`:`<p class="chat-read-only">${t.review?'This conversation is available for review.':(t.id==null?'This sender’s identity is private. Personal replies are unavailable.':'Replies are unavailable for this contact.')}</p>`}`;
      pane.querySelector('.chat-back').addEventListener('click',()=>{remember();host.classList.remove('chat-is-open');list.querySelector('[aria-pressed=true]')?.focus()});
      pane.querySelector('form')?.addEventListener('submit',send);
      pane.querySelector('textarea')?.addEventListener('input',remember);
      pane.querySelector('img')?.addEventListener('error',e=>e.target.remove(),{once:true});
      const log=pane.querySelector('.chat-log');log.scrollTop=log.scrollHeight;
      if(focus)pane.querySelector('h3').focus();
      markRead(t);
    }
    async function send(event) {
      event.preventDefault();if(busy)return;
      const t=threads.get(selected),form=event.currentTarget,text=form.elements.message.value.trim();if(!text)return;
      const key=selected;remember();busy=true;form.querySelector('button').disabled=true;form.querySelector('button').textContent='Sending…';status.textContent='';
      try { await config.send(t,text,!!form.elements.anonymous?.checked);drafts.delete(key);if(selected===key)form.elements.message.value='';await refresh();if(selected===key)open(key);status.textContent='Message sent.'; }
      catch(error){status.textContent=error.message||'Message could not send. Your draft is saved.'}
      finally{busy=false;if(form.isConnected){form.querySelector('button').disabled=false;form.querySelector('button').textContent='Send ↗'}}
    }
    async function refresh() {
      if(loading||dead)return;loading=true;const button=host.querySelector('.chat-refresh');button.disabled=true;
      try {const result=await config.load();if(dead)return;remember();rows=result.rows||[];contacts=result.contacts||[];const next=JSON.stringify(result);const changed=signature!==next;signature=next;build();if(selected&&changed&&!busy&&host.classList.contains('chat-is-open')){const log=pane.querySelector('.chat-log'),scroll=log?.scrollTop||0,nearEnd=!log||log.scrollHeight-log.scrollTop-log.clientHeight<60;const text=pane.querySelector('textarea'),active=document.activeElement===text,start=text?.selectionStart,end=text?.selectionEnd;open(selected);if(!nearEnd)pane.querySelector('.chat-log').scrollTop=scroll;if(active){const nextText=pane.querySelector('textarea');nextText?.focus();nextText?.setSelectionRange(start,end)}}status.textContent='';}
      catch(error){status.textContent=error.message||'Chats could not load. Try refreshing.'}
      finally{loading=false;if(!dead)button.disabled=false}
    }
    host.addEventListener('error',event=>{if(event.target.matches?.('.chat-avatar img'))event.target.remove()},true);
    host.querySelector('input[type=search]').addEventListener('input',event=>{filter=event.target.value.toLocaleLowerCase();drawList()});
    host.querySelector('.chat-refresh').addEventListener('click',refresh);
    timer=setInterval(()=>{if(!host.isConnected){api.destroy();return}if(!document.hidden&&!host.closest('[hidden],.hidden')&&(!host.closest('dialog')||host.closest('dialog').open)&&host.getClientRects().length)refresh()},20000);
    const api={refresh,open:(type,id,name,image)=>{const key=`${type}:${id}`;if(!threads.has(key)){contacts.push({type,id,name,image});build()}open(key,true)},destroy:()=>{dead=true;clearInterval(timer);drafts.clear()},get count(){return rows.length}};
    host._arounusChat=api;api.ready=refresh();return api;
  }
  window.ArounusChat={mount,avatar};
})();

window.ArounusChat.installWorkspace = role => {
  const token=sessionStorage.getItem(role+'Token');
  const request=async(path,options={})=>{
    if(role==='admin')return api(path,options);
    const response=await fetch(path,{...options,cache:'no-store',headers:{...options.headers,[role==='student'?'X-Student-Token':'X-Lecturer-Token']:token}});
    const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.detail||'Could not load messages');return data;
  };
  const post=(path,payload)=>request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function install(){
    let card=document.getElementById(role==='student'?'studentBottomMessages':role==='lecturer'?'lecturerMessagesCard':'adminMessagingCenter');
    if(role!=='admin'&&(!token||!card))return;
    if(role==='admin'&&!card){const wrap=document.getElementById('appWrap');if(!wrap||wrap.classList.contains('hidden'))return;card=document.createElement('section');card.id='adminMessagingCenter';card.className='card admin-panel';card.dataset.adminArea='people';card.hidden=location.hash!=='#people';wrap.appendChild(card)}
    if(card.dataset.chatInstalled)return;card.dataset.chatInstalled='true';
    card.innerHTML='<div class="chat-workspace-heading"><div><span class="kicker">Private messages</span><h2>Conversations</h2></div></div><div id="'+(role==='student'?'studentMessagesList':'workspaceChats')+'"></div>';
    let people=[];
    const chat=ArounusChat.mount(card.querySelector(role==='student'?'#studentMessagesList':'#workspaceChats'),{
      anonymous:role==='student',
      load:async()=>{
        const rows=await request('/'+role+'/messages');
        if(role!=='admin')people=await request(role==='student'?'/student/message-lecturers':'/lecturer/message-students').catch(()=>[]);
        const contacts=people.map(p=>({type:role==='student'?'lecturer':'student',id:p.id,name:p.full_name,image:p.profile_image_url}));
        if(role==='student')contacts.unshift({type:'admin',id:0,name:'Arounus Admin'});
        if(role==='lecturer')fillModules();
        return {rows,contacts};
      },
      canReply:t=>role==='admin'||role==='student'&&['lecturer','landlord','admin'].includes(t.type)||role==='lecturer'&&['student','landlord','admin'].includes(t.type),
      send:(t,content,is_anonymous)=>post('/'+role+'/messages',{recipient_type:t.type,recipient_id:t.id||0,content,is_anonymous}),
      read:(t,rows)=>post('/'+role+'/messages/read',{message_ids:rows.map(m=>m.id)}),
      onRead:()=>{document.dispatchEvent(new Event('arounus-messages-read'))}
    });
    if(role==='admin')window.openAdminChat=async(type,id,name)=>{window.showAdminArea?.('people',false);card.hidden=false;await chat.refresh();chat.open(type,id,name);card.scrollIntoView({behavior:'smooth',block:'start'})};
    function fillModules(){const select=card.querySelector('[name=module_code]');if(!select)return;const old=select.value;select.innerHTML=[...new Set(people.flatMap(p=>p.module_codes||[]))].sort().map(c=>'<option value="'+esc(c)+'">'+esc(window.moduleLabel?.(c)||c)+'</option>').join('');if([...select.options].some(o=>o.value===old))select.value=old}
    if(role!=='student'){
      const panel=document.createElement('details');panel.className='chat-broadcast';panel.innerHTML='<summary>'+ (role==='admin'?'Send an announcement to all learners':'Send a module announcement')+'</summary><p class="muted">Each learner receives a private copy.</p><form>'+(role==='lecturer'?'<label>Module<select name="module_code" required></select></label>':'')+'<label>Announcement<textarea name="content" maxlength="2000" required></textarea></label><button class="btn" type="submit">Send announcement</button><p role="status"></p></form>';card.appendChild(panel);
      panel.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('button'),status=form.querySelector('[role=status]'),content=form.elements.content.value.trim();if(!content||button.disabled)return;if(role==='admin'&&!confirm('Send this announcement to every active learner?'))return;button.disabled=true;status.textContent='Sending…';try{const result=await post('/'+role+'/messages/broadcast',{content,...(role==='admin'?{module_codes:[]}:{module_code:form.elements.module_code.value})});form.elements.content.value='';status.textContent='Sent to '+result.recipient_count+' learners.';await chat.refresh()}catch(error){status.textContent=error.message}finally{button.disabled=false}});
    }
  }
  if(role==='admin'){const wrap=document.getElementById('appWrap');if(wrap)new MutationObserver(install).observe(wrap,{attributes:true,attributeFilter:['class']});}
  install();
};
