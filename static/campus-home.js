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
  const image = entry => safeUrl(entry.image_urls?.[0] || entry.image_url);
  const roomPrice = entry => entry.monthly_rent !== null && entry.monthly_rent !== undefined && Number.isFinite(Number(entry.monthly_rent)) ? `R${Number(entry.monthly_rent).toLocaleString('en-ZA')} / month` : 'Price on request';
  const priceValue = entry => entry.kind === 'rooms' ? entry.monthly_rent : entry.price;
  const offerPrice = entry => entry.kind === 'rooms' ? roomPrice(entry) : entry.price !== null && entry.price !== undefined ? `R${Number(entry.price).toLocaleString('en-ZA')}` : 'Ask for price';
  const sponsored = entry => Boolean(entry.is_featured);
  function render() {
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
      return `<article class="campus-card" data-market-kind="${entry.kind === 'rooms' ? 'rooms' : 'adverts'}" data-market-id="${entry.id}" data-market-views="${entry.views || 0}" data-market-rating="${entry.rating || ''}" data-market-rating-count="${entry.rating_count || 0}" data-view-on-open="true"><div class="campus-card-media">${src ? `<img src="${esc(window.arounusThumb?.(src, 560) || src)}" alt="${esc(title)}" loading="lazy">` : `<span>${categories[entry.kind]}</span>`}</div><div class="campus-card-body"><span class="card-kind">${categories[entry.kind]}${sponsored(entry) ? ' · Sponsored' : ''}</span><h3>${esc(title)}</h3><p>${esc(entry.campus || 'Campus not specified')}${entry.area ? ' · ' + esc(entry.area) : ''}</p><p class="card-price">${esc(offerPrice(entry))}</p>${entry.kind !== 'rooms' && entry.business_name ? `<p class="card-provider">${esc(entry.business_name)}</p>` : ''}<button type="button" class="card-action" data-offer="${esc(entry.key)}">View ${entry.kind === 'rooms' ? 'room' : 'listing'} →</button></div></article>`;
    }).join('') || (loading || failures === 2 ? '' : '<div class="market-empty"><h3>No listings here yet</h3><p>Try another campus or category, or be the first to list something.</p><a href="/static/marketing.html?create=1">Sell or list on campus →</a></div>');
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
  $('campusListings').addEventListener('click', event => {
    const button = event.target.closest('[data-offer]');
    if (!button) return;
    const entry = entries.find(item => item.key === button.dataset.offer);
    if (!entry) return;
    const src = image(entry), url = safeUrl(entry.website_url);
    $('offerDetails').innerHTML = `<span class="eyebrow">${categories[entry.kind]}${sponsored(entry) ? ' · Sponsored' : ''}</span><h2 id="offerTitle">${esc(entry.title || entry.headline)}</h2>${src ? `<img src="${esc(src)}" alt="${esc(entry.title || entry.headline)}">` : ''}${entry.video_url ? `<video controls preload="none" data-free-video="${esc(safeUrl(entry.video_url))}" data-video-kind="advert" data-video-id="${entry.id}" data-premium-available="${Boolean(entry.premium_available)}" style="width:100%;max-height:320px"></video>` : ''}<p>${esc(entry.campus || 'Campus not specified')}${entry.area ? ' · ' + esc(entry.area) : ''}</p><strong>${esc(offerPrice(entry))}</strong>${entry.kind !== 'rooms' && entry.business_name ? `<p>${esc(entry.business_name)}</p>` : ''}<p>${esc(entry.description)}</p><p>Contact: ${esc(entry.contact || 'Contact the provider through the campus market.')}</p>${url ? `<p><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Visit seller website ↗</a></p>` : ''}${entry.kind === 'rooms' ? `<a href="/static/marketing.html#listing-${encodeURIComponent(entry.id)}">Photos, questions &amp; private messages →</a>` : '<a href="/static/marketing.html">Open campus market →</a>'}`;
    $('offerDialog').showModal();
  });
  $('closeOffer').addEventListener('click', () => $('offerDialog').close());
  load();
})();
