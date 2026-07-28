(() => {
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const studentToken = () => sessionStorage.getItem('studentToken') || '';
  const landlordToken = () => sessionStorage.getItem('landlordToken') || '';
  const authHeaders = () => studentToken() ? {'X-Student-Token': studentToken()} : landlordToken() ? {'X-Landlord-Token': landlordToken()} : {};
  const api = async (path, options = {}) => {
    const response = await fetch(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || 'Something went wrong');
    return data;
  };
  const safeLink = value => /^https?:\/\//i.test(value || '') ? value : (value ? `https://${value}` : '');
  const advertCard = (ad, compact = false) => {
    const link = safeLink(ad.website_url) || (ad.contact ? `https://wa.me/${ad.contact.replace(/\D/g, '')}` : '');
    return `<article class="market-advert ${compact ? 'compact' : ''}" data-market-ad="${ad.id}">
      ${ad.image_url ? `<img src="${esc(ad.image_url)}" alt="${esc(ad.business_name)} advert">` : '<div class="advert-art">✦</div>'}
      <div class="advert-copy"><div class="advert-label">${ad.is_featured ? 'Featured · ' : ''}Sponsored · ${esc(ad.category)}</div><h3>${esc(ad.headline)}</h3>
      <p>${esc(ad.description)}</p><div class="advert-meta">${esc(ad.business_name)}${ad.campus ? ` · ${esc(ad.campus)}` : ''}</div>
      ${link ? `<a class="btn secondary advert-cta" href="${esc(link)}" target="_blank" rel="noopener" data-ad-click="${ad.id}">${ad.website_url ? 'Visit business' : 'Contact advertiser'}</a>` : ''}</div></article>`;
  };

  let publicAds = [];
  let spotlightIndex = 0;
  let feedObserver;
  function renderSpotlight() {
    const slots = document.querySelectorAll('.market-side .ad-card');
    if (!slots.length) return;
    const ads = publicAds.filter(ad => ad.placement === 'spotlight');
    const target = slots[1] || slots[0];
    if (!ads.length) {
      target.innerHTML = '<div class="ad-symbol">↗</div><small>STUDENT BUSINESS SPOTLIGHT</small><h3>Your side hustle belongs here</h3><p class="muted">Submit an advert below for review and reach the campus community.</p><button class="btn secondary promote-trigger" type="button">Promote here</button>';
      return;
    }
    target.innerHTML = advertCard(ads[spotlightIndex % ads.length], true);
    spotlightIndex += 1;
  }
  function insertFeedAds() {
    const feed = document.getElementById('listingFeed');
    if (!feed) return;
    feed.querySelectorAll('[data-injected-market-ad]').forEach(node => node.remove());
    const ads = publicAds.filter(ad => ad.placement === 'feed');
    const listings = [...feed.querySelectorAll('.listing-card')];
    if (!ads.length || !listings.length) return;
    if (feedObserver) feedObserver.disconnect();
    ads.forEach((ad, index) => {
      const wrapper = document.createElement('div');
      wrapper.dataset.injectedMarketAd = ad.id;
      wrapper.innerHTML = advertCard(ad);
      const anchor = listings[Math.min((index + 1) * 2 - 1, listings.length - 1)];
      anchor.insertAdjacentElement('afterend', wrapper);
    });
    if (feedObserver) feedObserver.observe(feed, {childList: true});
  }
  async function loadPublicAds() {
    try { publicAds = await api('/marketing/adverts'); } catch (_) { publicAds = []; }
    renderSpotlight(); insertFeedAds();
  }

  function installAdvertDesk() {
    const side = document.querySelector('.market-side');
    if (!side || document.getElementById('advertDesk')) return;
    const desk = document.createElement('section');
    desk.className = 'landlord-desk advert-desk'; desk.id = 'advertDesk';
    desk.innerHTML = `<span class="market-kicker">Campus promotion</span><h2>Advertise on QuizMark</h2>
      <p class="notice">Student businesses, services and events can apply. Every advert is reviewed before it appears.</p>
      <button class="btn" type="button" id="openAdvertForm">Create an advert</button>
      <div id="advertFormWrap" class="hidden"><form id="advertForm">
        <input name="business_name" placeholder="Business or event name" maxlength="160" required>
        <input name="headline" placeholder="Short, catchy headline" maxlength="180" required>
        <textarea name="description" placeholder="What are you offering?" maxlength="1200" required></textarea>
        <select name="category" required><option value="">Choose category</option><option>Student service</option><option>Food & delivery</option><option>Tutoring</option><option>Event</option><option>Technology</option><option>Beauty & lifestyle</option><option>Other</option></select>
        <input name="campus" placeholder="Campus or area">
        <input name="contact" placeholder="WhatsApp or contact number">
        <input name="website_url" placeholder="Website or social link (optional)">
        <label class="notice">Placement<select name="placement"><option value="spotlight">Business spotlight</option><option value="feed">Between market listings</option></select></label>
        <div class="advert-date-row"><label>Start date<input name="starts_at" type="date"></label><label>End date<input name="expires_at" type="date"></label></div>
        <label class="notice">Poster or business image<input name="image" type="file" accept="image/*"></label>
        <button class="btn" type="submit">Submit for review</button><button class="btn secondary" type="button" id="cancelAdvertForm">Cancel</button>
      </form></div><div id="advertMessage"></div><div id="myAdvertList" class="manage-list"></div>`;
    side.appendChild(desk);
    const wrap = desk.querySelector('#advertFormWrap');
    const open = () => {
      if (!studentToken() && !landlordToken()) {
        alert('Sign in as a student or landlord first.');
        document.querySelector('.landlord-desk')?.scrollIntoView({behavior:'smooth'}); return;
      }
      wrap.classList.remove('hidden'); desk.querySelector('#openAdvertForm').classList.add('hidden');
    };
    desk.querySelector('#openAdvertForm').addEventListener('click', open);
    desk.querySelector('#cancelAdvertForm').addEventListener('click', () => { wrap.classList.add('hidden'); desk.querySelector('#openAdvertForm').classList.remove('hidden'); });
    document.addEventListener('click', event => { if (event.target.closest('.promote-trigger')) { event.preventDefault(); desk.scrollIntoView({behavior:'smooth'}); open(); } });
    desk.querySelector('#advertForm').addEventListener('submit', async event => {
      event.preventDefault(); const message = desk.querySelector('#advertMessage'); message.textContent = 'Submitting advert…';
      try {
        const result = await api('/marketing/adverts', {method:'POST', headers:authHeaders(), body:new FormData(event.target)});
        message.innerHTML = `<div class="success">${esc(result.message)}. You can track it below.</div>`;
        event.target.reset(); wrap.classList.add('hidden'); desk.querySelector('#openAdvertForm').classList.remove('hidden'); await loadMyAds();
      } catch (error) { message.innerHTML = `<div class="error">${esc(error.message)}</div>`; }
    });
    loadMyAds();
  }
  async function loadMyAds() {
    const list = document.getElementById('myAdvertList');
    if (!list || (!studentToken() && !landlordToken())) return;
    try {
      const ads = await api('/marketing/my-adverts', {headers:authHeaders()});
      list.innerHTML = ads.length ? `<h3>Your adverts</h3>${ads.map(ad => `<div class="manage-item"><strong>${esc(ad.headline)}</strong><span class="status-chip advert-status ${esc(ad.status)}">${esc(ad.status)}</span><div class="muted">${esc(ad.placement)} · ${ad.impressions} views · ${ad.clicks} clicks${ad.expires_at ? ` · ends ${esc(ad.expires_at)}` : ''}</div>${ad.status === 'approved' ? `<button class="btn secondary pause-advert" data-id="${ad.id}" type="button">Pause advert</button>` : ''}</div>`).join('')}` : '<p class="notice">You have not submitted an advert yet.</p>';
    } catch (error) { list.innerHTML = `<div class="error">${esc(error.message)}</div>`; }
  }
  document.addEventListener('click', async event => {
    const click = event.target.closest('[data-ad-click]'); if (click) fetch(`/marketing/adverts/${click.dataset.adClick}/click`, {method:'POST', keepalive:true});
    const pause = event.target.closest('.pause-advert'); if (pause && confirm('Pause this advert?')) { await api(`/marketing/adverts/${pause.dataset.id}/pause`, {method:'PUT', headers:authHeaders()}); loadMyAds(); loadPublicAds(); }
  });
  function init() {
    installAdvertDesk();
    const first = document.querySelector('.market-side .ad-card');
    if (first) first.innerHTML = '<div class="ad-symbol">✦</div><small>FEED AD SPACE</small><h3>Reach students where they browse</h3><p class="muted">Approved campus offers can appear naturally between accommodation listings.</p><button class="btn secondary promote-trigger" type="button">Promote here</button>';
    const feed = document.getElementById('listingFeed');
    if (feed) { feedObserver = new MutationObserver(() => insertFeedAds()); feedObserver.observe(feed, {childList:true}); }
    loadPublicAds(); setInterval(renderSpotlight, 7000);
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
