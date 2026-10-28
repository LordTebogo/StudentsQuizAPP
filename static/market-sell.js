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
    document.getElementById('sellIntro').textContent = room ? 'Add the details students need to compare rooms. An admin will approve this room before it appears.' : 'Your listing will appear as soon as you publish it.';
    content.innerHTML = `<button class="sell-back" type="button" data-sell-back>← Choose another listing type</button><form id="sellListingForm" class="sell-form" enctype="multipart/form-data">
      ${room ? `<label>Listing title<input name="title" maxlength="180" placeholder="For example, Bachelor room near campus" required></label>
        <label>Nearest University/college or company<input name="campus" maxlength="120" required></label>
        <label>Area or suburb<input name="area" maxlength="160" required></label>
        <div class="sell-location"><label>Latitude <span>(optional)</span><input name="latitude" type="number" step="any" min="-90" max="90"></label><label>Longitude <span>(optional)</span><input name="longitude" type="number" step="any" min="-180" max="180"></label><button type="button" data-use-location>Use my current location</button><small class="sell-location-status" role="status" aria-live="polite" hidden></small></div>
        <label>Monthly rent (R)<input name="monthly_rent" type="number" min="0" inputmode="numeric" required></label>
        <label>Room type <span>(optional)</span><input name="bedrooms" maxlength="80" placeholder="Single, shared, bachelor…"></label>
        <label>Contact number for this listing<input name="contact" type="tel" autocomplete="tel" required></label>
        <label>Description<textarea name="description" maxlength="2500" placeholder="Utilities, rules, availability, and what is included" required></textarea></label>
        <label>Photos <span>(up to 3, optional)</span><input name="images" type="file" accept="image/*" multiple data-max-files="3"></label>` : `
        <label>Business or seller name<input name="business_name" maxlength="160" value="${escapeHtml(profile.business_name || profile.full_name)}" required></label>
        <label>Listing title<input name="headline" maxlength="180" required></label>
        <label>Category<select name="category" required><option value="">Choose a category</option><option>Sales & retail</option><option>Technology</option><option>Ride & transport</option><option>Delivery & courier</option><option>Campus shuttle</option><option>Student service</option><option>Food & delivery</option><option>Tutoring</option><option>Event</option><option>Beauty & lifestyle</option><option>Churches</option><option>Other</option></select></label>
        <label id="otherServiceField" hidden>Actual activity or service<input name="service_detail" maxlength="160" disabled></label>
        <label>Price (R) <span>(optional for services)</span><input name="price" type="number" min="0" max="100000000" inputmode="numeric"></label>
        <label>Stock quantity <span>(optional for products)</span><input name="stock_quantity" type="number" min="0" max="1000000" inputmode="numeric"></label>
        <label>Nearest University/college or company<input name="campus" maxlength="120"></label>
        <label id="churchLocationField" hidden>Church location or area<input name="area" maxlength="160" disabled></label>
        <div class="sell-location" id="churchCoordinatesField" hidden><label>Latitude <span>(optional)</span><input name="latitude" type="number" step="any" min="-90" max="90" disabled></label><label>Longitude <span>(optional)</span><input name="longitude" type="number" step="any" min="-180" max="180" disabled></label><button type="button" data-use-location>Use my current location</button><small class="sell-location-status" role="status" aria-live="polite" hidden></small></div>
        <label>Description<textarea name="description" maxlength="1200" required></textarea></label>
        <label>Contact number for this listing<input name="contact" type="tel" autocomplete="tel" required></label>
        <label>Website or social link <span>(optional)</span><input name="website_url" type="url" placeholder="https://…"></label>
        <label>Photos <span>(up to 3, optional)</span><input name="images" type="file" accept="image/*" multiple data-max-files="3"></label>
        <input type="hidden" name="placement" value="feed">`}
      <button type="submit">${room ? 'Submit room for approval' : 'Publish listing'}</button>
    </form>`;
  }
  const isService = item => !/transport|ride|shuttle|courier|delivery|sales|retail|technology|second.?hand|textbook/i.test(item.category);
  const listingPhotos = item => (item.image_urls || (item.image_url ? [item.image_url] : []));
  function renderEditListing(type, item) {
    const room = type === 'room', availability = item.service_availability || {};
    const value = name => escapeHtml(item[name] ?? '');
    const photos = listingPhotos(item);
    document.getElementById('sellTitle').textContent = `Edit ${room ? 'room' : 'listing'}`;
    document.getElementById('sellIntro').textContent = 'Update the details customers see. Save when finished.';
    content.innerHTML = `<button class="sell-back" type="button" data-my-listings>← My listings</button><form id="editListingForm" class="sell-form" data-type="${type}" data-id="${item.id}" enctype="multipart/form-data">
      ${room ? `<label>Listing title<input name="title" maxlength="180" value="${value('title')}" required></label><label>Nearest university, college or company<input name="campus" maxlength="120" value="${value('campus')}" required></label><label>Area or suburb<input name="area" maxlength="160" value="${value('area')}" required></label><label>Monthly rent (R)<input name="monthly_rent" type="number" min="0" value="${value('monthly_rent')}"></label><label>Room type<input name="bedrooms" maxlength="80" value="${value('bedrooms')}"></label>` : `<label>Business or seller name<input name="business_name" maxlength="160" value="${value('business_name')}" required></label><label>Listing title<input name="headline" maxlength="180" value="${value('headline')}" required></label><label>Category<select name="category" required>${['Sales & retail','Technology','Ride & transport','Delivery & courier','Campus shuttle','Student service','Food & delivery','Tutoring','Event','Beauty & lifestyle','Churches','Other'].map(category => `<option ${item.category === category ? 'selected' : ''}>${category}</option>`).join('')}</select></label><label>Activity or service<input name="service_detail" maxlength="160" value="${value('service_detail')}"></label><label>Price (R)<input name="price" type="number" min="0" max="100000000" value="${value('price')}"></label><label>Stock quantity (optional, for products)<input name="stock_quantity" type="number" min="0" max="1000000" value="${value('stock_quantity')}"></label><label>Nearest university, college or company<input name="campus" maxlength="120" value="${value('campus')}"></label><label>Area or suburb<input name="area" maxlength="160" value="${value('area')}"></label>`}
      <label>Description<textarea name="description" maxlength="${room ? 2500 : 1200}" required>${value('description')}</textarea></label><label>Contact number<input name="contact" type="tel" value="${value('contact')}" required></label>${room ? `<label><input name="is_available" type="checkbox" ${item.is_available ? 'checked' : ''}> Available now</label><label>Fully booked until (optional)<input name="booked_until" type="date" value="${value('booked_until')}"></label>` : `<label>Website or social link<input name="website_url" type="url" value="${value('website_url')}"></label><label>Listing visibility<select name="status"><option value="approved" ${item.status === 'approved' ? 'selected' : ''}>Published</option><option value="paused" ${item.status === 'paused' ? 'selected' : ''}>Paused</option></select></label>`}
      <div class="sell-photo-editor"><strong>Photos (up to 3)</strong>${photos.map((url, index) => `<label><input type="checkbox" data-keep-photo="${index}" checked><img src="${escapeHtml(url)}" alt="Listing photo ${index + 1}"> Keep photo ${index + 1}</label>`).join('') || '<p>No photos yet.</p>'}</div><label>Add photos<input name="images" type="file" accept="image/*" multiple></label>
      ${!room && isService(item) ? `<fieldset class="sell-availability-fields"><legend>Service and consultation availability</legend><label>Opening hours and days<textarea name="opening_hours" maxlength="500">${escapeHtml(availability.opening_hours || '')}</textarea></label><label>Available dates (YYYY-MM-DD, comma separated)<textarea name="available_dates">${escapeHtml((availability.available_dates || []).join(', '))}</textarea></label><label>Available times (HH:MM, comma separated)<textarea name="available_times">${escapeHtml((availability.available_times || []).join(', '))}</textarea></label><label>Closed dates (YYYY-MM-DD, comma separated)<textarea name="closed_dates">${escapeHtml((availability.closed_dates || []).join(', '))}</textarea></label><label>Fully booked until<input name="booked_until" type="date" value="${escapeHtml(availability.booked_until || '')}"></label><label><input name="consultations" type="checkbox" ${availability.consultations ? 'checked' : ''}> Offer consultations</label><label>Consultation length (minutes)<input name="consultation_minutes" type="number" min="5" max="480" value="${escapeHtml(availability.consultation_minutes || '')}"></label><label>Consultation format<input name="consultation_mode" maxlength="80" value="${escapeHtml(availability.consultation_mode || '')}"></label></fieldset>` : ''}
      <button type="submit">Save changes</button></form><button class="sell-delete" type="button" data-delete-listing="${type}" data-listing-id="${item.id}">Delete listing</button>`;
    content.dataset.editPhotos = JSON.stringify(photos);
  }
  async function renderMyListings() {
    document.getElementById('sellTitle').textContent = 'My listings';
    document.getElementById('sellIntro').textContent = 'Manage all your offers with the same advertiser account.';
    content.innerHTML = '<button class="sell-back" type="button" data-sell-back>← Add another listing</button><p>Loading your listings…</p>';
    try {
      const [rooms, adverts] = await Promise.all([request('/marketing/landlord/listings'), request('/marketing/my-adverts')]);
      content.innerHTML = `<button class="sell-back" type="button" data-sell-back>← Add another listing</button><div class="sell-manage">${rooms.map(item => `<article><div><strong>${escapeHtml(item.title)}</strong><span>Room · ${item.is_approved ? (item.is_available ? 'Published' : item.booked_until ? `Fully booked until ${escapeHtml(item.booked_until)}` : 'Filled') : 'Awaiting approval'}</span></div><div class="sell-manage-actions"><button type="button" data-edit-room="${item.id}">Edit</button><button type="button" data-toggle-room="${item.id}">${item.is_available ? 'Mark filled' : 'Mark available'}</button></div></article>`).join('')}${adverts.map(item => `<article><div><strong>${escapeHtml(item.headline)}</strong><span>${escapeHtml(item.category)} · ${escapeHtml(item.status)}${item.service_availability?.booked_until ? ` · Fully booked until ${escapeHtml(item.service_availability.booked_until)}` : ''}</span></div><div class="sell-manage-actions"><button type="button" data-edit-advert="${item.id}">Edit</button>${item.status === 'approved' ? `<button type="button" data-pause-ad="${item.id}">Pause listing</button>` : `<button type="button" data-publish-ad="${item.id}">Publish listing</button>`}</div></article>`).join('') || (!rooms.length ? '<p>You have no listings yet.</p>' : '')}</div>`;
      content.dataset.rooms = JSON.stringify(rooms);
      content.dataset.adverts = JSON.stringify(adverts);
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
    const locationButton = event.target.closest('[data-use-location]');
    if (locationButton) {
      const locationStatus = locationButton.parentElement.querySelector('.sell-location-status');
      if (!navigator.geolocation) {
        locationStatus.hidden = false;
        locationStatus.textContent = 'Location is unavailable on this device. You can enter coordinates manually.';
        locationStatus.classList.add('error');
        status(locationStatus.textContent, true);
        return;
      }
      const form = locationButton.closest('form');
      locationButton.disabled = true;
      locationButton.classList.add('is-loading');
      locationButton.setAttribute('aria-busy', 'true');
      locationButton.textContent = 'Fetching coordinates…';
      locationStatus.hidden = false;
      locationStatus.classList.remove('error');
      locationStatus.textContent = 'Fetching coordinates…';
      status('');
      const finish = (text, error = false) => {
        locationButton.disabled = false;
        locationButton.classList.remove('is-loading');
        locationButton.removeAttribute('aria-busy');
        locationButton.textContent = 'Use my current location';
        locationStatus.textContent = text;
        locationStatus.classList.toggle('error', error);
        if (form.isConnected) status(text, error);
      };
      try {
        navigator.geolocation.getCurrentPosition(position => {
          if (form.isConnected) {
            form.elements.latitude.value = position.coords.latitude.toFixed(6);
            form.elements.longitude.value = position.coords.longitude.toFixed(6);
          }
          finish('Location added to this listing.');
        }, () => finish('Location was not shared. You can enter coordinates manually.', true), {timeout:15000});
      } catch (_) {
        finish('Location could not be fetched. You can enter coordinates manually.', true);
      }
      return;
    }
    if (event.target.closest('[data-sell-back]')) { status(''); renderChoice(); return; }
    if (event.target.closest('[data-my-listings]')) { status(''); await renderMyListings(); return; }
    const editRoom = event.target.closest('[data-edit-room]');
    if (editRoom) { const item = JSON.parse(content.dataset.rooms || '[]').find(row => String(row.id) === editRoom.dataset.editRoom); if (item) renderEditListing('room', item); return; }
    const editAdvert = event.target.closest('[data-edit-advert]');
    if (editAdvert) { const item = JSON.parse(content.dataset.adverts || '[]').find(row => String(row.id) === editAdvert.dataset.editAdvert); if (item) renderEditListing('advert', item); return; }
    const deleteButton = event.target.closest('[data-delete-listing]');
    if (deleteButton) {
      if (!confirm('Permanently delete this listing and its photos from the market? This cannot be undone.')) return;
      try { await request(deleteButton.dataset.deleteListing === 'room' ? `/marketing/listings/${deleteButton.dataset.listingId}` : `/marketing/adverts/${deleteButton.dataset.listingId}`, {method:'DELETE'}); await renderMyListings(); document.dispatchEvent(new Event('market-listing-changed')); status('Listing deleted.'); }
      catch (error) { status(error.message, true); }
      return;
    }
    if (event.target.closest('[data-sell-messages]')) { status(''); await renderMessages(); return; }
    if (event.target.closest('[data-sell-signout]')) { token = ''; profile = null; sessionStorage.removeItem('landlordToken'); sessionStorage.removeItem('activeRole'); mode = 'login'; renderAuth(); return; }
    const toggle = event.target.closest('[data-toggle-room]');
    if (toggle) {
      const item = JSON.parse(content.dataset.rooms || '[]').find(row => String(row.id) === toggle.dataset.toggleRoom);
      if (!item) return;
      const form = new FormData();
      for (const field of ['title','campus','area','monthly_rent','bedrooms','description','contact']) form.append(field, item[field] ?? '');
      form.append('is_available', String(!item.is_available));
      form.append('booked_until', item.is_available ? (item.booked_until || '') : '');
      try { await request(`/marketing/listings/${item.id}`, {method:'PUT', body:form}); await renderMyListings(); document.dispatchEvent(new Event('market-listing-changed')); }
      catch (error) { status(error.message, true); }
    }
    const pause = event.target.closest('[data-pause-ad]');
    if (pause) {
      try { await request(`/marketing/adverts/${pause.dataset.pauseAd}/pause`, {method:'PUT'}); await renderMyListings(); document.dispatchEvent(new Event('market-listing-changed')); }
      catch (error) { status(error.message, true); }
    }
    const publish = event.target.closest('[data-publish-ad]');
    if (publish) {
      const item = JSON.parse(content.dataset.adverts || '[]').find(row => String(row.id) === publish.dataset.publishAd);
      if (item) renderEditListing('advert', item);
    }
  });
  dialog.addEventListener('change', event => {
    if (event.target.name !== 'category') return;
    const form = event.target.form;
    for (const [id, active] of [['otherServiceField', event.target.value === 'Other'], ['churchLocationField', event.target.value === 'Churches'], ['churchCoordinatesField', event.target.value === 'Churches']]) {
      const field = form.querySelector(`#${id}`);
      field.hidden = !active;
      field.querySelectorAll('input').forEach(input => {
        input.disabled = !active;
        input.required = active && (id === 'otherServiceField' || id === 'churchLocationField');
        if (!active) input.value = '';
      });
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
      if (form.id === 'editListingForm') {
        const data = new FormData(form);
        const originalPhotos = JSON.parse(content.dataset.editPhotos || '[]');
        const retained = originalPhotos.filter((_, index) => form.querySelector(`[data-keep-photo="${index}"]`)?.checked);
        const added = [...(form.elements.images?.files || [])];
        if (retained.length + added.length > 3) throw new Error('Keep and add no more than 3 photos in total.');
        data.set('retained_image_urls', JSON.stringify(retained));
        if (String(data.get('contact') || '').replace(/\D/g, '').length < 8) throw new Error('Add a valid contact number.');
        if (form.dataset.type === 'room') {
          data.set('is_available', String(form.elements.is_available.checked));
          await request(`/marketing/listings/${form.dataset.id}`, {method:'PUT', body:data});
        } else {
          data.set('status', form.elements.status.value);
          await request(`/marketing/adverts/${form.dataset.id}`, {method:'PUT', body:data});
          if (form.elements.opening_hours) {
            const split = name => form.elements[name].value.split(',').map(value => value.trim()).filter(Boolean);
            await request(`/marketing/adverts/${form.dataset.id}/availability`, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({opening_hours:form.elements.opening_hours.value, available_dates:split('available_dates'), available_times:split('available_times'), closed_dates:split('closed_dates'), booked_until:form.elements.booked_until.value, consultations:form.elements.consultations.checked, consultation_minutes:form.elements.consultation_minutes.value ? Number(form.elements.consultation_minutes.value) : null, consultation_mode:form.elements.consultation_mode.value})});
          }
        }
        document.dispatchEvent(new Event('market-listing-changed'));
        await renderMyListings(); status('Listing updated.');
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
        if (files.length > 3) throw new Error('Choose no more than 3 photos.');
        if (String(data.get('contact') || '').replace(/\D/g, '').length < 8) throw new Error('Add a valid contact number for this listing.');
        await request(kind === 'room' ? '/marketing/listings' : '/marketing/adverts', {method:'POST', body:data});
        document.dispatchEvent(new Event('market-listing-changed'));
        renderChoice();
        status(kind === 'room' ? 'Your room was submitted for admin approval.' : 'Your listing is published.');
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
