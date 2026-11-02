(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const normalized = value => String(value || '').trim().toLocaleLowerCase();
  const safeUrl = value => { try { if (!String(value || '').trim()) return ''; const url = new URL(value, location.origin); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
  const categories = {rooms:'Rooms', transport:'Transport', items:'Items for sale', services:'Other services'};
  const classify = ad => /transport|ride|shuttle|courier|delivery/i.test(ad.category) ? 'transport' : /sales|retail|technology|second.?hand|textbook/i.test(ad.category) ? 'items' : 'services';
  let entries = [], category = 'all', failures = 0, loading = false, openKey = '';
  try { $('campus').value = localStorage.getItem('marketCampus') || ''; } catch {}

  const params = new URLSearchParams(location.search);
  if (params.has('campus')) $('campus').value = params.get('campus');
  if (params.has('q')) $('search').value = params.get('q');
  if (params.has('max')) $('maxPrice').value = params.get('max');
  if (params.has('sort') && ['newest', 'price-low', 'price-high'].includes(params.get('sort'))) $('sortListings').value = params.get('sort');
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

  const photos = entry => (entry.image_urls?.length ? entry.image_urls : [entry.image_url]).map(safeUrl).filter(Boolean).slice(0, 3);
  const image = entry => photos(entry)[0] || '';
  const hoverTimers = new WeakMap();
  function stopPreview(card) {
    clearInterval(hoverTimers.get(card));
    hoverTimers.delete(card);
    const entry = entries.find(item => item.key === card.dataset.entryKey);
    const img = card.querySelector('.campus-card-media img');
    if (img && entry && image(entry)) img.src = window.arounusThumb?.(image(entry), 560) || image(entry);
  }
  const roomPrice = entry => entry.monthly_rent !== null && entry.monthly_rent !== undefined && Number.isFinite(Number(entry.monthly_rent)) ? `R${Number(entry.monthly_rent).toLocaleString('en-ZA')} / month` : 'Price on request';
  const priceValue = entry => entry.kind === 'rooms' ? entry.monthly_rent : entry.price;
  const offerPrice = entry => entry.kind === 'rooms' ? roomPrice(entry) : entry.price !== null && entry.price !== undefined ? `R${Number(entry.price).toLocaleString('en-ZA')}` : 'Ask for price';
  const sponsored = entry => Boolean(entry.is_featured);
  const isDemo = entry => /^DEMO:/i.test(String(entry.title || entry.headline || '').trim()) || normalized(entry.campus) === 'demo campus';
  const sellerName = entry => String(entry.business_name || entry.landlord?.name || entry.provider_name || entry.seller_name || '').trim();
  const isVerified = entry => Boolean(entry.is_verified || entry.landlord?.verified || entry.provider_verified);
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
  let saved = new Set();
  try { saved = new Set(JSON.parse(localStorage.getItem(SAVED_KEY) || '[]')); } catch { saved = new Set(); }
  const persistSaved = () => { try { localStorage.setItem(SAVED_KEY, JSON.stringify([...saved])); } catch {} };

  function syncUrl() {
    const next = new URLSearchParams(location.search);
    const set = (key, value) => { if (value) next.set(key, value); else next.delete(key); };
    set('campus', $('campus').value.trim());
    set('q', $('search').value.trim());
    set('max', $('maxPrice').value);
    set('sort', $('sortListings').value === 'newest' ? '' : $('sortListings').value);
    set('category', category === 'all' ? '' : category);
    set('listing', openKey);
    const query = next.toString();
    try { history.replaceState(null, '', location.pathname + (query ? '?' + query : '') + location.hash); } catch {}
  }

  function render() {
    $('campusListings').querySelectorAll('.campus-card').forEach(stopPreview);
    const campus = normalized($('campus').value), search = normalized($('search').value);
    const maximum = $('maxPrice').value === '' ? null : Number($('maxPrice').value);
    const filterCount = Number(Boolean(campus)) + Number(Boolean(search)) + Number(maximum !== null) + Number(category !== 'all') + Number($('sortListings').value !== 'newest');
    $('marketFilterCount').hidden = filterCount === 0;
    $('marketFilterCount').textContent = String(filterCount);
    searchToggle.setAttribute('aria-label', filterCount ? `Search listings, ${filterCount} active filter${filterCount === 1 ? '' : 's'}` : 'Search listings');
    const filtered = entries.filter(entry => (!campus || normalized([entry.campus, entry.area].filter(Boolean).join(' ')).includes(campus)) && (category === 'all' || entry.kind === category) && (!search || normalized([entry.title, entry.headline, entry.description, entry.area, entry.business_name].join(' ')).includes(search)) && (maximum === null || (priceValue(entry) !== null && priceValue(entry) !== undefined && Number(priceValue(entry)) <= maximum)));
    const sort = $('sortListings').value;
    if (sort !== 'newest') filtered.sort((a, b) => {
      if (isDemo(a) !== isDemo(b)) return isDemo(a) ? 1 : -1;
      const left = priceValue(a), right = priceValue(b);
      if (left == null) return right == null ? 0 : 1;
      if (right == null) return -1;
      return sort === 'price-low' ? Number(left) - Number(right) : Number(right) - Number(left);
    });
    else filtered.sort((a, b) => Number(isDemo(a)) - Number(isDemo(b)) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
    // Examples help an empty market, but should not crowd out real offers.
    if (filtered.some(entry => !isDemo(entry))) {
      let demosShown = 0;
      for (let index = 0; index < filtered.length;) {
        if (isDemo(filtered[index]) && ++demosShown > MAX_DEMOS_WITH_LIVE) filtered.splice(index, 1);
        else index++;
      }
    }
    $('resultsTitle').textContent = $('campus').value.trim() ? `Around ${$('campus').value.trim()}` : 'Around you';
    const demoCount = filtered.filter(isDemo).length;
    const liveCount = filtered.length - demoCount;
    $('marketStatus').textContent = loading ? 'Loading local listings…'
      : failures === 2 ? 'Listings could not be loaded. Please try again.'
      : `${liveCount} live listing${liveCount === 1 ? '' : 's'}${campus ? ' near your selected location' : ' across all locations'}${demoCount ? ` · ${demoCount} example${demoCount === 1 ? '' : 's'} clearly marked` : ''}${failures ? ' · Some listings could not be loaded. Retry to see everything.' : ''}`;
    $('retryListings').hidden = !failures;
    $('campusListings').setAttribute('aria-busy', String(loading));
    const demoNotice = demoCount && !liveCount && !loading
      ? `<p class="demo-notice">No live listings here yet. The cards below are clearly marked examples of what people post on Arounus — nothing here is a real offer.</p>`
      : demoCount && liveCount
        ? `<p class="demo-notice demo-notice--soft">Live listings are shown first. The ${demoCount} card${demoCount === 1 ? '' : 's'} marked “Example only” are samples, not real offers.</p>`
        : '';
    $('campusListings').innerHTML = demoNotice + (filtered.map(entry => {
      const title = entry.title || entry.headline, src = image(entry), seller = sellerName(entry), posted = postedLabel(entry), demo = isDemo(entry);
      const meta = [entry.campus || 'Location not specified', entry.area, posted].filter(Boolean).join(' · ');
      const savedNow = saved.has(entry.key);
      return `<article class="campus-card" data-demo="${demo}" data-market-kind="${entry.kind === 'rooms' ? 'rooms' : 'adverts'}" data-market-id="${entry.id}" data-market-views="${entry.views || 0}" data-market-rating="${entry.rating || ''}" data-market-rating-count="${entry.rating_count || 0}" data-view-on-open="true" data-entry-key="${esc(entry.key)}"><button type="button" class="campus-card-media" data-offer="${esc(entry.key)}" aria-label="View ${esc(title)} and its photos">${src ? `<img src="${esc(window.arounusThumb?.(src, 560) || src)}" alt="${esc(title)}" loading="lazy">` : `<span>${categories[entry.kind]}</span>`}${photos(entry).length > 1 ? `<small class="photo-count">${photos(entry).length} photos</small>` : ''}</button><div class="campus-card-body"><span class="card-kind">${categories[entry.kind]}${sponsored(entry) ? ' · Sponsored' : ''}${demo ? ' · Example only' : ''}</span><h3>${esc(title)}</h3><p class="card-meta">${esc(meta)}</p><p class="card-price">${esc(offerPrice(entry))}</p>${seller ? `<p class="card-provider">${esc(seller)}${isVerified(entry) ? ' <span class="verified-badge" title="Verified provider">✓ Verified</span>' : ''}</p>` : ''}<div class="card-tools"><button type="button" class="card-tool" data-save="${esc(entry.key)}" aria-pressed="${savedNow}" aria-label="${savedNow ? 'Remove from saved: ' : 'Save '}${esc(title)}">${savedNow ? 'Saved' : 'Save'}</button><button type="button" class="card-tool" data-share="${esc(entry.key)}" aria-label="Share ${esc(title)}">Share</button></div><button type="button" class="card-action" data-offer="${esc(entry.key)}">View ${entry.kind === 'rooms' ? 'room' : 'listing'} →</button></div></article>`;
    }).join('') || (loading || failures === 2 ? '' : '<div class="market-empty"><h3>No listings here yet</h3><p>Try another location or category, or be the first to list something.</p><button type="button" data-open-sell>Sell or list near you →</button></div>'));
    $('campusListings').querySelectorAll('img').forEach(img => img.addEventListener('error', () => { img.replaceWith(document.createTextNode('Photo unavailable')); }));
    syncUrl();
  }

  function openOffer(entry) {
    if (!entry) return;
    const gallery = photos(entry), url = safeUrl(entry.website_url), providerId = entry.kind === 'rooms' ? entry.landlord?.id : entry.provider_id;
    const availability = entry.service_availability || {};
    const availabilityHtml = entry.kind === 'services' && Object.keys(availability).length ? `<section class="service-availability"><h3>Service availability</h3>${availability.opening_hours ? `<p>Opening hours: ${esc(availability.opening_hours)}</p>` : ''}${availability.available_dates?.length ? `<p>Available dates: ${availability.available_dates.map(esc).join(', ')}</p>` : ''}${availability.available_times?.length ? `<p>Available times: ${availability.available_times.map(esc).join(', ')}</p>` : ''}${availability.closed_dates?.length ? `<p>Closed dates: ${availability.closed_dates.map(esc).join(', ')}</p>` : ''}${availability.booked_until ? `<p>Fully booked until: ${esc(availability.booked_until)}</p>` : ''}${availability.consultations ? `<p>Consultations: ${availability.consultation_minutes ? `${esc(availability.consultation_minutes)} minutes` : 'Available'}${availability.consultation_mode ? ` · ${esc(availability.consultation_mode)}` : ''}. Contact the provider to arrange a time.</p>` : ''}</section>` : '';
    const seller = sellerName(entry), posted = postedLabel(entry);
    $('offerDetails').innerHTML = `<span class="eyebrow">${categories[entry.kind]}${sponsored(entry) ? ' · Sponsored' : ''}${isDemo(entry) ? ' · Example only' : ''}</span><h2 id="offerTitle">${esc(entry.title || entry.headline)}</h2>${gallery.length ? `<div class="offer-gallery"><img class="offer-gallery-main" src="${esc(gallery[0])}" alt="Photo 1 of ${gallery.length}: ${esc(entry.title || entry.headline)}"><div class="offer-gallery-controls">${gallery.length > 1 ? `<button type="button" data-gallery-step="-1" aria-label="Previous photo">‹</button><span data-gallery-count>1 of ${gallery.length}</span><button type="button" data-gallery-step="1" aria-label="Next photo">›</button>` : ''}</div><div class="offer-gallery-thumbs">${gallery.map((src, index) => `<button type="button" data-gallery-index="${index}" aria-label="Show photo ${index + 1}" aria-pressed="${index === 0}"><img src="${esc(window.arounusThumb?.(src, 160) || src)}" alt=""></button>`).join('')}</div></div>` : ''}${entry.video_url ? `<video controls preload="none" data-free-video="${esc(safeUrl(entry.video_url))}" data-video-kind="advert" data-video-id="${entry.id}" data-premium-available="${Boolean(entry.premium_available)}" style="width:100%;max-height:320px"></video>` : ''}<p>${esc(entry.campus || 'Location not specified')}${entry.area ? ' · ' + esc(entry.area) : ''}${posted ? ' · ' + esc(posted) : ''}</p><strong>${esc(offerPrice(entry))}</strong>${seller ? `<p>Listed by ${esc(seller)}${isVerified(entry) ? ' · ✓ Verified' : ''}</p>` : ''}${entry.service_detail ? `<p>Activity or service: ${esc(entry.service_detail)}</p>` : ''}<p>${esc(entry.description)}</p>${entry.kind === 'rooms' && entry.booked_until ? `<p>Fully booked until: ${esc(entry.booked_until)}</p>` : ''}${entry.stock_quantity != null ? `<p>${entry.stock_quantity === 0 ? 'Out of stock' : `Stock available: ${esc(entry.stock_quantity)}`}</p>` : ''}${availabilityHtml}<p>Contact: ${esc(entry.contact || 'Ask the provider for contact details.')}</p>${safeUrl(entry.directions_url) ? `<p><a href="${esc(entry.directions_url)}" target="_blank" rel="noopener noreferrer">Directions ↗</a></p>` : ''}${url ? `<p><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Visit seller website ↗</a></p>` : ''}${providerId ? `<p><button type="button" data-contact-provider="${Number(providerId)}" data-provider-name="${esc(entry.business_name || entry.landlord?.name || 'provider')}">Message provider</button></p>` : ''}<p><a href="${listingUrl(entry)}">Open and share this listing</a></p><p class="offer-safety">Never pay a deposit before you have seen the room or item. Read the <a href="/trust#safety">safety guidance</a>.</p>`;
    $('offerDetails').dataset.gallery = JSON.stringify(gallery);
    $('offerDetails').dataset.galleryIndex = '0';
    openKey = entry.key;
    syncUrl();
    $('offerDialog').showModal();
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
      ...(results[0].status === 'fulfilled' ? results[0].value.filter(entry => entry.is_available).map(entry => ({...entry, kind:'rooms', key:`room-${entry.id}`})) : []),
      ...(results[1].status === 'fulfilled' ? results[1].value.map(entry => ({...entry, kind:classify(entry), key:`offer-${entry.id}`})) : [])
    ];
    const campuses = [...new Set(entries.flatMap(entry => [entry.campus?.trim(), entry.area?.trim()]).filter(Boolean))].sort();
    $('campusOptions').replaceChildren(...campuses.map(campus => { const option = document.createElement('option'); option.value = campus; return option; }));
    loading = false; render();
    if (deepLinkKey) {
      const target = entries.find(entry => entry.key === deepLinkKey);
      if (target) openOffer(target);
    }
  }

  $('campusSearch').addEventListener('submit', event => { event.preventDefault(); clearTimeout(searchTimer); try { localStorage.setItem('marketCampus', $('campus').value.trim()); } catch {} render(); closeSearch(); });
  let searchTimer;
  $('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(render, 180); });
  $('maxPrice').addEventListener('input', render);
  $('sortListings').addEventListener('change', render);
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
      img.src = window.arounusThumb?.(gallery[index], 560) || gallery[index];
    }, 1700));
  });
  $('campusListings').addEventListener('pointerout', event => {
    const card = event.target.closest('.campus-card');
    if (card && !card.contains(event.relatedTarget)) stopPreview(card);
  });
  $('campusListings').addEventListener('click', event => {
    const saveButton = event.target.closest('[data-save]');
    if (saveButton) {
      event.preventDefault();
      const key = saveButton.dataset.save;
      if (saved.has(key)) saved.delete(key); else saved.add(key);
      persistSaved();
      const on = saved.has(key);
      saveButton.setAttribute('aria-pressed', String(on));
      saveButton.textContent = on ? 'Saved' : 'Save';
      saveButton.setAttribute('aria-label', `${on ? 'Remove from saved: ' : 'Save '}${saveButton.closest('.campus-card')?.querySelector('h3')?.textContent || 'listing'}`);
      return;
    }
    const shareButton = event.target.closest('[data-share]');
    if (shareButton) {
      event.preventDefault();
      const entry = entries.find(item => item.key === shareButton.dataset.share);
      if (!entry) return;
      const shareUrl = `${location.origin}${listingUrl(entry)}`;
      const shareData = {title: entry.title || entry.headline, text: `${entry.title || entry.headline} on Arounus`, url: shareUrl};
      const done = () => { const original = shareButton.textContent; shareButton.textContent = 'Link copied'; setTimeout(() => { shareButton.textContent = original; }, 1800); };
      if (navigator.share) navigator.share(shareData).catch(() => {});
      else if (navigator.clipboard?.writeText) navigator.clipboard.writeText(shareUrl).then(done).catch(() => {});
      else { window.prompt('Copy this link', shareUrl); }
      return;
    }
    if (event.target.closest('.market-stars button')) return;
    const card = event.target.closest('.campus-card');
    if (!card) return;
    openOffer(entries.find(item => item.key === card.dataset.entryKey));
  });
  $('offerDetails').addEventListener('click', event => {
    const selected = event.target.closest('.offer-gallery-thumbs [data-gallery-index]'), step = event.target.closest('.offer-gallery-controls [data-gallery-step]');
    if (!selected && !step) return;
    const gallery = JSON.parse($('offerDetails').dataset.gallery || '[]');
    if (!gallery.length) return;
    const index = selected ? Number(selected.dataset.galleryIndex) : (Number($('offerDetails').dataset.galleryIndex || 0) + Number(step.dataset.galleryStep) + gallery.length) % gallery.length;
    $('offerDetails').dataset.galleryIndex = String(index);
    const main = $('offerDetails').querySelector('.offer-gallery-main');
    main.src = gallery[index];
    main.alt = `Photo ${index + 1} of ${gallery.length}`;
    const count = $('offerDetails').querySelector('[data-gallery-count]');
    if (count) count.textContent = `${index + 1} of ${gallery.length}`;
    $('offerDetails').querySelectorAll('[data-gallery-index]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.galleryIndex) === index)));
  });
  $('closeOffer').addEventListener('click', () => $('offerDialog').close());
  $('offerDialog').addEventListener('close', () => { openKey = ''; syncUrl(); });
  document.addEventListener('market-listing-changed', load);
  load();
})();
