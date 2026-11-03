(() => {
  const dialog=document.getElementById('contactDialog');
  const status=document.getElementById('contactStatus');
  document.getElementById('closeContact').addEventListener('click',()=>dialog.close());
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-contact-provider]');
    if(!button)return;
    const id=Number(button.dataset.contactProvider);if(!id)return;
    try {
      await window.openMarketConversation(id,button.dataset.providerName,button.dataset.providerImage);
    } catch(error) {
      status.textContent=error.message;
      document.getElementById('contactContent').textContent='Your conversation could not open. Please try again.';
      if(!dialog.open)dialog.showModal();
    }
  });
})();
