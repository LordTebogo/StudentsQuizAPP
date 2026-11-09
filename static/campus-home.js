(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const normalized = value => String(value || '').trim().toLocaleLowerCase();
  const safeUrl = value => { try { if (!String(value || '').trim()) return ''; const url = new URL(value, location.origin); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
  const categories = {rooms:'Rooms', transport:'Transport', items:'Items for sale', services:'Other services'};
  const classify = ad => /transport|ride|shuttle|courier|delivery/i.test(ad.category) ? 'transport' : /sales|retail|technology|second.?hand|textbook/i.test(ad.category) ? 'items' : 'services';
  let entries = [], category = 'all', failures = 0, loading = false, openKey = '';
  let visitorLocation = null, locationRequest = null;
  const coordinates = entry => {
    if (entry.latitude === null || entry.latitude === undefined || entry.longitude === null || entry.longitude === undefined || entry.latitude === '' || entry.longitude === '') return null;
    const latitude = Number(entry.latitude), longitude = Number(entry.longitude);
    return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? {latitude, longitude} : null;
  };
  const roomDistances = new Map();
  const distanceMeters = entry => entry.kind === 'rooms' && entry.landlord?.provider_type === 'agent' ? (roomDistances.has(entry.id) ? roomDistances.get(entry.id) * 1000 : null) : (() => {
    const target = coordinates(entry);
    if (!visitorLocation || !target) return null;
    const rad = value => value * Math.PI / 180;
    const dLat = rad(target.latitude - visitorLocation.latitude), dLon = rad(target.longitude - visitorLocation.longitude);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(visitorLocation.latitude)) * Math.cos(rad(target.latitude)) * Math.sin(dLon / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  })();
  const distanceLabel = entry => {
    const meters = distanceMeters(entry);
    return meters === null ? '' : `About ${meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`} away · straight-line estimate`;
  };
  async function loadRoomDistances() {
    if (!visitorLocation) return;
    const roomIds = entries.filter(entry => entry.kind === 'rooms' && entry.landlord?.provider_type === 'agent' && !isDemo(entry)).map(entry => entry.id);
    if (!roomIds.length) return;
    const response = await fetch('/marketing/room-distances', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({latitude:visitorLocation.latitude, longitude:visitorLocation.longitude, room_ids:roomIds})});
    if (!response.ok) return;
    const data = await response.json();
    roomDistances.clear();
    Object.entries(data.distances_km || {}).forEach(([id, km]) => roomDistances.set(Number(id), Number(km)));
    render();
    const entry = entries.find(item => item.key === openKey);
    const label = $('offerDetails')?.querySelector('.offer-distance');
    if (entry && label) label.textContent = distanceLabel(entry) || 'Distance unavailable for this room.';
  }
  function getVisitorLocation() {
    if (visitorLocation) return Promise.resolve(visitorLocation);
    if (locationRequest) return locationRequest;
    locationRequest = new Promise((resolve, reject) => {
      if (!navigator.geolocation?.getCurrentPosition) { reject(new Error('Location is unavailable in this browser.')); return; }
      navigator.geolocation.getCurrentPosition(position => {
        const latitude = Number(position.coords?.latitude), longitude = Number(position.coords?.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) { reject(new Error('Your location could not be found.')); return; }
        visitorLocation = {latitude, longitude};resolve(visitorLocation);
      }, () => reject(new Error('Allow location access to sort by distance.')), {enableHighAccuracy:true, timeout:15000, maximumAge:60000});
    }).finally(() => { locationRequest = null; });
    return locationRequest;
  }
  function updateNearestStatus(message = '') {
    const active = $('sortListings').value === 'nearest';
    $('nearestStatus').hidden = !active;
    $('nearestStatus').textContent = active ? (message || (visitorLocation ? 'Sorted by straight-line distance from your location. Listings without a map pin appear last.' : 'Use your location to sort nearby listings.')) : '';
    $('retryNearestLocation').hidden = !active || Boolean(visitorLocation);
  }
  let closingFromHistory = false;
  const bookmarkIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4Z"/></svg>';
  const pageTitle = document.title;
  try { $('campus').value = localStorage.getItem('marketCampus') || ''; } catch {}

  const params = new URLSearchParams(location.search);
  let savedOnly = params.get('saved') === '1';
  if (params.has('campus')) $('campus').value = params.get('campus');
  if (params.has('q')) $('search').value = params.get('q');
  if (params.has('max')) $('maxPrice').value = params.get('max');
  if (params.has('sort') && ['newest', 'nearest', 'price-low', 'price-high'].includes(params.get('sort'))) $('sortListings').value = params.get('sort');
  if (params.has('category') && ['rooms', 'transport', 'items', 'services'].includes(params.get('category'))) {
    category = params.get('category');
    document.querySelectorAll('[data-category]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.category === category)));
  }
  const deepLinkKey = params.get('listing') || '';
  const searchDialog = $('marketSearchDialog');
  const searchToggle = $('openMarketSearch');
  searchToggle.addEventListener('click', () => {
    searchDialog.showModal();
    searchToggle.setAttribute('aria-expanded', 'true');
    $('search').focus();
  });
  const closeSearch = () => {
    if (searchDialog.open) searchDialog.close();
    searchToggle.setAttribute('aria-expanded', 'false');
  };
  $('closeMarketSearch').addEventListener('click', closeSearch);
  searchDialog.addEventListener('close', () => searchToggle.setAttribute('aria-expanded', 'false'));
  searchDialog.addEventListener('cancel', () => searchToggle.setAttribute('aria-expanded', 'false'));
  const listingUrl = entry => `/listing/${entry.kind === 'rooms' ? 'room' : 'offer'}/${entry.id}`;
  const shareDialog = $('listingShareDialog');
  let shareRequest = 0;
  function openShare(entry) {
    shareRequest++;
    const title = entry.title || entry.headline;
    const url = `${location.origin}${listingUrl(entry)}`;
    $('listingShareName').textContent = title;
    $('listingShareUrl').value = url;
    $('listingShareWhatsApp').href = `https://wa.me/?text=${encodeURIComponent(`${title} on Arounus\n${url}`)}`;
    $('listingShareStatus').textContent = '';
    $('copyListingLink').disabled = false;
    if (!shareDialog.open) shareDialog.showModal();
  }
  $('closeListingShare').addEventListener('click', () => shareDialog.close());
  shareDialog.addEventListener('close', () => { shareRequest++; $('copyListingLink').disabled = false; });
  $('copyListingLink').addEventListener('click', async () => {
    const request = ++shareRequest;
    const link = $('listingShareUrl');
    const button = $('copyListingLink');
    let timer;
    button.disabled = true;
    $('listingShareStatus').textContent = 'Copying link…';
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await Promise.race([
        navigator.clipboard.writeText(link.value),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Clipboard timed out')), 2000); })
      ]);
      if (request === shareRequest && shareDialog.open) $('listingShareStatus').textContent = 'Link copied. Paste it into a message or post.';
    } catch (_) {
      if (request === shareRequest && shareDialog.open) {
        link.focus();
        link.select();
        $('listingShareStatus').textContent = 'Link selected. Press Ctrl+C or ⌘C, or touch and hold to copy.';
      }
    } finally {
      clearTimeout(timer);
      if (request === shareRequest) button.disabled = false;
    }
  });

  const photos = entry => (entry.image_urls?.length ? entry.image_urls : [entry.image_url]).map(safeUrl).filter(Boolean).slice(0, 3);
  const image = entry => photos(entry)[0] || '';
  const hoverTimers = new WeakMap();
  function stopPreview(card) {
    clearInterval(hoverTimers.get(card));
    hoverTimers.delete(card);
    const entry = entries.find(item => item.key === card.dataset.entryKey);
    const img = card.querySelector('.campus-card-media img');
    if (img && entry && image(entry)) img.src = window.arounusThumb?.(image(entry), 360) || image(entry);
  }
  const roomPrice = entry => entry.monthly_rent !== null && entry.monthly_rent !== undefined && Number.isFinite(Number(entry.monthly_rent)) ? `R${Number(entry.monthly_rent).toLocaleString('en-ZA')} / month` : 'Price on request';
  const priceValue = entry => entry.kind === 'rooms' ? entry.monthly_rent : entry.price;
  const offerPrice = entry => entry.kind === 'rooms' ? roomPrice(entry) : entry.price !== null && entry.price !== undefined ? `R${Number(entry.price).toLocaleString('en-ZA')}` : 'Ask for price';
  const sponsored = entry => Boolean(entry.is_featured);
  const isDemo = entry => /^DEMO:/i.test(String(entry.title || entry.headline || '').trim()) || normalized(entry.campus) === 'demo campus';
  const isFilledRoom = entry => entry.kind === 'rooms' && entry.is_available === false;
  const roomPriority = entry => entry.kind === 'rooms' ? (isFilledRoom(entry) ? 2 : 0) : 1;
  const roomAvailability = entry => entry.kind === 'rooms' ? `<span class="room-availability room-availability--${isFilledRoom(entry) ? 'filled' : 'available'}" title="Availability is set by the provider. Confirm directly before making arrangements."><span aria-hidden="true">●</span> ${isFilledRoom(entry) ? 'Filled' : 'Available'}</span>` : '';
  const sellerName = entry => String(entry.business_name || entry.landlord?.name || entry.provider_name || entry.seller_name || '').trim();
  const postedLabel = entry => {
    const raw = entry.created_at || entry.posted_at || entry.updated_at;
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return '';
    const days = Math.round((Date.now() - date.getTime()) / 86400000);
    if (days <= 0) return 'Posted today';
    if (days === 1) return 'Posted yesterday';
    if (days < 14) return `Posted ${days} days ago`;
    return `Posted ${date.toLocaleDateString('en-ZA', {day: 'numeric', month: 'short'})}`;
  };
  const MAX_DEMOS_WITH_LIVE = 6;
  const SAVED_KEY = 'arounusSavedListings';
  function readSaved() {
    try {
      const stored = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
      return new Set(Array.isArray(stored) ? stored.filter(key => typeof key === 'string' && /^(room|offer)-\d+$/.test(key)) : []);
    } catch { return new Set(); }
  }
  let saved = readSaved();
  const persistSaved = () => { try { localStorage.setItem(SAVED_KEY, JSON.stringify([...saved])); } catch {} };
  function syncSavedButton() {
    const button = $('showSavedListings');
    button.setAttribute('aria-pressed', String(savedOnly));
    button.setAttribute('aria-label', savedOnly ? 'Back to all listings' : `Saved listings, ${saved.size} saved`);
    button.querySelector('[data-saved-label]').textContent = savedOnly ? 'All listings' : 'Saved';
    const count = button.querySelector('[data-saved-count]');
    count.textContent = String(saved.size);
    count.hidden = savedOnly;
    button.querySelector('svg').innerHTML = savedOnly ? '<path d="m12 5-7 7 7 7M5 12h15"/>' : '<path d="M6 3h12v18l-6-4-6 4Z"/>';
  }
  function showSaved(value) {
    savedOnly = value;
    closeSearch();
    render();
  }
  $('showSavedListings').addEventListener('click', () => showSaved(!savedOnly));
  window.addEventListener('storage', event => {
    if (event.key !== SAVED_KEY && event.key !== null) return;
    saved = readSaved();
    render();
  });

  function syncUrl(mode = 'replace') {
    const next = new URLSearchParams(location.search);
    const set = (key, value) => { if (value) next.set(key, value); else next.delete(key); };
    set('campus', $('campus').value.trim());
    set('q', $('search').value.trim());
    set('max', $('maxPrice').value);
    set('sort', $('sortListings').value === 'newest' ? '' : $('sortListings').value);
    set('category', category === 'all' ? '' : category);
    set('listing', openKey);
    set('saved', savedOnly ? '1' : '');
    const query = next.toString();
    try { history[mode === 'push' ? 'pushState' : 'replaceState'](mode === 'push' ? {arounusListing: true} : history.state, '', location.pathname + (query ? '?' + query : '') + location.hash); } catch {}
  }

  function render() {
    syncSavedButton();
    searchToggle.hidden = savedOnly;
    $('campusListings').querySelectorAll('.campus-card').forEach(stopPreview);
    const campus = normalized($('campus').value), search = normalized($('search').value);
    const maximum = $('maxPrice').value === '' ? null : Number($('maxPrice').value);
    const filterCount = Number(Boolean(campus)) + Number(Boolean(search)) + Number(maximum !== null) + Number(category !== 'all') + Number($('sortListings').value !== 'newest');
    $('marketFilterCount').hidden = filterCount === 0;
    $('marketFilterCount').textContent = String(filterCount);
    searchToggle.setAttribute('aria-label', filterCount ? `Search listings, ${filterCount} active filter${filterCount === 1 ? '' : 's'}` : 'Search listings');
    const filtered = entries.filter(entry => savedOnly ? saved.has(entry.key) : (!campus || normalized([entry.campus, entry.area].filter(Boolean).join(' ')).includes(campus)) && (category === 'all' || entry.kind === category) && (!search || normalized([entry.title, entry.headline, entry.description, entry.area, entry.business_name].join(' ')).includes(search)) && (maximum === null || (priceValue(entry) !== null && priceValue(entry) !== undefined && Number(priceValue(entry)) <= maximum)));
    const sort = $('sortListings').value;
    updateNearestStatus();
    if (sort === 'nearest' && visitorLocation) filtered.sort((a, b) => {
      if (isDemo(a) !== isDemo(b)) return isDemo(a) ? 1 : -1;
      if (isFilledRoom(a) !== isFilledRoom(b)) return isFilledRoom(a) ? 1 : -1;
      const left = distanceMeters(a), right = distanceMeters(b);
      if (left === null) return right === null ? 0 : 1;
      if (right === null) return -1;
      return left - right || String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
    else if (sort === 'price-low' || sort === 'price-high') filtered.sort((a, b) => {
      if (isDemo(a) !== isDemo(b)) return isDemo(a) ? 1 : -1;
      if (isFilledRoom(a) !== isFilledRoom(b)) return isFilledRoom(a) ? 1 : -1;
      const left = priceValue(a), right = priceValue(b);
      if (left == null) return right == null ? 0 : 1;
      if (right == null) return -1;
      return sort === 'price-low' ? Number(left) - Number(right) : Number(right) - Number(left);
    });
    else filtered.sort((a, b) => Number(isDemo(a)) - Number(isDemo(b)) || roomPriority(a) - roomPriority(b) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
    // Examples help an empty market, but should not crowd out real offers.
    if (!savedOnly && filtered.some(entry => !isDemo(entry))) {
      let demosShown = 0;
      for (let index = 0; index < filtered.length;) {
        if (isDemo(filtered[index]) && ++demosShown > MAX_DEMOS_WITH_LIVE) filtered.splice(index, 1);
        else index++;
      }
    }
    $('resultsTitle').textContent = savedOnly ? 'Saved listings' : $('campus').value.trim() ? `Around ${$('campus').value.trim()}` : 'Around you';
    const demoCount = filtered.filter(isDemo).length;
    const liveCount = filtered.length - demoCount;
    const realRooms = filtered.filter(entry => entry.kind === 'rooms' && !isDemo(entry));
    const availableRooms = realRooms.filter(entry => !isFilledRoom(entry)).length;
    const roomSummary = realRooms.length ? ` · ${availableRooms} available room${availableRooms === 1 ? '' : 's'} · ${realRooms.length - availableRooms} filled` : '';
    $('marketStatus').textContent = loading ? (savedOnly ? 'Loading saved listings…' : 'Loading local listings…')
      : failures === 2 ? 'Listings could not be loaded. Please try again.'
      : savedOnly ? `${filtered.length} saved listing${filtered.length === 1 ? '' : 's'}${roomSummary} · Saved on this browser and device.${!failures && saved.size > filtered.length ? ` ${saved.size - filtered.length} no longer available.` : ''}${failures ? ' Some listings could not be loaded. Retry to see everything.' : ''}`
      : `${liveCount} published listing${liveCount === 1 ? '' : 's'}${campus ? ' near your selected location' : ' across all locations'}${roomSummary}${demoCount ? ` · ${demoCount} example${demoCount === 1 ? '' : 's'} clearly marked` : ''}${failures ? ' · Some listings could not be loaded. Retry to see everything.' : ''}`;
    $('marketStatus').classList.toggle('sr-only', !failures);
    $('retryListings').hidden = !failures;
    $('campusListings').setAttribute('aria-busy', String(loading));
    const demoNotice = savedOnly && demoCount ? '<p class="demo-notice">Cards marked “Example only” are samples, not real offers.</p>' : demoCount && !liveCount && !loading
      ? `<p class="demo-notice">No live listings here yet. The cards below are clearly marked examples of what people post on Arounus — nothing here is a real offer.</p>`
      : demoCount && liveCount
        ? `<p class="demo-notice demo-notice--soft">Live listings are shown first. The ${demoCount} card${demoCount === 1 ? '' : 's'} marked “Example only” are samples, not real offers.</p>`
        : '';
    const savedEmpty = `<div class="market-empty"><h3>${saved.size && failures ? 'Saved listings could not be loaded' : saved.size ? 'Saved listings are no longer available' : 'No saved listings yet'}</h3><p>${saved.size && failures ? 'Retry loading to check your saved listings. They are still saved in this browser.' : saved.size ? 'A saved listing may have been removed or unpublished. Browse current listings to find more.' : 'Tap Save on any listing to keep it here. Your saved items stay on this browser and device.'}</p><button type="button" data-show-all-listings>Browse all listings</button></div>`;
    $('campusListings').innerHTML = demoNotice + (filtered.map(entry => {
      const title = entry.title || entry.headline, src = image(entry), demo = isDemo(entry);
      const savedNow = saved.has(entry.key);
      return `<article class="campus-card" data-demo="${demo}" data-market-kind="${entry.kind === 'rooms' ? 'rooms' : 'adverts'}" data-market-id="${entry.id}" data-market-views="${entry.views || 0}" data-market-rating="${esc(entry.rating || '')}" data-market-rating-count="${entry.rating_count || 0}" data-rating-readonly="true" data-view-on-open="true" data-entry-key="${esc(entry.key)}">
        <button type="button" class="campus-card-media" data-offer="${esc(entry.key)}" aria-label="View ${esc(title)} and its photos${entry.kind === 'rooms' ? ` — ${isFilledRoom(entry) ? 'Filled' : 'Available'}` : ''}">${src ? `<img src="${esc(window.arounusThumb?.(src, 360) || src)}" alt="${esc(title)}" loading="lazy">` : `<span>${categories[entry.kind]}</span>`}${roomAvailability(entry)}</button>
        <button type="button" class="card-save" data-save="${esc(entry.key)}" aria-pressed="${savedNow}" aria-label="${savedNow ? 'Remove from saved: ' : 'Save '}${esc(title)}">${bookmarkIcon}</button>
        <div class="campus-card-body"><span class="card-kind">${categories[entry.kind]}${sponsored(entry) ? ' · Sponsored' : ''}${demo ? ' · Example only' : ''}</span><h3><button type="button" class="card-title" data-offer="${esc(entry.key)}">${esc(title)}</button></h3><p class="card-price">${esc(offerPrice(entry))}</p></div></article>`;
    }).join('') || (loading || failures === 2 ? '' : savedOnly ? savedEmpty : '<div class="market-empty"><h3>No listings here yet</h3><p>Try another location or category, or be the first to list something.</p><button type="button" data-open-sell>Sell or list near you →</button></div>'));
    $('campusListings').querySelectorAll('img').forEach(img => img.addEventListener('error', () => { img.replaceWith(document.createTextNode('Photo unavailable')); }));
    syncUrl();
  }

  function openOffer(entry, fromHistory = false) {
    if (!entry) return;
    const gallery = photos(entry), url = safeUrl(entry.website_url), providerId = entry.kind === 'rooms' ? entry.landlord?.id : entry.provider_id;
    const availability = entry.service_availability || {};
    const availabilityHtml = entry.kind === 'services' && Object.keys(availability).length ? `<section class="service-availability"><h3>Service availability</h3>${availability.opening_hours ? `<p>Opening hours: ${esc(availability.opening_hours)}</p>` : ''}${availability.available_dates?.length ? `<p>Available dates: ${availability.available_dates.map(esc).join(', ')}</p>` : ''}${availability.available_times?.length ? `<p>Available times: ${availability.available_times.map(esc).join(', ')}</p>` : ''}${availability.closed_dates?.length ? `<p>Closed dates: ${availability.closed_dates.map(esc).join(', ')}</p>` : ''}${availability.booked_until ? `<p>Fully booked until: ${esc(availability.booked_until)}</p>` : ''}${availability.consultations ? `<p>Consultations: ${availability.consultation_minutes ? `${esc(availability.consultation_minutes)} minutes` : 'Available'}${availability.consultation_mode ? ` · ${esc(availability.consultation_mode)}` : ''}. Contact the provider to arrange a time.</p>` : ''}</section>` : '';
    const seller = sellerName(entry), posted = postedLabel(entry);
    const card = [...$('campusListings').querySelectorAll('.campus-card')].find(item => item.dataset.entryKey === entry.key);
    const rating = card?.dataset.marketRating || entry.rating || '';
    const ratingCount = card?.dataset.marketRatingCount || entry.rating_count || 0;
    $('offerDetails').innerHTML = `<article class="offer-detail" data-demo="${isDemo(entry)}" data-market-kind="${entry.kind === 'rooms' ? 'rooms' : 'adverts'}" data-market-id="${entry.id}" data-market-rating="${esc(rating)}" data-market-rating-count="${esc(ratingCount)}" data-view-on-open="true"><div class="offer-detail-body"><span class="eyebrow">${categories[entry.kind]}${sponsored(entry) ? ' · Sponsored' : ''}${isDemo(entry) ? ' · Example only' : ''}</span><h2 id="offerTitle">${esc(entry.title || entry.headline)}</h2>${gallery.length ? '' : roomAvailability(entry)}${isFilledRoom(entry) ? '<p>This room is filled and is not currently available. Browse the green Available listings for rooms you can enquire about.</p>' : ''}${gallery.length ? `<div class="offer-gallery"><div class="room-photo"><button type="button" class="offer-photo-open" data-image-preview aria-label="Preview photo 1 of ${gallery.length}"><img class="offer-gallery-main" src="${esc(window.ArounusPhotos?.displayUrl(gallery[0]) || gallery[0])}" alt="Photo 1 of ${gallery.length}: ${esc(entry.title || entry.headline)}"><span>Expand photo ⤢</span></button>${roomAvailability(entry)}</div><div class="offer-gallery-controls">${gallery.length > 1 ? `<button type="button" data-gallery-step="-1" aria-label="Previous photo">‹</button><span data-gallery-count>1 of ${gallery.length}</span><button type="button" data-gallery-step="1" aria-label="Next photo">›</button>` : ''}</div><div class="offer-gallery-thumbs">${gallery.map((src, index) => `<button type="button" data-gallery-index="${index}" aria-label="Show photo ${index + 1}" aria-pressed="${index === 0}"><img src="${esc(window.arounusThumb?.(src, 160) || src)}" alt=""></button>`).join('')}</div></div>` : ''}${entry.video_url ? `<video controls preload="none" data-free-video="${esc(safeUrl(entry.video_url))}" data-video-kind="advert" data-video-id="${entry.id}" data-premium-available="${Boolean(entry.premium_available)}" style="width:100%;max-height:320px"></video>` : ''}<p>${esc(entry.campus || 'Location not specified')}${entry.area ? ' · ' + esc(entry.area) : ''}${posted ? ' · ' + esc(posted) : ''}</p><p class="offer-price">${esc(offerPrice(entry))}</p><div class="offer-actions"><button type="button" data-save="${esc(entry.key)}" aria-pressed="${saved.has(entry.key)}">${saved.has(entry.key) ? 'Saved' : 'Save listing'}</button><button type="button" data-share="${esc(entry.key)}">Share</button></div>${seller ? `<p>Listed by ${esc(seller)}</p>` : ''}${entry.service_detail ? `<p>Activity or service: ${esc(entry.service_detail)}</p>` : ''}<p>${esc(entry.description)}</p>${isFilledRoom(entry) && entry.booked_until ? `<p>Fully booked until: ${esc(entry.booked_until)}</p>` : ''}${entry.stock_quantity != null ? `<p>${entry.stock_quantity === 0 ? 'Out of stock' : `Stock available: ${esc(entry.stock_quantity)}`}</p>` : ''}${availabilityHtml}${!isDemo(entry) ? `<p>${entry.kind === 'rooms' && entry.landlord?.provider_type === 'agent' ? 'Agent' : 'Provider'} contact: ${esc(entry.contact || 'No contact details supplied.')}</p><p class="market-contact-note">Use the provider’s listed contact details directly, or sign in to message them on Arounus. In-app messages are linked to your account, not anonymous. A phone, WhatsApp or website link takes contact outside Arounus. <a href="/trust#contact">How contact works</a>.</p><p class="market-verification-note">Provider identity, ownership and availability are not independently verified. ${entry.kind === 'rooms' ? 'Rooms are reviewed for publication; approval is not a property inspection.' : 'Other listings can publish automatically.'} <a href="/trust#verification">What we check</a>.</p><p><a href="/trust?listing=${entry.kind === 'rooms' ? 'room' : 'offer'}-${entry.id}#report" data-report-listing="${entry.kind === 'rooms' ? 'room' : 'offer'}-${entry.id}" data-report-title="${esc(entry.title || entry.headline)}">Report stale or suspicious listing</a></p>` : ''}${safeUrl(entry.directions_url) ? `<p><a href="${esc(entry.directions_url)}" target="_blank" rel="noopener noreferrer">Directions ↗</a></p>` : ''}${url ? `<p><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Visit seller website ↗</a></p>` : ''}${providerId && !isDemo(entry) ? `<p><button type="button" data-contact-provider="${Number(providerId)}" data-provider-name="${esc(entry.business_name || entry.landlord?.name || 'provider')}" data-provider-image="${esc(entry.landlord?.profile_image_url || entry.profile_image_url || '')}">Message provider</button></p>` : ''}<p><a href="${listingUrl(entry)}">Open and share this listing</a></p><p class="offer-safety">Never pay a deposit before you have seen the room or item. Read the <a href="/trust#safety">safety guidance</a>.</p></div></article>`;
    const distance = document.createElement('p');
    distance.className = 'offer-distance';
    distance.setAttribute('role', 'status');
    distance.setAttribute('aria-live', 'polite');
    distance.textContent = distanceLabel(entry) || 'Allow location access to see the approximate distance.';
    $('offerDetails').querySelector('.offer-price').before(distance);
    if (!visitorLocation) getVisitorLocation().then(async () => { await loadRoomDistances();
      if (openKey === entry.key && distance.isConnected) distance.textContent = distanceLabel(entry);
      if ($('sortListings').value === 'nearest') render();
    }).catch(() => {
      if (openKey === entry.key && distance.isConnected) distance.textContent = 'Distance unavailable. Allow location access to see how far away this is.';
    });
    $('offerDetails').dataset.gallery = JSON.stringify(gallery);
    $('offerDetails').dataset.galleryIndex = '0';
    const opening = !$('offerDialog').open;
    openKey = entry.key;
    syncUrl(opening && !fromHistory ? 'push' : 'replace');
    document.title = `${entry.title || entry.headline} | Arounus`;
    document.documentElement.classList.add('listing-open');
    if (opening) $('offerDialog').showModal();
    $('offerDialog').scrollTop = 0;
    document.dispatchEvent(new Event('market-listing-opened'));
  }

  async function load() {
    if (loading) return;
    loading = true; failures = 0; render();
    const results = await Promise.allSettled(['/marketing/listings', '/marketing/adverts'].map(async url => {
      const response = await fetch(url, {signal: AbortSignal.timeout(15000)});
      if (!response.ok) throw new Error('Unable to load listings');
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error('Invalid listings');
      return data;
    }));
    failures = results.filter(result => result.status === 'rejected').length;
    entries = [
      ...(results[0].status === 'fulfilled' ? results[0].value.map(entry => ({...entry, kind:'rooms', key:`room-${entry.id}`})) : []),
      ...(results[1].status === 'fulfilled' ? results[1].value.map(entry => ({...entry, kind:classify(entry), key:`offer-${entry.id}`})) : [])
    ];
    const campuses = [...new Set(entries.flatMap(entry => [entry.campus?.trim(), entry.area?.trim()]).filter(Boolean))].sort();
    $('campusOptions').replaceChildren(...campuses.map(campus => { const option = document.createElement('option'); option.value = campus; return option; }));
    loading = false; render();
    if (visitorLocation) loadRoomDistances().catch(() => {});
    if (deepLinkKey) {
      const target = entries.find(entry => entry.key === deepLinkKey);
      if (target) openOffer(target, true);
    }
  }

  $('campusSearch').addEventListener('submit', event => { event.preventDefault(); clearTimeout(searchTimer); try { localStorage.setItem('marketCampus', $('campus').value.trim()); } catch {} render(); closeSearch(); });
  let searchTimer;
  $('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(render, 180); });
  $('maxPrice').addEventListener('input', render);
  async function sortNearest() {
    updateNearestStatus('Finding your location…');
    try { await getVisitorLocation(); await loadRoomDistances(); render(); }
    catch (error) { render();updateNearestStatus(error.message); }
  }
  $('sortListings').addEventListener('change', () => { render();if ($('sortListings').value === 'nearest' && !visitorLocation)sortNearest(); });
  $('retryNearestLocation').addEventListener('click', sortNearest);
  document.querySelectorAll('[data-category]').forEach(button => button.addEventListener('click', () => { category = button.dataset.category; document.querySelectorAll('[data-category]').forEach(item => item.setAttribute('aria-pressed', String(item === button))); render(); }));
  $('clearFilters').addEventListener('click', () => { $('campus').value = ''; $('search').value = ''; $('maxPrice').value = ''; $('sortListings').value = 'newest'; try { localStorage.removeItem('marketCampus'); } catch {} document.querySelector('[data-category="all"]').click(); });
  $('retryListings').addEventListener('click', load);
  $('campusListings').addEventListener('pointerover', event => {
    const card = event.target.closest('.campus-card');
    if (!card || card.contains(event.relatedTarget) || hoverTimers.has(card) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const entry = entries.find(item => item.key === card.dataset.entryKey), gallery = entry && photos(entry);
    if (!gallery || gallery.length < 2) return;
    const img = card.querySelector('.campus-card-media img');
    let index = 0;
    hoverTimers.set(card, setInterval(() => {
      index = (index + 1) % gallery.length;
      img.src = window.arounusThumb?.(gallery[index], 360) || gallery[index];
    }, 1700));
  });
  $('campusListings').addEventListener('pointerout', event => {
    const card = event.target.closest('.campus-card');
    if (card && !card.contains(event.relatedTarget)) stopPreview(card);
  });
  function handleListingClick(event) {
    if (event.target.closest('[data-show-all-listings]')) { showSaved(false); $('showSavedListings').focus(); return; }
    const saveButton = event.target.closest('[data-save]');
    if (saveButton) {
      event.preventDefault();
      const key = saveButton.dataset.save;
      if (saved.has(key)) saved.delete(key); else saved.add(key);
      persistSaved();
      syncSavedButton();
      const on = saved.has(key);
      const entry = entries.find(item => item.key === key);
      document.querySelectorAll('[data-save]').forEach(button => {
        if (button.dataset.save !== key) return;
        button.setAttribute('aria-pressed', String(on));
        if (!button.classList.contains('card-save')) button.textContent = on ? 'Saved' : 'Save listing';
        button.setAttribute('aria-label', `${on ? 'Remove from saved: ' : 'Save '}${entry?.title || entry?.headline || 'listing'}`);
      });
      if (savedOnly) { render(); if (!$('offerDialog').open) $('showSavedListings').focus(); }
      return;
    }
    const shareButton = event.target.closest('[data-share]');
    if (shareButton) {
      event.preventDefault();
      const entry = entries.find(item => item.key === shareButton.dataset.share);
      if (!entry) return;
      openShare(entry);
      return;
    }
    if (event.target.closest('[data-report-listing], a, .market-stars button')) return;
    const card = event.target.closest('.campus-card');
    if (!card) return;
    openOffer(entries.find(item => item.key === card.dataset.entryKey));
  }
  $('campusListings').addEventListener('click', handleListingClick);
  $('offerDetails').addEventListener('click', handleListingClick);
  $('offerDetails').addEventListener('click', event => {
    const selected = event.target.closest('.offer-gallery-thumbs [data-gallery-index]'), step = event.target.closest('.offer-gallery-controls [data-gallery-step]');
    if (!selected && !step) return;
    const gallery = JSON.parse($('offerDetails').dataset.gallery || '[]');
    if (!gallery.length) return;
    const index = selected ? Number(selected.dataset.galleryIndex) : (Number($('offerDetails').dataset.galleryIndex || 0) + Number(step.dataset.galleryStep) + gallery.length) % gallery.length;
    $('offerDetails').dataset.galleryIndex = String(index);
    const main = $('offerDetails').querySelector('.offer-gallery-main');
    if (window.ArounusPhotos) ArounusPhotos.show(main, gallery[index]); else main.src = gallery[index];
    main.alt = `Photo ${index + 1} of ${gallery.length}`;
    main.closest('[data-image-preview]').setAttribute('aria-label', `Preview photo ${index + 1} of ${gallery.length}`);
    const count = $('offerDetails').querySelector('[data-gallery-count]');
    if (count) count.textContent = `${index + 1} of ${gallery.length}`;
    $('offerDetails').querySelectorAll('[data-gallery-index]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.galleryIndex) === index)));
  });
  $('closeOffer').addEventListener('click', () => $('offerDialog').close());
  $('offerDialog').addEventListener('close', () => {
    if (shareDialog.open) shareDialog.close();
    openKey = '';
    document.title = pageTitle;
    document.documentElement.classList.remove('listing-open');
    $('offerDetails').querySelectorAll('video').forEach(video => video.pause());
    if (closingFromHistory) { closingFromHistory = false; return; }
    if (history.state?.arounusListing) history.back(); else syncUrl();
  });
  window.addEventListener('popstate', () => {
    const key = new URLSearchParams(location.search).get('listing');
    const entry = entries.find(item => item.key === key);
    if (entry) openOffer(entry, true);
    else if ($('offerDialog').open) {
      closingFromHistory = true;
      $('offerDialog').close();
    }
  });
  document.addEventListener('market-rating-updated', event => {
    const update = event.detail;
    const entry = entries.find(item => String(item.id) === update.id && (item.kind === 'rooms' ? 'rooms' : 'adverts') === update.kind);
    if (entry) { entry.rating = update.rating; entry.rating_count = update.count; }
  });
  document.addEventListener('market-listing-changed', load);
  load();
})();
