(() => {
  const dialog = document.getElementById('sellDialog');
  const content = document.getElementById('sellContent');
  const message = document.getElementById('sellMessage');
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let profile = null;
  let kind = '';
  let preview = null, saving = false;
  const previewUrls = [];

  async function request(path,options={}) {
    const result=await ArounusMarketAuth.request(path,options);
    if(result===null)throw new Error('Sign in to continue.');
    return result;
  }
  function status(text, error = false) {
    message.textContent = text;
    message.classList.toggle('error', error);
  }
  function clearPreview() {
    previewUrls.splice(0).forEach(url => URL.revokeObjectURL(url));
    if (!preview) return;
    preview.panel.remove();
    preview.hidden.forEach(([node, hidden]) => { node.hidden = hidden; });
    document.getElementById('sellTitle').textContent = preview.title;
    document.getElementById('sellIntro').textContent = preview.intro;
    preview = null;
  }
  const safePreviewUrl = value => {
    try { const url = new URL(value, location.origin); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
    catch { return ''; }
  };
  function listingData(form) {
    if (!form.reportValidity()) return null;
    const data = new FormData(form);
    const added = [...(form.elements.images?.files || [])];
    const retained = form.id === 'editListingForm' ? JSON.parse(content.dataset.editPhotos || '[]').filter((_, index) => form.querySelector(`[data-keep-photo="${index}"]`)?.checked) : [];
    if (retained.length + added.length > 3) throw new Error('Choose or keep no more than 3 photos in total.');
    if (added.some(file => file.type && !file.type.startsWith('image/'))) throw new Error('Choose image files for your listing photos.');
    if (String(data.get('contact') || '').replace(/\D/g, '').length < 8) throw new Error('Add a valid contact number for this listing.');
    if (form.id === 'editListingForm') data.set('retained_image_urls', JSON.stringify(retained));
    return {data, added, retained};
  }
  function showPreview(form) {
    const values = listingData(form);
    if (!values) return;
    clearPreview();
    const room = form.id === 'editListingForm' ? form.dataset.type === 'room' : kind === 'room';
    const get = name => String(values.data.get(name) || '').trim();
    const title = get(room ? 'title' : 'headline');
    const category = get('category');
    const categoryLabel = room ? 'Rooms' : /transport|ride|shuttle|courier|delivery/i.test(category) ? 'Transport' : /sales|retail|technology|second.?hand|textbook/i.test(category) ? 'Items for sale' : 'Other services';
    const amount = get(room ? 'monthly_rent' : 'price');
    const price = amount !== '' ? `R${Number(amount).toLocaleString('en-ZA')}${room ? ' / month' : ''}` : room ? 'Price on request' : 'Ask for price';
    const available = room && (form.id !== 'editListingForm' || form.elements.is_available.checked);
    const badge = room ? `<span class="room-availability room-availability--${available ? 'available' : 'filled'}"><span aria-hidden="true">●</span> ${available ? 'Available' : 'Filled'}</span>` : '';
    const photos = values.retained.map(safePreviewUrl).filter(Boolean);
    values.added.forEach(file => { const url = URL.createObjectURL(file); previewUrls.push(url); photos.push(url); });
    const seller = room ? profile.full_name : get('business_name');
    const meta = [get('campus') || 'Location not specified', get('area'), form.id === 'sellListingForm' ? 'Posted today' : ''].filter(Boolean).join(' · ');
    const details = [['Location',get('campus')],['Area',get('area')],['Room type',get('bedrooms')],['Contact number',get('contact')],['Activity or service',get('service_detail')],['Stock available',get('stock_quantity')],['Website or social link',get('website_url')],['Latitude',get('latitude')],['Longitude',get('longitude')],['Fully booked until',get('booked_until')],['Opening hours',get('opening_hours')],['Available dates',get('available_dates')],['Available times',get('available_times')],['Closed dates',get('closed_dates')],['Consultation format',get('consultation_mode')]];
    if (form.elements.consultations?.checked) details.push(['Consultations',get('consultation_minutes') ? `${get('consultation_minutes')} minutes` : 'Available']);
    if (form.elements.status) details.push(['Visibility',get('status') === 'paused' ? 'Paused — hidden from the public' : 'Published']);
    const panel = document.createElement('section');
    panel.className = 'sell-preview'; panel.setAttribute('aria-labelledby', 'sellPreviewHeading');
    const action = form.id === 'editListingForm' ? 'Save changes' : room ? 'Submit room for approval' : 'Publish listing';
    panel.innerHTML = `<h3 id="sellPreviewHeading" tabindex="-1">Preview your listing</h3><p>${form.id === 'editListingForm' ? 'Review your changes before saving them.' : 'Nothing has been published yet. Check your photos and details before continuing.'}</p>
      <article class="campus-card sell-preview-card"><div class="campus-card-media sell-preview-media">${photos.length ? `<img src="${escapeHtml(photos[0])}" alt="${escapeHtml(title)}" data-preview-main>` : `<span>${categoryLabel}</span>`}${badge}${photos.length > 1 ? `<small class="photo-count">${photos.length} photos</small>` : ''}</div><div class="campus-card-body"><span class="card-kind">${categoryLabel}</span><h3>${escapeHtml(title)}</h3><p class="card-meta">${escapeHtml(meta)}</p><p class="card-price">${escapeHtml(price)}</p><p class="card-provider">${escapeHtml(seller)}</p></div></article>
      ${photos.length > 1 ? `<div class="sell-preview-thumbs" aria-label="Preview photos">${photos.map((url,index) => `<button type="button" data-preview-photo="${index}" aria-label="Show preview photo ${index + 1}" aria-pressed="${index === 0}"><img src="${escapeHtml(url)}" alt=""></button>`).join('')}</div>` : ''}
      <h3>Listing details</h3><p class="sell-preview-description">${escapeHtml(get('description'))}</p><dl class="sell-preview-details">${details.filter(([,value]) => value !== '').map(([label,value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>
      <p class="sell-preview-note">${room && form.id === 'sellListingForm' ? 'Your room will be sent for administrator approval. It appears publicly after approval.' : 'Your listing will use these photos and details. Its layout may adapt to the viewer’s screen.'}</p>
      <div class="sell-publish-progress" role="status" aria-live="polite" hidden><span class="sell-publish-spinner" aria-hidden="true"></span><div><strong data-publish-label></strong><p>Uploading photos and saving your listing. This may take a moment.</p></div></div>
      <div class="sell-preview-actions"><button type="button" data-edit-preview>Edit details</button><button type="button" data-confirm-listing>${action}</button></div>`;
    preview = {form, panel, photos, title:document.getElementById('sellTitle').textContent, intro:document.getElementById('sellIntro').textContent, hidden:[...content.children].map(node => [node,node.hidden])};
    preview.hidden.forEach(([node]) => { node.hidden = true; });
    content.append(panel);
    document.getElementById('sellTitle').textContent = 'Review before publishing';
    document.getElementById('sellIntro').textContent = 'Preview → Edit if needed → Publish or submit';
    status(''); panel.querySelector('h3').focus();
  }
  function publishingState(active) {
    saving = active;
    content.setAttribute('aria-busy', String(active));
    document.getElementById('closeSell').disabled = active;
    if (!preview) return;
    preview.panel.querySelectorAll('button').forEach(button => { button.disabled = active; });
    preview.panel.querySelector('.sell-publish-progress').hidden = !active;
    if (active) {
      const text = preview.form.id === 'editListingForm' ? 'Saving your changes…' : kind === 'room' ? 'Submitting your room…' : 'Publishing your listing…';
      preview.panel.querySelector('[data-publish-label]').textContent = text;
      status(text);
    }
  }
  async function publishPreview() {
    if (!preview || saving) return;
    const form = preview.form;
    // Capture the preserved draft before changing the visible controls.
    let values;
    try { values = listingData(form); } catch (error) { status(error.message, true); return; }
    if (!values) return;
    publishingState(true);
    try {
      const data = values.data;
      if (form.id === 'editListingForm') {
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
      } else {
        const wasRoom = kind === 'room';
        await request(wasRoom ? '/marketing/listings' : '/marketing/adverts', {method:'POST', body:data});
        document.dispatchEvent(new Event('market-listing-changed'));
        renderChoice();
        status(wasRoom ? 'Your room was submitted for approval. We will email you a confirmation and alert you with its link when it is approved and live.' : 'Your listing is published.');
      }
    } catch (error) { status(`${error.message} Your draft is kept here. You can retry or edit its details.`, true); }
    finally { publishingState(false); }
  }
  function renderChoice() {
    clearPreview();
    kind = '';
    document.getElementById('sellTitle').textContent = 'Sell or list';
    document.getElementById('sellIntro').textContent = `Signed in as ${profile.full_name}. Choose what you want to offer.`;
    content.innerHTML = `<div class="sell-choice"><button type="button" data-sell-kind="room"><strong>A room or accommodation</strong><span>Monthly rent, location, and room details</span></button><button type="button" data-sell-kind="advert"><strong>An item, ride, or service</strong><span>Price, description, and how buyers can reach you</span></button></div><div class="sell-account-actions"><button type="button" data-my-listings>Manage my listings</button><button type="button" data-sell-messages>Messages</button><button type="button" data-sell-signout>Sign out</button></div>`;
  }
  function renderForm(selected) {
    clearPreview();
    kind = selected;
    const room = selected === 'room';
    document.getElementById('sellTitle').textContent = room ? 'List accommodation' : 'List an item, ride, or service';
    document.getElementById('sellIntro').textContent = room ? 'Add the details people need to compare rooms. An admin will approve this room before it appears.' : 'Your listing will appear as soon as you publish it.';
    content.innerHTML = `<button class="sell-back" type="button" data-sell-back>← Choose another listing type</button><form id="sellListingForm" class="sell-form" enctype="multipart/form-data">
      ${room ? `<label>Listing title<input name="title" maxlength="180" placeholder="For example, Room near a company, school or mine" required></label>
        <label>Nearby organisation or landmark<input name="campus" placeholder="Company, school, college, university, mine or area" maxlength="120" required></label>
        <label>Area or suburb<input name="area" maxlength="160" required></label>
        <div class="sell-location"><label>Latitude <span>(optional)</span><input name="latitude" type="number" step="any" min="-90" max="90"></label><label>Longitude <span>(optional)</span><input name="longitude" type="number" step="any" min="-180" max="180"></label><button type="button" data-use-location>Use my current location</button><small class="sell-location-status" role="status" aria-live="polite" hidden></small></div>
        <label>Monthly rent (R)<input name="monthly_rent" type="number" min="0" inputmode="numeric" required></label>
        <label>Room type <span>(optional)</span><input name="bedrooms" maxlength="80" placeholder="Single, shared, bachelor…"></label>
        <label>Contact number for this listing<input name="contact" type="tel" autocomplete="tel" required></label>
        <label>Description<textarea name="description" maxlength="2500" placeholder="Utilities, rules, availability, and what is included" required></textarea></label>
        <label>Photos <span>(up to 3, optional)</span><input name="images" type="file" accept="image/*" multiple data-max-files="3"></label>` : `
        <label>Business or seller name<input name="business_name" maxlength="160" value="${escapeHtml(profile.business_name || profile.full_name)}" required></label>
        <label>Listing title<input name="headline" maxlength="180" required></label>
        <label>Category<select name="category" required><option value="">Choose a category</option><option>Sales & retail</option><option>Technology</option><option>Ride & transport</option><option>Delivery & courier</option><option value="Campus shuttle">Shuttle service</option><option value="Student service">Local service</option><option>Food & delivery</option><option>Tutoring</option><option>Event</option><option>Beauty & lifestyle</option><option>Churches</option><option>Other</option></select></label>
        <label id="otherServiceField" hidden>Actual activity or service<input name="service_detail" maxlength="160" disabled></label>
        <label>Price (R) <span>(optional for services)</span><input name="price" type="number" min="0" max="100000000" inputmode="numeric"></label>
        <label>Stock quantity <span>(optional for products)</span><input name="stock_quantity" type="number" min="0" max="1000000" inputmode="numeric"></label>
        <label>Nearby organisation or landmark<input name="campus" placeholder="Company, school, college, university, mine or area" maxlength="120"></label>
        <label id="churchLocationField" hidden>Church location or area<input name="area" maxlength="160" disabled></label>
        <div class="sell-location" id="churchCoordinatesField" hidden><label>Latitude <span>(optional)</span><input name="latitude" type="number" step="any" min="-90" max="90" disabled></label><label>Longitude <span>(optional)</span><input name="longitude" type="number" step="any" min="-180" max="180" disabled></label><button type="button" data-use-location>Use my current location</button><small class="sell-location-status" role="status" aria-live="polite" hidden></small></div>
        <label>Description<textarea name="description" maxlength="1200" required></textarea></label>
        <label>Contact number for this listing<input name="contact" type="tel" autocomplete="tel" required></label>
        <label>Website or social link <span>(optional)</span><input name="website_url" type="url" placeholder="https://…"></label>
        <label>Photos <span>(up to 3, optional)</span><input name="images" type="file" accept="image/*" multiple data-max-files="3"></label>
        <input type="hidden" name="placement" value="feed">`}
      <button type="submit">Preview listing</button>
    </form>`;
  }
  const isService = item => !/transport|ride|shuttle|courier|delivery|sales|retail|technology|second.?hand|textbook/i.test(item.category);
  const listingPhotos = item => (item.image_urls || (item.image_url ? [item.image_url] : []));
  function renderEditListing(type, item) {
    clearPreview();
    const room = type === 'room', availability = item.service_availability || {};
    const value = name => escapeHtml(item[name] ?? '');
    const photos = listingPhotos(item);
    document.getElementById('sellTitle').textContent = `Edit ${room ? 'room' : 'listing'}`;
    document.getElementById('sellIntro').textContent = 'Update the details customers see. Save when finished.';
    content.innerHTML = `<button class="sell-back" type="button" data-my-listings>← My listings</button><form id="editListingForm" class="sell-form" data-type="${type}" data-id="${item.id}" enctype="multipart/form-data">
      ${room ? `<label>Listing title<input name="title" maxlength="180" value="${value('title')}" required></label><label>Nearby organisation or landmark<input name="campus" placeholder="Company, school, college, university, mine or area" maxlength="120" value="${value('campus')}" required></label><label>Area or suburb<input name="area" maxlength="160" value="${value('area')}" required></label><label>Monthly rent (R)<input name="monthly_rent" type="number" min="0" value="${value('monthly_rent')}"></label><label>Room type<input name="bedrooms" maxlength="80" value="${value('bedrooms')}"></label>` : `<label>Business or seller name<input name="business_name" maxlength="160" value="${value('business_name')}" required></label><label>Listing title<input name="headline" maxlength="180" value="${value('headline')}" required></label><label>Category<select name="category" required>${['Sales & retail','Technology','Ride & transport','Delivery & courier','Campus shuttle','Student service','Food & delivery','Tutoring','Event','Beauty & lifestyle','Churches','Other'].map(category => `<option value="${escapeHtml(category)}" ${item.category === category ? 'selected' : ''}>${category === 'Campus shuttle' ? 'Shuttle service' : category === 'Student service' ? 'Local service' : escapeHtml(category)}</option>`).join('')}</select></label><label>Activity or service<input name="service_detail" maxlength="160" value="${value('service_detail')}"></label><label>Price (R)<input name="price" type="number" min="0" max="100000000" value="${value('price')}"></label><label>Stock quantity (optional, for products)<input name="stock_quantity" type="number" min="0" max="1000000" value="${value('stock_quantity')}"></label><label>Nearby organisation or landmark<input name="campus" placeholder="Company, school, college, university, mine or area" maxlength="120" value="${value('campus')}"></label><label>Area or suburb<input name="area" maxlength="160" value="${value('area')}"></label>`}
      <label>Description<textarea name="description" maxlength="${room ? 2500 : 1200}" required>${value('description')}</textarea></label><label>Contact number<input name="contact" type="tel" value="${value('contact')}" required></label>${room ? `<label><input name="is_available" type="checkbox" ${item.is_available ? 'checked' : ''}> Available now</label><label>Fully booked until (optional)<input name="booked_until" type="date" value="${value('booked_until')}"></label>` : `<label>Website or social link<input name="website_url" type="url" value="${value('website_url')}"></label><label>Listing visibility<select name="status"><option value="approved" ${item.status === 'approved' ? 'selected' : ''}>Published</option><option value="paused" ${item.status === 'paused' ? 'selected' : ''}>Paused</option></select></label>`}
      <div class="sell-photo-editor"><strong>Photos (up to 3)</strong>${photos.map((url, index) => `<label><input type="checkbox" data-keep-photo="${index}" checked><img src="${escapeHtml(url)}" alt="Listing photo ${index + 1}"> Keep photo ${index + 1}</label>`).join('') || '<p>No photos yet.</p>'}</div><label>Add photos<input name="images" type="file" accept="image/*" multiple></label>
      ${!room && isService(item) ? `<fieldset class="sell-availability-fields"><legend>Service and consultation availability</legend><label>Opening hours and days<textarea name="opening_hours" maxlength="500">${escapeHtml(availability.opening_hours || '')}</textarea></label><label>Available dates (YYYY-MM-DD, comma separated)<textarea name="available_dates">${escapeHtml((availability.available_dates || []).join(', '))}</textarea></label><label>Available times (HH:MM, comma separated)<textarea name="available_times">${escapeHtml((availability.available_times || []).join(', '))}</textarea></label><label>Closed dates (YYYY-MM-DD, comma separated)<textarea name="closed_dates">${escapeHtml((availability.closed_dates || []).join(', '))}</textarea></label><label>Fully booked until<input name="booked_until" type="date" value="${escapeHtml(availability.booked_until || '')}"></label><label><input name="consultations" type="checkbox" ${availability.consultations ? 'checked' : ''}> Offer consultations</label><label>Consultation length (minutes)<input name="consultation_minutes" type="number" min="5" max="480" value="${escapeHtml(availability.consultation_minutes || '')}"></label><label>Consultation format<input name="consultation_mode" maxlength="80" value="${escapeHtml(availability.consultation_mode || '')}"></label></fieldset>` : ''}
      <button type="submit">Preview changes</button></form><button class="sell-delete" type="button" data-delete-listing="${type}" data-listing-id="${item.id}">Delete listing</button>`;
    content.dataset.editPhotos = JSON.stringify(photos);
  }
  async function renderMyListings() {
    clearPreview();
    document.getElementById('sellTitle').textContent = 'My listings';
    document.getElementById('sellIntro').textContent = 'Manage all your offers with your Arounus account.';
    content.innerHTML = '<button class="sell-back" type="button" data-sell-back>← Add another listing</button><p>Loading your listings…</p>';
    try {
      const [rooms, adverts] = await Promise.all([request('/marketing/landlord/listings'), request('/marketing/my-adverts')]);
      content.innerHTML = `<button class="sell-back" type="button" data-sell-back>← Add another listing</button><div class="sell-manage">${rooms.map(item => `<article><div><strong>${escapeHtml(item.title)}</strong><span>Room · ${item.is_approved ? (item.is_available ? 'Published' : item.booked_until ? `Fully booked until ${escapeHtml(item.booked_until)}` : 'Filled') : 'Awaiting approval'}</span></div><div class="sell-manage-actions"><button type="button" data-edit-room="${item.id}">Edit</button><button type="button" data-toggle-room="${item.id}">${item.is_available ? 'Mark filled' : 'Mark available'}</button></div></article>`).join('')}${adverts.map(item => `<article><div><strong>${escapeHtml(item.headline)}</strong><span>${escapeHtml(item.category)} · ${escapeHtml(item.status)}${item.service_availability?.booked_until ? ` · Fully booked until ${escapeHtml(item.service_availability.booked_until)}` : ''}</span></div><div class="sell-manage-actions"><button type="button" data-edit-advert="${item.id}">Edit</button>${item.status === 'approved' ? `<button type="button" data-pause-ad="${item.id}">Pause listing</button>` : `<button type="button" data-publish-ad="${item.id}">Publish listing</button>`}</div></article>`).join('') || (!rooms.length ? '<p>You have no listings yet.</p>' : '')}</div>`;
      content.dataset.rooms = JSON.stringify(rooms);
      content.dataset.adverts = JSON.stringify(adverts);
    } catch (error) { status(error.message, true); renderChoice(); }
  }
  async function renderMessages() {
    clearPreview();
    document.getElementById('sellTitle').textContent = 'My market messages';
    document.getElementById('sellIntro').textContent = 'Read and reply to conversations with your Arounus market contacts.';
    content.innerHTML = '<button class="sell-back" type="button" data-sell-back>← Back to listings</button><p>Loading messages…</p>';
    try {
      const rows = await request('/marketing/provider/messages');
      const threads = new Map();
      rows.forEach(row => {
        const type=row.peer_type||(row.sender_type==='landlord'?row.recipient_type:row.sender_type);
        const id=row.peer_id||(row.sender_type==='landlord'?row.recipient_id:row.sender_id);
        if(!id)return;
        const key=type+':'+id;
        if(!threads.has(key))threads.set(key,{type,id,name:row.peer_name||row.sender_name,messages:[]});
        threads.get(key).messages.push(row);
      });
      content.innerHTML=`<button class="sell-back" type="button" data-sell-back>← Back to listings</button><div class="sell-inbox">${[...threads].map(([key,thread])=>`<section><h3>${escapeHtml(thread.name)}</h3><div class="sell-thread">${thread.messages.reverse().map(row=>`<p><strong>${escapeHtml(row.is_outgoing?'You':row.sender_name)}:</strong> ${escapeHtml(row.content)}</p>`).join('')}</div><form data-reply-to="${escapeHtml(key)}"><label>Reply<textarea name="content" maxlength="2000" required></textarea></label><button type="submit">Send reply</button></form></section>`).join('')||'<p>No messages yet.</p>'}</div>`;
      for(const thread of threads.values())request('/marketing/provider/messages/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target_type:thread.type,target_id:thread.id})}).catch(()=>{});
    } catch (error) { status(error.message, true); renderChoice(); }
  }
  async function open(showMessages=false) {
    if (saving) return;
    status('');
    try {
      const session=await ArounusMarketAuth.ensureSignedIn();
      if(!session)return;
      profile=session.profile;
      document.getElementById('contactDialog')?.close();
      if(!dialog.open)dialog.showModal();
      if(showMessages)await renderMessages();else renderChoice();
    } catch(error) {
      status(error.message,true);
      if(!dialog.open)dialog.showModal();
    }
  }
  document.addEventListener('click',event=>{
    const messages=event.target.closest('[data-market-messages]');
    if(!messages&&!event.target.closest('[data-open-sell]'))return;
    event.preventDefault();
    open(Boolean(messages));
  });
  document.getElementById('closeSell').addEventListener('click', () => { if (!saving) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  dialog.addEventListener('close', () => { if (!saving) clearPreview(); });
  dialog.addEventListener('click', async event => {
    if (saving) return;
    if (event.target.closest('[data-edit-preview]')) { const form = preview?.form; clearPreview(); status(''); form?.querySelector('input:not([type=hidden]),select,textarea')?.focus(); return; }
    if (event.target.closest('[data-confirm-listing]')) { await publishPreview(); return; }
    const photo = event.target.closest('[data-preview-photo]');
    if (photo && preview) {
      preview.panel.querySelector('[data-preview-main]').src = preview.photos[Number(photo.dataset.previewPhoto)];
      preview.panel.querySelectorAll('[data-preview-photo]').forEach(button => button.setAttribute('aria-pressed', String(button === photo)));
      return;
    }
    const choice = event.target.closest('[data-sell-kind]');
    if (choice) { status(''); renderForm(choice.dataset.sellKind); return; }
    const locationButton = event.target.closest('[data-use-location]');
    if (locationButton) {
      const locationStatus = locationButton.parentElement.querySelector('.sell-location-status');
      if (!navigator.geolocation) {
        locationStatus.hidden = false;
        locationStatus.textContent = 'This browser cannot get your location. You can leave coordinates blank and use the area or suburb instead.';
        locationStatus.classList.add('error');
        status(locationStatus.textContent, true);
        return;
      }
      const form = locationButton.closest('form');
      const isActive = () => form.isConnected && !form.hidden && dialog.open && !form.elements.latitude.disabled;
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
        if (isActive()) status(text, error);
      };
      try {
        navigator.geolocation.getCurrentPosition(position => {
          if (isActive()) {
            form.elements.latitude.value = position.coords.latitude.toFixed(6);
            form.elements.longitude.value = position.coords.longitude.toFixed(6);
          }
          finish('Location added to this listing.');
        }, error => {
          const messages = {
            1: 'Location access is blocked. Allow location for arounus.com in your browser\u2019s site settings, check that device Location is on, then try again. Coordinates are optional.',
            2: 'Your device could not find its location. Check that Location is on and try again, or leave coordinates blank and use the area or suburb.',
            3: 'Finding your location took too long. Try again, or leave coordinates blank and use the area or suburb.'
          };
          finish(messages[error?.code] || 'Location could not be fetched. Try again, or leave coordinates blank and use the area or suburb.', true);
        }, {timeout:15000, maximumAge:60000});
      } catch (_) {
        finish('Location could not be fetched. Try again, or leave coordinates blank and use the area or suburb.', true);
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
    if (event.target.closest('[data-sell-signout]')) { profile=null;ArounusMarketAuth.signOut();dialog.close();return; }
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
      if (!field) continue;
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
    if (saving) return;
    const form = event.target;
    if (form.id === 'sellListingForm' || form.id === 'editListingForm') {
      try { showPreview(form); } catch (error) { status(error.message, true); }
      return;
    }
    if (!form.dataset.replyTo) return;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true; status('Sending…');
    try {
      await request('/marketing/provider/messages', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({recipient_type:form.dataset.replyTo.split(':')[0], recipient_id:Number(form.dataset.replyTo.split(':')[1]), content:form.elements.content.value, is_anonymous:false})});
      status('Message sent.'); await renderMessages();
    } catch (error) { status(error.message, true); }
    finally { if (form.isConnected) submit.disabled = false; }
  });
  const params = new URLSearchParams(location.search);
  if (params.has('sell') || params.has('create') || params.get('role') === 'advertiser' || location.hash === '#sell') {
    window.addEventListener('load', () => open(), {once:true});
  }
})();
