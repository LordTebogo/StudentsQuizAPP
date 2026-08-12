(() => {
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  let installed = false;
  async function load() {
    const list = document.getElementById('marketAdvertAdminList'); if (!list) return;
    try {
      const ads = await api('/admin/market-adverts');
      list.innerHTML = ads.length ? ads.map(ad => `<article class="moderation-item advert-review-card" data-admin-ad="${ad.id}">
        ${ad.video_url?`<video class="advert-review-image" src="${esc(ad.video_url)}" controls muted playsinline aria-label="Advert video for ${esc(ad.business_name)}"></video>`:ad.image_url?`<img class="advert-review-image" src="${esc(ad.image_url)}" alt="Advert preview for ${esc(ad.business_name)}">`:'<div class="advert-review-image advert-placeholder">No media</div>'}
        <div class="advert-review-copy"><div class="advert-review-head"><div><span class="kicker">${esc(ad.category)} · ${esc(ad.placement)}</span><h3>${esc(ad.headline)}</h3></div><span class="status-chip advert-status ${esc(ad.status)}">${esc(ad.status)}</span></div>
        <p>${esc(ad.description)}</p><dl class="review-meta"><div><dt>Business</dt><dd>${esc(ad.business_name)}</dd></div><div><dt>Submitted by</dt><dd>${esc(ad.owner_name||'Unknown account')}</dd></div><div><dt>Submitted</dt><dd>${esc(ad.created_at.slice(0,10))}</dd></div><div><dt>Engagement</dt><dd>${ad.impressions} views · ${ad.clicks} clicks</dd></div></dl>
        <p class="muted"><strong>Destination:</strong> ${esc(ad.website_url||ad.contact||'Missing')}</p>
        <div class="actions review-actions"><button class="btn approve-ad" type="button">Approve</button><button class="btn secondary reject-ad" type="button">Reject</button><button class="btn secondary feature-ad${ad.is_featured?' is-featured':''}" type="button" data-featured="${ad.is_featured?'true':'false'}" aria-describedby="feature-help-${ad.id}" title="${ad.is_featured?'Return this advert to normal ordering':'Show this approved advert before regular adverts'}">${ad.is_featured?'★ Featured':'☆ Feature advert'}</button><button class="btn danger delete-ad" type="button">Delete</button></div>
        <p class="feature-help" id="feature-help-${ad.id}"><span aria-hidden="true">★</span><span><strong>${ad.is_featured?'This advert is featured.':'What does Feature do?'}</strong> ${ad.is_featured?'It is shown before regular approved adverts in its selected Campus Market placement.':'It moves an approved advert ahead of regular adverts in its selected Campus Market placement. It does not approve the advert or change its dates.'}</span></p></div>
      </article>`).join('') : '<div class="empty-state"><strong>No advert submissions</strong><span>New adverts awaiting review will appear here.</span></div>';
    } catch (error) { list.innerHTML = `<div class="error">${esc(error.message)}</div>`; }
  }
  function install() {
    if (installed || !document.getElementById('appWrap')) return; installed = true;
    const card = document.createElement('section'); card.className = 'card'; card.id = 'marketAdvertAdmin';
    card.innerHTML = '<div class="admin-editor-heading"><div><span class="kicker">Campus market</span><h2>Advert approvals</h2><p class="muted">Review the advert preview, submitter and destination before making a decision.</p></div><button class="btn secondary" type="button" id="refreshMarketAds">Refresh adverts</button></div><div id="marketAdvertAdminList" class="stack-list"></div>';
    const cards = document.querySelectorAll('#appWrap .card');
    (cards[1] || cards[0])?.insertAdjacentElement('afterend', card);
    card.querySelector('#refreshMarketAds').addEventListener('click', load);
    card.addEventListener('click', async event => {
      const row = event.target.closest('[data-admin-ad]'); if (!row) return;
      const id = row.dataset.adminAd; let body;
      if (event.target.closest('.approve-ad')) body = {status:'approved'};
      if (event.target.closest('.reject-ad')) { if (!confirm('Reject this advert? The submitter will see it as rejected.')) return; body = {status:'rejected'}; }
      const featureButton = event.target.closest('.feature-ad');
      if (featureButton) body = {is_featured:featureButton.dataset.featured !== 'true'};
      if (event.target.closest('.delete-ad')) { if (!confirm('Permanently delete this advert?')) return; await api(`/admin/market-adverts/${id}`, {method:'DELETE'}); load(); return; }
      if (body) { await api(`/admin/market-adverts/${id}`, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)}); load(); }
    });
    load();
  }
  const observer = new MutationObserver(() => { const wrap = document.getElementById('appWrap'); if (wrap && !wrap.classList.contains('hidden')) { install(); load(); } });
  document.addEventListener('DOMContentLoaded', () => { const wrap = document.getElementById('appWrap'); if (wrap) observer.observe(wrap, {attributes:true, attributeFilter:['class']}); if (wrap && !wrap.classList.contains('hidden')) install(); });
})();
