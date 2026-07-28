(() => {
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const token = sessionStorage.getItem('studentToken');
  if (!token) return;
  const request = async (path, options = {}) => {
    options.headers = Object.assign({}, options.headers, {'X-Student-Token': token});
    const response = await fetch(path, options); const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || 'Could not complete that request'); return data;
  };
  const formatTime = value => { try { return new Intl.DateTimeFormat('en-ZA',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Johannesburg'}).format(new Date(value)); } catch (_) { return value; } };
  const card = document.getElementById('studentBottomMessages');
  if (!card) return;
  card.innerHTML = `<div class="admin-editor-heading"><div><span class="kicker">Private support</span><h2>Messages</h2></div><button class="btn secondary" id="refreshStudentSupport" type="button">Refresh</button></div>
    <div class="message-compose-grid"><div><label for="studentMessageRecipient">Send to</label><select id="studentMessageRecipient"><option value="admin:0">NucleoCampus administrator</option></select></div>
    <div class="anonymous-choice"><label><input id="studentMessageAnonymous" type="checkbox"> Send anonymously</label><small>Your name is hidden from the recipient. Use direct messaging when you want a personal reply.</small></div></div>
    <label for="studentMessageText">Message</label><textarea id="studentMessageText" maxlength="2000" placeholder="How can we help?"></textarea>
    <div class="message-compose-actions"><button class="btn" id="sendStudentSupport" type="button">Send message</button><span id="studentSupportMsg" aria-live="polite"></span></div>
    <details class="message-history" open><summary>Conversation history</summary><div id="studentMessagesList" class="message-timeline"></div></details>`;
  const list = document.getElementById('studentMessagesList');
  async function load() {
    try {
      const [lecturers, messages] = await Promise.all([request('/student/message-lecturers'), request('/student/messages')]);
      const select = document.getElementById('studentMessageRecipient'); const selected = select.value;
      select.innerHTML = '<option value="admin:0">NucleoCampus administrator</option>' + lecturers.map(item => `<option value="lecturer:${item.id}">${esc(item.full_name)} · ${esc((item.module_codes || []).join(', '))}</option>`).join('');
      if ([...select.options].some(option => option.value === selected)) select.value = selected;
      list.innerHTML = messages.length ? messages.map(message => {
        const sent = message.sender_type === 'student';
        const label = sent ? `To ${message.recipient_name}` : `From ${message.sender_name}`;
        return `<article class="message-bubble ${sent ? 'sent' : 'received'}"><header><strong>${esc(label)}</strong>${message.is_anonymous ? '<span class="privacy-pill">Anonymous</span>' : ''}<time>${esc(formatTime(message.created_at))}</time></header><p>${esc(message.content)}</p></article>`;
      }).join('') : '<p class="muted">No messages yet.</p>';
    } catch (error) { list.innerHTML = `<div class="msg error">${esc(error.message)}</div>`; }
  }
  document.getElementById('sendStudentSupport').addEventListener('click', async () => {
    const [recipient_type, id] = document.getElementById('studentMessageRecipient').value.split(':');
    const content = document.getElementById('studentMessageText').value.trim(); const status = document.getElementById('studentSupportMsg');
    if (!content) { status.textContent = 'Write a message first.'; return; }
    try {
      await request('/student/messages', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({recipient_type,recipient_id:Number(id),content,is_anonymous:document.getElementById('studentMessageAnonymous').checked})});
      document.getElementById('studentMessageText').value = ''; status.textContent = 'Message sent.'; await load();
    } catch (error) { status.textContent = error.message; }
  });
  document.getElementById('refreshStudentSupport').addEventListener('click', load); load();
})();
