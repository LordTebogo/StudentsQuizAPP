(() => {
  const role=sessionStorage.getItem('studentToken')?'student':'lecturer',token=sessionStorage.getItem(role+'Token');
  let chat;
  const request=async(path,options={})=>{const response=await fetch(path,{...options,cache:'no-store',headers:{...options.headers,[role==='student'?'X-Student-Token':'X-Lecturer-Token']:token}});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.detail||'Could not load conversations');return data};
  window.openHomeChats=()=>{
    if(!token)return;
    if(chat){chat.refresh();return}
    chat=ArounusChat.mount(document.getElementById('homeInboxList'),{
      load:async showPreview=>{if(showPreview.initial)showPreview({rows:await request('/'+role+'/messages?summary=true')});return {rows:await request('/'+role+'/messages')};},
      anonymous:role==='student',
      canReply:t=>role==='student'?['admin','lecturer','landlord'].includes(t.type):[ 'student','landlord','admin'].includes(t.type),
      send:(t,content,is_anonymous)=>request('/'+role+'/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipient_type:t.type,recipient_id:t.id||0,content,is_anonymous})}),
      read:(t,rows)=>request('/'+role+'/messages/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message_ids:rows.map(m=>m.id)})}),
      onRead:()=>request('/'+role+'/messages/unread').then(result=>{const badge=document.getElementById('homeMessageCount');badge.textContent=result.count;badge.classList.toggle('hidden',!result.count)})
    });
  };
})();
