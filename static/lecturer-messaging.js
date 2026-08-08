(() => {
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const token = sessionStorage.getItem('lecturerToken'); const card = document.getElementById('lecturerMessagesCard');
  if (!token || !card) return;
  const request = async (path, options = {}) => {
    options.headers = Object.assign({}, options.headers, {'X-Lecturer-Token':token});
    const response = await fetch(path, options); const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || 'Could not complete that request'); return data;
  };
  const time = value => { try { return new Intl.DateTimeFormat('en-ZA',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Johannesburg'}).format(new Date(value)); } catch (_) { return value; } };
  card.innerHTML = `<div class="admin-editor-heading"><div><span class="kicker">Learner support</span><h2>Messages</h2></div><button class="btn secondary" id="refreshLecturerSupport" type="button">Refresh</button></div>
    <div class="message-mode" role="tablist"><button class="active" type="button" data-message-mode="individual">Individual</button><button type="button" data-message-mode="module">Module group</button></div>
    <div id="individualMessagePane"><label for="lecturerSupportStudent">Learner</label><select id="lecturerSupportStudent"></select></div>
    <div id="moduleMessagePane" class="hidden"><label for="lecturerSupportModule">Assigned module</label><select id="lecturerSupportModule"></select><p class="muted">Every active student enrolled in this module will receive a private copy.</p></div>
    <label for="lecturerSupportText">Message</label><textarea id="lecturerSupportText" maxlength="2000" placeholder="Write a clear message"></textarea>
    <div class="message-compose-actions"><button class="btn" id="sendLecturerSupport" type="button">Send message</button><span id="lecturerSupportMsg" aria-live="polite"></span></div>
    <details class="message-history" open><summary>Message history</summary><div id="lecturerSupportHistory" class="message-timeline"></div></details>`;
  let mode = 'individual'; let students = [];
  async function load() {
    const history = document.getElementById('lecturerSupportHistory');
    try {
      const [studentRows, messages] = await Promise.all([request('/lecturer/message-students'),request('/lecturer/messages')]); students = studentRows;
      document.getElementById('lecturerSupportStudent').innerHTML = students.map(student => `<option value="${student.id}">${esc(student.full_name)} · ${esc(student.student_number)} · ${esc((student.module_codes||[]).join(', '))}</option>`).join('') || '<option value="">No students in your modules</option>';
      const modules = [...new Set(students.flatMap(student => student.module_codes || []))].sort();
      document.getElementById('lecturerSupportModule').innerHTML = modules.map(code => `<option value="${esc(code)}">${esc(code)} · ${students.filter(student => (student.module_codes||[]).includes(code)).length} students</option>`).join('') || '<option value="">No assigned modules with students</option>';
      history.innerHTML = messages.length ? messages.map(message => { const sent=message.sender_type==='lecturer'; return `<article class="message-bubble ${sent?'sent':'received'}"><header><strong>${esc(sent ? `To ${message.recipient_name}` : `From ${message.sender_name}`)}</strong>${message.is_anonymous?'<span class="privacy-pill">Anonymous</span>':''}<time>${esc(time(message.created_at))}</time></header><p>${esc(message.content)}</p></article>`; }).join('') : '<p class="muted">No messages yet.</p>';
    } catch (error) { history.innerHTML = `<div class="msg error">${esc(error.message)}</div>`; }
  }
  card.querySelectorAll('[data-message-mode]').forEach(button => button.addEventListener('click', () => { mode=button.dataset.messageMode; card.querySelectorAll('[data-message-mode]').forEach(item=>item.classList.toggle('active',item===button)); document.getElementById('individualMessagePane').classList.toggle('hidden',mode!=='individual'); document.getElementById('moduleMessagePane').classList.toggle('hidden',mode!=='module'); }));
  document.getElementById('sendLecturerSupport').addEventListener('click', async () => {
    const content=document.getElementById('lecturerSupportText').value.trim(), status=document.getElementById('lecturerSupportMsg'); if(!content){status.textContent='Write a message first.';return;}
    try {
      if(mode==='individual'){const id=Number(document.getElementById('lecturerSupportStudent').value);if(!id)throw new Error('Choose a student.');await request('/lecturer/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipient_type:'student',recipient_id:id,content})});status.textContent='Message sent.';}
      else {const module_code=document.getElementById('lecturerSupportModule').value;if(!module_code)throw new Error('Choose a module.');const result=await request('/lecturer/messages/broadcast',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({module_code,content})});status.textContent=`Sent to ${result.recipient_count} ${module_code} student${result.recipient_count===1?'':'s'}.`;}
      document.getElementById('lecturerSupportText').value=''; await load();
    } catch(error){status.textContent=error.message;}
  });
  document.getElementById('refreshLecturerSupport').addEventListener('click',load); load();
})();
