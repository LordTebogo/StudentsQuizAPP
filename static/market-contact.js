(() => {
  const dialog=document.getElementById('contactDialog');
  const content=document.getElementById('contactContent');
  const status=document.getElementById('contactStatus');
  let providerId=null,opening=0;
  document.getElementById('closeContact').addEventListener('click',()=>dialog.close());
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-contact-provider]');
    if(!button)return;
    const id=Number(button.dataset.contactProvider);
    if(!id)return;
    const attempt=++opening;
    try {
      const session=await ArounusMarketAuth.ensureSignedIn();
      if(!session||attempt!==opening)return;
      providerId=id;
      document.getElementById('contactTitle').textContent=`Message ${button.dataset.providerName||'provider'}`;
      status.textContent='';
      content.innerHTML='<form id="contactForm"><label for="contactText">Your message</label><textarea id="contactText" maxlength="2000" required></textarea><button type="submit">Send message</button></form><button class="sell-back" type="button" data-market-messages>View my messages</button>';
      if(!dialog.open)dialog.showModal();
      document.getElementById('contactText').focus();
    } catch(error) {
      status.textContent=error.message;content.textContent='';
      if(!dialog.open)dialog.showModal();
    }
  });
  dialog.addEventListener('submit',async event=>{
    if(event.target.id!=='contactForm')return;
    event.preventDefault();
    const form=event.target,button=form.querySelector('[type=submit]');
    button.disabled=true;status.textContent='Sending…';
    try {
      const result=await ArounusMarketAuth.request('/marketing/provider/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipient_type:'landlord',recipient_id:providerId,content:form.querySelector('textarea').value.trim(),is_anonymous:false})});
      if(!result){status.textContent='Sign in to send your message.';return;}
      form.reset();status.textContent='Message sent.';
    } catch(error){status.textContent=error.message;}
    finally{button.disabled=false;}
  });
})();
