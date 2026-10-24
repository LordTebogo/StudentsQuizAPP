(() => {
  const dialog = document.getElementById('contactDialog');
  const content = document.getElementById('contactContent');
  const status = document.getElementById('contactStatus');
  let providerId = null;
  document.getElementById('closeContact').addEventListener('click', () => dialog.close());
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-contact-provider]');
    if (!button) return;
    providerId = Number(button.dataset.contactProvider);
    if (!providerId) return;
    document.getElementById('contactTitle').textContent = `Message ${button.dataset.providerName || 'provider'}`;
    status.textContent = '';
    if (!sessionStorage.getItem('studentToken')) {
      content.innerHTML = '<p>Sign in as a learner to send a private message.</p><a href="/static/academics.html?role=learner">Sign in to message</a>';
    } else {
      content.innerHTML = '<form id="contactForm"><label for="contactText">Your message</label><textarea id="contactText" maxlength="2000" required></textarea><button type="submit">Send message</button></form>';
    }
    dialog.showModal();
  });
  dialog.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    status.textContent = 'Sending…';
    try {
      const response = await fetch('/student/messages', {method:'POST',headers:{'Content-Type':'application/json','X-Student-Token':sessionStorage.getItem('studentToken') || ''},body:JSON.stringify({recipient_type:'landlord',recipient_id:providerId,content:form.querySelector('textarea').value.trim(),is_anonymous:false})});
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Message could not be sent.');
      form.reset();
      status.textContent = 'Message sent.';
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
})();
