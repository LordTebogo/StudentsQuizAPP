(() => {
  const dialog = document.getElementById('sellDialog');
  const content = document.getElementById('sellContent');
  const message = document.getElementById('sellMessage');
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let token = sessionStorage.getItem('landlordToken') || '';
  let profile = null;
  let mode = 'register';
  let kind = '';

  async function request(path, options = {}) {
    const headers = {...(options.headers || {})};
    if (token) headers['X-Landlord-Token'] = token;
    const response = await fetch(path, {...options, headers});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || 'The request could not be completed.');
    return data;
  }
  function status(text, error = false) {
    message.textContent = text;
    message.classList.toggle('error', error);
  }
  function renderAuth() {
    profile = null;
    kind = '';
    document.getElementById('sellTitle').textContent = 'Advertiser account';
    document.getElementById('sellIntro').textContent = 'Use one email and password for every type of listing.';
    content.innerHTML = `<div class="sell-tabs"><button type="button" data-auth-mode="register" aria-pressed="${mode === 'register'}">Create account</button><button type="button" data-auth-mode="login" aria-pressed="${mode === 'login'}">Sign in</button></div>
      <form id="sellAuthForm" class="sell-form">${mode === 'register' ? `
        <label>Full name<input name="full_name" autocomplete="name" required></label>
        <label>Business or service name <span>(optional)</span><input name="business_name" autocomplete="organization"></label>
        <label>Contact number<input name="phone" type="tel" autocomplete="tel" required></label>` : ''}
        <label>Email<input name="email" type="email" autocomplete="email" required></label>
        <label>Password<input name="password" type="password" autocomplete="${mode === 'register' ? 'new-password' : 'current-password'}" minlength="8" required></label>
        ${mode === 'register' ? '<label>Confirm password<input name="confirm_password" type="password" autocomplete="new-password" minlength="8" required></label>' : ''}
        <button type="submit">${mode === 'register' ? 'Create advertiser account' : 'Sign in'}</button>
      </form>`;
  }
  function renderChoice() {
    kind = '';
    document.getElementById('sellTitle').textContent = 'Sell or list';
    document.getElementById('sellIntro').textContent = `Signed in as ${profile.full_name}. Choose what you want to offer.`;
    content.innerHTML = `<div class="sell-choice"><button type="button" data-sell-kind="room"><strong>A room or accommodation</strong><span>Monthly rent, location, and room details</span></button><button type="button" data-sell-kind="advert"><strong>An item, ride, or service</strong><span>Price, description, and how buyers can reach you</span></button></div><div class="sell-account-actions"><button type="button" data-my-listings>Manage my listings</button><button type="button" data-sell-messages>Messages</button><button type="button" data-sell-signout>Sign out</button></div>`;
  }
  function renderForm(selected) {
    kind = selected;
    const room = selected === 'room';
    document.getElementById('sellTitle').textContent = room ? 'List accommodation' : 'List an item, ride, or service';
    document.getElementById('sellIntro').textContent = room ? 'Add the details students need to compare rooms.' : 'Your offer will appear after review.';
    content.innerHTML = `<button class="sell-back" type="button" data-sell-back>← Choose another listing type</button><form id="sellListingForm" class="sell-form" enctype="multipart/form-data">
      ${room ? `<label>Listing title<input name="title" maxlength="180" placeholder="For example, Bachelor room near campus" required></label>
        <label>University or college<input name="campus" maxlength="120" required></label>
        <label>Area or suburb<input name="area" maxlength="160" required></label>
        <label>Monthly rent (R)<input name="monthly_rent" type="number" min="0" inputmode="numeric" required></label>
        <label>Room type <span>(optional)</span><input name="bedrooms" maxlength="80" placeholder="Single, shared, bachelor…"></label>
        <label>Contact number <span>(optional)</span><input name="contact" type="tel"></label>
        <label>Description<textarea name="description" maxlength="2500" placeholder="Utilities, rules, availability, and what is included" required></textarea></label>
        <label>Photos <span>(up to 3, optional)</span><input name="images" type="file" accept="image/*" multiple data-max-files="3"></label>` : `
        <label>Business or seller name<input name="business_name" maxlength="160" value="${escapeHtml(profile.business_name || profile.full_name)}" required></label>
        <label>Listing title<input name="headline" maxlength="180" required></label>
        <label>Category<select name="category" required><option value="">Choose a category</option><option>Sales & retail</option><option>Technology</option><option>Ride & transport</option><option>Delivery & courier</option><option>Campus shuttle</option><option>Student service</option><option>Food & delivery</option><option>Tutoring</option><option>Event</option><option>Beauty & lifestyle</option><option>Other</option></select></label>
        <label>Price (R) <span>(optional for services)</span><input name="price" type="number" min="0" max="100000000" inputmode="numeric"></label>
        <label>University or college<input name="campus" maxlength="120"></label>
        <label>Description<textarea name="description" maxlength="1200" required></textarea></label>
        <label>WhatsApp or contact number<input name="contact" type="tel"></label>
        <label>Website or social link <span>(optional if a contact number is provided)</span><input name="website_url" type="url" placeholder="https://…"></label>
        <label>Photo <span>(optional)</span><input name="images" type="file" accept="image/*"></label>
        <input type="hidden" name="placement" value="feed">`}
      <button type="submit">${room ? 'Publish room' : 'Submit listing for review'}</button>
    </form>`;
  }
  async function renderMyListings() {
    document.getElementById('sellTitle').textContent = 'My listings';
    document.getElementById('sellIntro').textContent = 'Manage all your offers with the same advertiser account.';
    content.innerHTML = '<button class="sell-back" type="button" data-sell-back>← Add another listing</button><p>Loading your listings…</p>';
    try {
      const [rooms, adverts] = await Promise.all([request('/marketing/landlord/listings'), request('/marketing/my-adverts')]);
      content.innerHTML = `<button class="sell-back" type="button" data-sell-back>← Add another listing</button><div class="sell-manage">${rooms.map(item => `<article><strong>${escapeHtml(item.title)}</strong><span>Room · ${item.is_available ? 'Available' : 'Filled'}</span><button type="button" data-toggle-room="${item.id}">${item.is_available ? 'Mark filled' : 'Mark available'}</button></article>`).join('')}${adverts.map(item => `<article><strong>${escapeHtml(item.headline)}</strong><span>${escapeHtml(item.category)} · ${escapeHtml(item.status)}</span>${item.status === 'approved' ? `<button type="button" data-pause-ad="${item.id}">Pause listing</button>` : ''}</article>`).join('') || (!rooms.length ? '<p>You have no listings yet.</p>' : '')}</div>`;
      content.dataset.rooms = JSON.stringify(rooms);
    } catch (error) { status(error.message, true); renderChoice(); }
  }
  async function renderMessages() {
    document.getElementById('sellTitle').textContent = 'Customer messages';
    document.getElementById('sellIntro').textContent = 'Reply to students who contacted your listings.';
    content.innerHTML = '<button class="sell-back" type="button" data-sell-back>← Back to listings</button><p>Loading messages…</p>';
    try {
      const rows = await request('/marketing/provider/messages');
      const threads = new Map();
      rows.forEach(row => {
        const studentId = row.sender_type === 'student' ? row.sender_id : row.recipient_type === 'student' ? row.recipient_id : null;
        if (!studentId) return;
        if (!threads.has(studentId)) threads.set(studentId, {name:row.sender_type === 'student' ? row.sender_name : row.recipient_name, messages:[]});
        threads.get(studentId).messages.push(row);
      });
      content.innerHTML = `<button class="sell-back" type="button" data-sell-back>← Back to listings</button><div class="sell-inbox">${[...threads].map(([id, thread]) => `<section><h3>${escapeHtml(thread.name)}</h3><div class="sell-thread">${thread.messages.reverse().map(row => `<p><strong>${escapeHtml(row.sender_type === 'landlord' ? 'You' : row.sender_name)}:</strong> ${escapeHtml(row.content)}</p>`).join('')}</div><form data-reply-to="${id}"><label>Reply<textarea name="content" maxlength="2000" required></textarea></label><button type="submit">Send reply</button></form></section>`).join('') || '<p>No messages yet.</p>'}</div>`;
      for (const [id] of threads) request(`/marketing/provider/messages/read/${id}`, {method:'POST'}).catch(() => {});
    } catch (error) { status(error.message, true); renderChoice(); }
  }
  async function open() {
    if (!dialog.open) dialog.showModal();
    status('');
    if (!token) { renderAuth(); return; }
    try {
      profile = await request('/marketing/landlords/me');
      renderChoice();
    } catch (_) {
      token = '';
      sessionStorage.removeItem('landlordToken');
      renderAuth();
    }
  }
  document.addEventListener('click', event => {
    if (!event.target.closest('[data-open-sell]')) return;
    event.preventDefault();
    open();
  });
  document.getElementById('closeSell').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', async event => {
    const modeButton = event.target.closest('[data-auth-mode]');
    if (modeButton) { mode = modeButton.dataset.authMode; status(''); renderAuth(); return; }
    const choice = event.target.closest('[data-sell-kind]');
    if (choice) { status(''); renderForm(choice.dataset.sellKind); return; }
    if (event.target.closest('[data-sell-back]')) { status(''); renderChoice(); return; }
    if (event.target.closest('[data-my-listings]')) { status(''); await renderMyListings(); return; }
    if (event.target.closest('[data-sell-messages]')) { status(''); await renderMessages(); return; }
    if (event.target.closest('[data-sell-signout]')) { token = ''; profile = null; sessionStorage.removeItem('landlordToken'); sessionStorage.removeItem('activeRole'); mode = 'login'; renderAuth(); return; }
    const toggle = event.target.closest('[data-toggle-room]');
    if (toggle) {
      const item = JSON.parse(content.dataset.rooms || '[]').find(row => String(row.id) === toggle.dataset.toggleRoom);
      if (!item) return;
      const form = new FormData();
      for (const field of ['title','campus','area','monthly_rent','bedrooms','description','contact']) form.append(field, item[field] ?? '');
      form.append('is_available', String(!item.is_available));
      try { await request(`/marketing/listings/${item.id}`, {method:'PUT', body:form}); await renderMyListings(); document.dispatchEvent(new Event('market-listing-changed')); }
      catch (error) { status(error.message, true); }
    }
    const pause = event.target.closest('[data-pause-ad]');
    if (pause) {
      try { await request(`/marketing/adverts/${pause.dataset.pauseAd}/pause`, {method:'PUT'}); await renderMyListings(); document.dispatchEvent(new Event('market-listing-changed')); }
      catch (error) { status(error.message, true); }
    }
  });
  dialog.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    status('Saving…');
    try {
      if (form.dataset.replyTo) {
        await request('/marketing/provider/messages', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({recipient_type:'student', recipient_id:Number(form.dataset.replyTo), content:form.elements.content.value, is_anonymous:false})});
        status('Message sent.');
        await renderMessages();
        return;
      }
      if (form.id === 'sellAuthForm') {
        let result;
        if (mode === 'register') {
          const data = new FormData(form);
          if (data.get('password') !== data.get('confirm_password')) throw new Error('Passwords do not match.');
          result = await request('/marketing/landlords/register', {method:'POST', body:data});
        } else {
          result = await request('/marketing/landlords/login', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:form.elements.email.value, password:form.elements.password.value})});
        }
        token = result.token;
        profile = result.profile;
        sessionStorage.setItem('landlordToken', token);
        sessionStorage.setItem('activeRole', 'advertiser');
        status('');
        renderChoice();
      } else if (form.id === 'sellListingForm') {
        const data = new FormData(form);
        const files = [...(form.elements.images?.files || [])];
        if (files.length > (kind === 'room' ? 3 : 1)) throw new Error(`Choose no more than ${kind === 'room' ? 3 : 1} photo${kind === 'room' ? 's' : ''}.`);
        if (kind === 'advert' && !String(data.get('contact') || '').trim() && !String(data.get('website_url') || '').trim()) throw new Error('Add a contact number or website.');
        await request(kind === 'room' ? '/marketing/listings' : '/marketing/adverts', {method:'POST', body:data});
        document.dispatchEvent(new Event('market-listing-changed'));
        renderChoice();
        status(kind === 'room' ? 'Your room is published.' : 'Your listing was submitted for review.');
      }
    } catch (error) { status(error.message, true); }
    finally { if (form.isConnected) submit.disabled = false; }
  });
  const params = new URLSearchParams(location.search);
  if (params.has('sell') || params.has('create') || params.get('role') === 'advertiser' || location.hash === '#sell') {
    if (params.get('mode') === 'login') mode = 'login';
    window.addEventListener('load', open, {once:true});
  }
})();
