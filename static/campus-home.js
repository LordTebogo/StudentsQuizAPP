(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const normalized = value => String(value || '').trim().toLocaleLowerCase();
  const safeUrl = value => { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
  const categories = {rooms:'Rooms', transport:'Transport', items:'Items for sale', services:'Other services'};
  const classify = ad => /transport|ride|shuttle|courier|delivery/i.test(ad.category) ? 'transport' : /sales|retail|technology|second.?hand|textbook/i.test(ad.category) ? 'items' : 'services';
  let entries = [], category = 'all', failures = 0, loading = false;
  try { $('campus').value = localStorage.getItem('marketCampus') || ''; } catch {}
  const params = new URLSearchParams(location.search);
  if (params.has('campus')) $('campus').value = params.get('campus');
  const photos = entry => (entry.image_urls?.length ? entry.image_urls : [entry.image_url]).map(safeUrl).filter(Boolean).slice(0, 3);
  const image = entry => photos(entry)[0] || '';
  const hoverTimers = new WeakMap();
  function stopPreview(card) {
    clearInterval(hoverTimers.get(card));
    hoverTimers.delete(card);
  }
  const roomPrice = entry => entry.monthly_rent !== null && entry.monthly_rent !== undefined && Number.isFinite(Number(entry.monthly_rent)) ? `R${Number(entry.monthly_rent).toLocaleString('en-ZA')} / month` : 'Price on request';
  const priceValue = entry => entry.kind === 'rooms' ? entry.monthly_rent : entry.price;
  const offerPrice = entry => entry.kind === 'rooms' ? roomPrice(entry) : entry.price !== null && entry.price !== undefined ? `R${Number(entry.price).toLocaleString('en-ZA')}` : 'Ask for price';
  const sponsored = entry => Boolean(entry.is_featured);
  function render() {
    $('campusListings').querySelectorAll('.campus-card').forEach(stopPreview);
    const campus = normalized($('campus').value), search = normalized($('search').value);
    const maximum = $('maxPrice').value === '' ? null : Number($('maxPrice').value);
    const filtered = entries.filter(entry => (!campus || normalized(entry.campus).includes(campus)) && (category === 'all' || entry.kind === category) && (!search || normalized([entry.title, entry.headline, entry.description, entry.area, entry.business_name].join(' ')).includes(search)) && (maximum === null || (priceValue(entry) !== null && priceValue(entry) !== undefined && Number(priceValue(entry)) <= maximum)));
    const sort = $('sortListings').value;
    if (sort !== 'newest') filtered.sort((a, b) => {
      const left = priceValue(a), right = priceValue(b);
      if (left == null) return right == null ? 0 : 1;
      if (right == null) return -1;
      return sort === 'price-low' ? Number(left) - Number(right) : Number(right) - Number(left);
    });
    else filtered.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    $('resultsTitle').textContent = $('campus').value.trim() ? `Around ${$('campus').value.trim()}` : 'Around campus';
    $('marketStatus').textContent = loading ? 'Loading campus listings…' : failures === 2 ? 'Listings could not be loaded. Please try again.' : `${filtered.length} listing${filtered.length === 1 ? '' : 's'}${campus ? ' for your campus' : ' across all campuses'}${failures ? ' · Some listings could not be loaded. Retry to see everything.' : ''}`;
    $('retryListings').hidden = !failures;
    $('campusListings').setAttribute('aria-busy', String(loading));
    $('campusListings').innerHTML = filtered.map(entry => {
      const title = entry.title || entry.headline, src = image(entry);
      return `<article class="campus-card" data-market-kind="${entry.kind === 'rooms' ? 'rooms' : 'adverts'}" data-market-id="${entry.id}" data-market-views="${entry.views || 0}" data-market-rating="${entry.rating || ''}" data-market-rating-count="${entry.rating_count || 0}" data-view-on-open="true" data-entry-key="${esc(entry.key)}" tabindex="0" aria-label="View ${esc(title)}"><button type="button" class="campus-card-media" data-offer="${esc(entry.key)}" aria-label="View ${esc(title)} and its photos">${src ? `<img src="${esc(window.arounusThumb?.(src, 560) || src)}" alt="${esc(title)}" loading="lazy">` : `<span>${categories[entry.kind]}</span>`}${photos(entry).length > 1 ? `<small class="photo-count">${photos(entry).length} photos</small>` : ''}</button><div class="campus-card-body"><span class="card-kind">${categories[entry.kind]}${sponsored(entry) ? ' · Sponsored' : ''}</span><h3>${esc(title)}</h3><p>${esc(entry.campus || 'Campus not specified')}${entry.area ? ' · ' + esc(entry.area) : ''}</p><p class="card-price">${esc(offerPrice(entry))}</p>${entry.kind !== 'rooms' && entry.business_name ? `<p class="card-provider">${esc(entry.business_name)}</p>` : ''}<button type="button" class="card-action" data-offer="${esc(entry.key)}">View ${entry.kind === 'rooms' ? 'room' : 'listing'} →</button></div></article>`;
    }).join('') || (loading || failures === 2 ? '' : '<div class="market-empty"><h3>No listings here yet</h3><p>Try another campus or category, or be the first to list something.</p><button type="button" data-open-sell>Sell or list on campus →</button></div>');
    $('campusListings').querySelectorAll('img').forEach(img => img.addEventListener('error', () => { img.replaceWith(document.createTextNode('Photo unavailable')); }));
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
    const campuses = [...new Set(entries.map(entry => entry.campus?.trim()).filter(Boolean))].sort();
    $('campusOptions').replaceChildren(...campuses.map(campus => { const option = document.createElement('option'); option.value = campus; return option; }));
    loading = false; render();
  }
  $('campusSearch').addEventListener('submit', event => { event.preventDefault(); try { localStorage.setItem('marketCampus', $('campus').value.trim()); } catch {} render(); });
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
  $('campusListings').addEventListener('keydown', event => {
    if (!['Enter', ' '].includes(event.key) || event.target !== event.target.closest('.campus-card')) return;
    event.preventDefault();
    event.target.querySelector('.card-action')?.click();
  });
  $('campusListings').addEventListener('click', event => {
    if (event.target.closest('.market-stars button')) return;
    const card = event.target.closest('.campus-card');
    if (!card) return;
    const entry = entries.find(item => item.key === card.dataset.entryKey);
    if (!entry) return;
    const gallery = photos(entry), url = safeUrl(entry.website_url), providerId = entry.kind === 'rooms' ? entry.landlord?.id : entry.provider_id;
    $('offerDetails').innerHTML = `<span class="eyebrow">${categories[entry.kind]}${sponsored(entry) ? ' · Sponsored' : ''}</span><h2 id="offerTitle">${esc(entry.title || entry.headline)}</h2>${gallery.length ? `<div class="offer-gallery"><img class="offer-gallery-main" src="${esc(gallery[0])}" alt="Photo 1 of ${gallery.length}: ${esc(entry.title || entry.headline)}"><div class="offer-gallery-controls">${gallery.length > 1 ? `<button type="button" data-gallery-step="-1" aria-label="Previous photo">‹</button><span data-gallery-count>1 of ${gallery.length}</span><button type="button" data-gallery-step="1" aria-label="Next photo">›</button>` : ''}</div><div class="offer-gallery-thumbs">${gallery.map((src, index) => `<button type="button" data-gallery-index="${index}" aria-label="Show photo ${index + 1}" aria-pressed="${index === 0}"><img src="${esc(window.arounusThumb?.(src, 160) || src)}" alt=""></button>`).join('')}</div></div>` : ''}${entry.video_url ? `<video controls preload="none" data-free-video="${esc(safeUrl(entry.video_url))}" data-video-kind="advert" data-video-id="${entry.id}" data-premium-available="${Boolean(entry.premium_available)}" style="width:100%;max-height:320px"></video>` : ''}<p>${esc(entry.campus || 'Campus not specified')}${entry.area ? ' · ' + esc(entry.area) : ''}</p><strong>${esc(offerPrice(entry))}</strong>${entry.kind !== 'rooms' && entry.business_name ? `<p>${esc(entry.business_name)}</p>` : ''}${entry.service_detail ? `<p>Activity or service: ${esc(entry.service_detail)}</p>` : ''}<p>${esc(entry.description)}</p><p>Contact: ${esc(entry.contact || 'Ask the provider for contact details.')}</p>${safeUrl(entry.directions_url) ? `<p><a href="${esc(entry.directions_url)}" target="_blank" rel="noopener noreferrer">Directions ↗</a></p>` : ''}${url ? `<p><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Visit seller website ↗</a></p>` : ''}${providerId ? `<p><button type="button" data-contact-provider="${Number(providerId)}" data-provider-name="${esc(entry.business_name || entry.landlord?.name || 'provider')}">Message provider</button></p>` : ''}`;
    $('offerDetails').dataset.gallery = JSON.stringify(gallery);
    $('offerDetails').dataset.galleryIndex = '0';
    $('offerDialog').showModal();
  });
  $('offerDetails').addEventListener('click', event => {
    const selected = event.target.closest('[data-gallery-index]'), step = event.target.closest('[data-gallery-step]');
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
  document.addEventListener('market-listing-changed', load);
  load();
})();
