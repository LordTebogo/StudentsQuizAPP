(() => {
  const dialog = document.getElementById('sellDialog');
  const content = document.getElementById('sellContent');
  const message = document.getElementById('sellMessage');
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let profile = null;
  let kind = '';
  let preview = null, saving = false;
  const previewUrls = [];
  const photoOrders = new WeakMap();
  let draggedPhoto = null, pointerPhoto = null, suppressPhotoClick = false;

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
    clearPhotoDrag();
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
  function orderedDraftPhotos(form, values) {
    const pool = [...values.retained.map(url => ({type:'existing', value:url})), ...values.added.map(file => ({type:'upload', value:file}))];
    const ordered = [];
    for (const old of photoOrders.get(form) || []) {
      const match = pool.find(photo => photo.type === old.type && photo.value === old.value && !ordered.includes(photo));
      if (match) ordered.push(match);
    }
    pool.forEach(photo => { if (!ordered.includes(photo)) ordered.push(photo); });
    photoOrders.set(form, ordered);
    return ordered;
  }
  function photoControls() {
    if (!preview) return;
    const host = preview.panel.querySelector('.sell-preview-thumbs');
    if (!host) return;
    host.innerHTML = preview.photos.map((url,index) => `<li class="sell-preview-photo" draggable="${!saving}" data-preview-photo-item="${index}"><span class="sell-photo-drag-handle" data-photo-drag="${index}">⠿ Drag</span><button type="button" class="sell-photo-image" data-preview-photo="${index}" aria-label="View photo ${index + 1}${index === 0 ? ', listing thumbnail' : ''}" aria-pressed="${index === 0}"><img src="${escapeHtml(url)}" alt="" draggable="false"></button><strong class="sell-photo-position">${index === 0 ? 'Thumbnail' : `Photo ${index + 1}`}</strong><button class="sell-photo-first" type="button" data-photo-first="${index}" ${index === 0 ? 'disabled' : ''} aria-label="Make photo ${index + 1} the thumbnail">${index === 0 ? 'First photo' : 'Make first'}</button><div class="sell-photo-arrows"><button type="button" data-photo-move="${index}" data-step="-1" ${index === 0 ? 'disabled' : ''} aria-label="Move photo ${index + 1} earlier">←</button><button type="button" data-photo-move="${index}" data-step="1" ${index === preview.photos.length - 1 ? 'disabled' : ''} aria-label="Move photo ${index + 1} later">→</button></div></li>`).join('');
  }
  function movePhoto(from, to) {
    if (!preview || saving || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= preview.photos.length || to >= preview.photos.length || from === to) return;
    const [photo] = preview.order.splice(from, 1), [url] = preview.photos.splice(from, 1);
    preview.order.splice(to, 0, photo); preview.photos.splice(to, 0, url);
    photoOrders.set(preview.form, preview.order);
    preview.panel.querySelector('[data-preview-main]').src = preview.photos[0];
    photoControls();
    preview.panel.querySelector('[data-photo-order-status]').textContent = to === 0 ? `Photo ${from + 1} is now the thumbnail and will appear first.` : `Photo moved to position ${to + 1}. The first photo is the thumbnail.`;
    preview.panel.querySelector(`[data-preview-photo="${to}"]`)?.focus({preventScroll:true});
  }
  function clearPhotoDrag() {
    draggedPhoto = null; pointerPhoto = null;
    preview?.panel.querySelectorAll('.is-dragging,.is-drop-target').forEach(node => node.classList.remove('is-dragging','is-drop-target'));
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
    const order = orderedDraftPhotos(form, values);
    const photos = order.map(photo => {
      if (photo.type === 'existing') return safePreviewUrl(photo.value);
      const url = URL.createObjectURL(photo.value); previewUrls.push(url); return url;
    });
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
      ${photos.length > 1 ? '<div class="sell-photo-organizer"><h3>Choose your thumbnail and photo order</h3><p>Drag photos to reorder them, or use Make first and the arrows. The first photo is the thumbnail people see on your listing.</p><ol class="sell-preview-thumbs" aria-label="Listing photo order"></ol><p class="sell-photo-order-status" data-photo-order-status role="status" aria-live="polite">The first photo is your thumbnail.</p></div>' : ''}
      <h3>Listing details</h3><p class="sell-preview-description">${escapeHtml(get('description'))}</p><dl class="sell-preview-details">${details.filter(([,value]) => value !== '').map(([label,value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>
      <p class="sell-preview-note">${room && form.id === 'sellListingForm' ? 'Your room will be sent for administrator approval. It appears publicly after approval.' : 'Your listing will use these photos and details. Its layout may adapt to the viewer’s screen.'}</p>
      <div class="sell-publish-progress" role="status" aria-live="polite" hidden><span class="sell-publish-spinner" aria-hidden="true"></span><div><strong data-publish-label></strong><p>Uploading photos and saving your listing. This may take a moment.</p></div></div>
      <div class="sell-preview-actions"><button type="button" data-edit-preview>Edit details</button><button type="button" data-confirm-listing>${action}</button></div>`;
    preview = {form, panel, photos, order, title:document.getElementById('sellTitle').textContent, intro:document.getElementById('sellIntro').textContent, hidden:[...content.children].map(node => [node,node.hidden])};
    preview.hidden.forEach(([node]) => { node.hidden = true; });
    content.append(panel);
    photoControls();
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
    preview.panel.querySelectorAll('[data-preview-photo-item]').forEach(item => { item.draggable = !active; });
    if (active) clearPhotoDrag();
    else photoControls();
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
      const order = orderedDraftPhotos(form, values);
      data.set('image_order', JSON.stringify(order.map(photo => photo.type === 'existing' ? values.retained.indexOf(photo.value) : values.retained.length + values.added.indexOf(photo.value))));
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
    const customer=profile.provider_type==='customer';
    document.getElementById('sellTitle').textContent = customer ? 'My market account' : 'Sell or list';
    document.getElementById('sellIntro').textContent = customer ? `Signed in as ${profile.full_name}. Browse the market and message providers.` : `Signed in as ${profile.full_name}. Choose what you want to offer.`;
    content.innerHTML = `${customer ? '' : '<div class="sell-choice"><button type="button" data-sell-kind="room"><strong>A room or accommodation</strong><span>Monthly rent, location, and room details</span></button><button type="button" data-sell-kind="advert"><strong>An item, ride, or service</strong><span>Price, description, and how buyers can reach you</span></button></div>'}<div class="sell-account-actions">${customer ? '' : '<button type="button" data-my-listings>Manage my listings</button>'}<button type="button" data-sell-profile>My profile</button><button type="button" data-sell-messages>Messages</button><button type="button" data-sell-signout>Sign out</button></div>`;
  }
  function renderProfile() {
    clearPreview();
    document.getElementById('sellTitle').textContent='My profile';
    document.getElementById('sellIntro').textContent='Your name and photo appear in marketplace conversations and listings.';
    content.innerHTML=`<button class="sell-back" type="button" data-sell-back>← Back</button><form id="marketProfileForm" class="sell-form" enctype="multipart/form-data">${profile.profile_image_url ? `<img src="${escapeHtml(profile.profile_image_url)}" alt="Current profile picture" style="width:72px;height:72px;object-fit:cover;border-radius:50%">` : ''}<label>Full name<input name="full_name" value="${escapeHtml(profile.full_name)}" required></label>${profile.provider_type==='customer' ? '' : `<label>Business or service name<input name="business_name" value="${escapeHtml(profile.business_name || '')}"></label>`}<label>Contact number<input name="phone" type="tel" value="${escapeHtml(profile.phone || '')}" ${profile.provider_type==='customer' ? '' : 'required'}></label><label>Profile picture<input name="profile_image" type="file" accept="image/*"></label><button type="submit">Save profile</button></form>`;
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
        <label>Contact number for this listing<input name="contact" type="tel" autocomplete="tel" value="${escapeHtml(profile.phone || '')}" required></label>
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
        <label>Contact number for this listing<input name="contact" type="tel" autocomplete="tel" value="${escapeHtml(profile.phone || '')}" required></label>
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
    document.getElementById('sellIntro').textContent = room ? 'Update your room. Coordinate changes appear after admin approval; your current approved location stays active until then.' : 'Update the details customers see. Save when finished.';
    content.innerHTML = `<button class="sell-back" type="button" data-my-listings>← My listings</button><form id="editListingForm" class="sell-form" data-type="${type}" data-id="${item.id}" enctype="multipart/form-data">
      ${room ? `<label>Listing title<input name="title" maxlength="180" value="${value('title')}" required></label><label>Nearby organisation or landmark<input name="campus" placeholder="Company, school, college, university, mine or area" maxlength="120" value="${value('campus')}" required></label><label>Area or suburb<input name="area" maxlength="160" value="${value('area')}" required></label><label>Monthly rent (R)<input name="monthly_rent" type="number" min="0" value="${value('monthly_rent')}"></label><label>Room type<input name="bedrooms" maxlength="80" value="${value('bedrooms')}"></label>` : `<label>Business or seller name<input name="business_name" maxlength="160" value="${value('business_name')}" required></label><label>Listing title<input name="headline" maxlength="180" value="${value('headline')}" required></label><label>Category<select name="category" required>${['Sales & retail','Technology','Ride & transport','Delivery & courier','Campus shuttle','Student service','Food & delivery','Tutoring','Event','Beauty & lifestyle','Churches','Other'].map(category => `<option value="${escapeHtml(category)}" ${item.category === category ? 'selected' : ''}>${category === 'Campus shuttle' ? 'Shuttle service' : category === 'Student service' ? 'Local service' : escapeHtml(category)}</option>`).join('')}</select></label><label>Activity or service<input name="service_detail" maxlength="160" value="${value('service_detail')}"></label><label>Price (R)<input name="price" type="number" min="0" max="100000000" value="${value('price')}"></label><label>Stock quantity (optional, for products)<input name="stock_quantity" type="number" min="0" max="1000000" value="${value('stock_quantity')}"></label><label>Nearby organisation or landmark<input name="campus" placeholder="Company, school, college, university, mine or area" maxlength="120" value="${value('campus')}"></label><label>Area or suburb<input name="area" maxlength="160" value="${value('area')}"></label>`}
      <label>Description<textarea name="description" maxlength="${room ? 2500 : 1200}" required>${value('description')}</textarea></label><label>Contact number<input name="contact" type="tel" value="${value('contact')}" required></label>${room ? `<div class="sell-location"><label>Latitude <span>(private; admin approval required for changes)</span><input name="latitude" type="number" step="any" min="-90" max="90" value="${escapeHtml(item.pending_latitude ?? item.latitude ?? '')}"></label><label>Longitude <span>(private)</span><input name="longitude" type="number" step="any" min="-180" max="180" value="${escapeHtml(item.pending_longitude ?? item.longitude ?? '')}"></label><button type="button" data-use-location>Use my current location</button><small class="sell-location-status" role="status" aria-live="polite" hidden></small></div><label><input name="is_available" type="checkbox" ${item.is_available ? 'checked' : ''}> Available now</label><label>Fully booked until (optional)<input name="booked_until" type="date" value="${value('booked_until')}"></label>` : `<label>Website or social link<input name="website_url" type="url" value="${value('website_url')}"></label><label>Listing visibility<select name="status"><option value="approved" ${item.status === 'approved' ? 'selected' : ''}>Published</option><option value="paused" ${item.status === 'paused' ? 'selected' : ''}>Paused</option></select></label>`}
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
      content.innerHTML = `<button class="sell-back" type="button" data-sell-back>← Add another listing</button><div class="sell-manage">${rooms.map(item => `<article><div><strong>${escapeHtml(item.title)}</strong><span>Room · ${item.pending_latitude != null ? 'Location awaiting approval' : item.is_approved ? (item.is_available ? 'Published' : item.booked_until ? `Fully booked until ${escapeHtml(item.booked_until)}` : 'Filled') : 'Awaiting approval'}</span></div><div class="sell-manage-actions"><button type="button" data-edit-room="${item.id}">Edit</button><button type="button" data-toggle-room="${item.id}">${item.is_available ? 'Mark filled' : 'Mark available'}</button></div></article>`).join('')}${adverts.map(item => `<article><div><strong>${escapeHtml(item.headline)}</strong><span>${escapeHtml(item.category)} · ${escapeHtml(item.status)}${item.service_availability?.booked_until ? ` · Fully booked until ${escapeHtml(item.service_availability.booked_until)}` : ''}</span></div><div class="sell-manage-actions"><button type="button" data-edit-advert="${item.id}">Edit</button>${item.status === 'approved' ? `<button type="button" data-pause-ad="${item.id}">Pause listing</button>` : `<button type="button" data-publish-ad="${item.id}">Publish listing</button>`}</div></article>`).join('') || (!rooms.length ? '<p>You have no listings yet.</p>' : '')}</div>`;
      content.dataset.rooms = JSON.stringify(rooms);
      content.dataset.adverts = JSON.stringify(adverts);
    } catch (error) { status(error.message, true); renderChoice(); }
  }
  async function renderMessages() {
    clearPreview();
    document.getElementById('sellTitle').textContent = 'Messages';
    document.getElementById('sellIntro').textContent = 'Messages show your account name. Keep passwords and payment details private.';
    content.innerHTML = '<button class="sell-back" type="button" data-sell-back>← Back to listings</button><p class="muted" data-market-notification-note role="status"></p><div data-market-chats></div>';
    const chats=window.ArounusChat.mount(content.querySelector('[data-market-chats]'),{
      load:async showPreview=>{if(showPreview.initial)showPreview({rows:await request('/marketing/provider/messages?summary=true')});return {rows:await request('/marketing/provider/messages')};},
      canReply:t=>['student','lecturer','landlord'].includes(t.type),
      send:(t,text)=>request('/marketing/provider/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipient_type:t.type,recipient_id:t.id,content:text,is_anonymous:false})}),
      read:(t,rows)=>request('/marketing/provider/messages/read-items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message_ids:rows.map(m=>m.id)})}),
      onRead:()=>document.dispatchEvent(new Event('market-messages-updated'))
    });
    document.dispatchEvent(new Event('market-notifications-view'));
    return chats;
  }
  async function open(showMessages=false) {
    if (saving) return;
    status('');
    try {
      const session=await ArounusMarketAuth.ensureSignedIn(showMessages ? 'browse' : 'sell');
      if(!session)return;
      profile=session.profile;
      document.getElementById('contactDialog')?.close();
      if(!dialog.open)dialog.showModal();
      if(showMessages)return await renderMessages();else renderChoice();
    } catch(error) {
      status(error.message,true);
      if(!dialog.open)dialog.showModal();
    }
  }
  window.openMarketConversation = async (id, name, image) => {
    const chats = await open(true);
    if (!chats) return;
    chats.open('landlord', id, name || 'Market contact', image);
  };
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
    const first = event.target.closest('[data-photo-first]');
    if (first) { movePhoto(Number(first.dataset.photoFirst), 0); return; }
    const move = event.target.closest('[data-photo-move]');
    if (move) { const from = Number(move.dataset.photoMove); movePhoto(from, from + Number(move.dataset.step)); return; }
    const photo = event.target.closest('[data-preview-photo]');
    if (photo && preview) {
      if (suppressPhotoClick) { event.preventDefault(); return; }
      preview.panel.querySelector('[data-preview-main]').src = preview.photos[Number(photo.dataset.previewPhoto)];
      preview.panel.querySelectorAll('[data-preview-photo]').forEach(button => button.setAttribute('aria-pressed', String(button === photo)));
      return;
    }
    const choice = event.target.closest('[data-sell-kind]');
    if (choice) { status(''); renderForm(choice.dataset.sellKind); return; }
    if (event.target.closest('[data-sell-profile]')) { status(''); renderProfile(); return; }
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
  dialog.addEventListener('dragstart', event => {
    if (pointerPhoto) { event.preventDefault(); return; }
    const item = event.target.closest('[data-preview-photo-item]');
    if (!item || !preview || saving) return;
    draggedPhoto = Number(item.dataset.previewPhotoItem);
    item.classList.add('is-dragging');
    if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(draggedPhoto)); }
  });
  dialog.addEventListener('dragover', event => {
    const item = event.target.closest('[data-preview-photo-item]');
    if (!item || draggedPhoto === null || saving) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    preview.panel.querySelectorAll('.is-drop-target').forEach(node => node.classList.remove('is-drop-target'));
    item.classList.add('is-drop-target');
  });
  dialog.addEventListener('drop', event => {
    const item = event.target.closest('[data-preview-photo-item]');
    if (!item || draggedPhoto === null || saving) return;
    event.preventDefault(); const from = draggedPhoto, to = Number(item.dataset.previewPhotoItem);
    clearPhotoDrag(); movePhoto(from,to);
  });
  dialog.addEventListener('dragend', clearPhotoDrag);
  dialog.addEventListener('pointerdown', event => {
    const handle = event.target.closest('[data-photo-drag], [data-preview-photo]');
    if (!handle || !preview || saving || (event.button !== undefined && event.button !== 0)) return;
    event.preventDefault();
    const from = Number(handle.dataset.photoDrag ?? handle.dataset.previewPhoto);
    pointerPhoto = {id:event.pointerId, from, to:from, x:event.clientX, y:event.clientY, moved:false};
    handle.setPointerCapture?.(event.pointerId);
    if (handle.hasAttribute('data-photo-drag')) handle.closest('[data-preview-photo-item]').classList.add('is-dragging');
  });
  dialog.addEventListener('pointermove', event => {
    if (!pointerPhoto || pointerPhoto.id !== event.pointerId || saving) return;
    if (!pointerPhoto.moved && Math.hypot(event.clientX - pointerPhoto.x, event.clientY - pointerPhoto.y) < 6) return;
    pointerPhoto.moved = true;
    preview.panel.querySelector(`[data-preview-photo-item="${pointerPhoto.from}"]`)?.classList.add('is-dragging');
    event.preventDefault();
    const item = document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-preview-photo-item]');
    if (!item || !preview.panel.contains(item)) return;
    pointerPhoto.to = Number(item.dataset.previewPhotoItem);
    preview.panel.querySelectorAll('.is-drop-target').forEach(node => node.classList.remove('is-drop-target'));
    item.classList.add('is-drop-target');
  });
  dialog.addEventListener('pointerup', event => {
    if (!pointerPhoto || pointerPhoto.id !== event.pointerId) return;
    const {from,to,moved} = pointerPhoto; clearPhotoDrag();
    if (moved) { suppressPhotoClick = true; setTimeout(() => { suppressPhotoClick = false; }, 0); movePhoto(from,to); }
  });
  dialog.addEventListener('pointercancel', clearPhotoDrag);
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
    if (saving || event.target.closest('.arounus-chat')) return;
    const form = event.target;
    if (form.id === 'marketProfileForm') {
      const button=form.querySelector('[type=submit]');button.disabled=true;
      try {
        const result=await request('/marketing/landlords/me',{method:'PUT',body:new FormData(form)});
        profile=result.profile;
        sessionStorage.setItem('marketProfile',JSON.stringify(profile));
        document.dispatchEvent(new Event('market-session-changed'));
        renderProfile();status('Profile saved.');
      } catch(error) {status(error.message,true);} finally {if(button.isConnected)button.disabled=false;}
      return;
    }
    if (form.id === 'sellListingForm' || form.id === 'editListingForm') {
      try { showPreview(form); } catch (error) { status(error.message, true); }
      return;
    }

  });
  const params = new URLSearchParams(location.search);
  if (params.get('messages') === '1') {
    window.addEventListener('load', () => open(true), {once:true});
  } else if (params.has('sell') || params.has('create') || params.get('role') === 'advertiser' || location.hash === '#sell') {
    window.addEventListener('load', () => open(), {once:true});
  }
})();
