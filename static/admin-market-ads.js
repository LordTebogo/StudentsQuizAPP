(() => {
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  let installed = false;
  async function load() {
    const list = document.getElementById('marketAdvertAdminList'); if (!list) return;
    try {
      const ads = await api('/admin/market-adverts');
      list.innerHTML = ads.length ? ads.map(ad => `<div class="moderation-item" data-admin-ad="${ad.id}">
        <div><strong>${esc(ad.headline)}</strong> <span class="status-chip">${esc(ad.status)}</span><br><small>${esc(ad.business_name)} · ${esc(ad.category)} · ${esc(ad.placement)} · submitted by ${esc(ad.owner_name || 'Unknown account')}</small></div>
        <p>${esc(ad.description)}</p><small>${ad.impressions} views · ${ad.clicks} clicks · ${esc(ad.created_at.slice(0,10))}</small>
        <div class="actions"><button class="approve-ad" type="button">Approve</button><button class="reject-ad secondary" type="button">Reject</button><button class="feature-ad secondary" type="button">${ad.is_featured ? 'Remove feature' : 'Feature'}</button><button class="delete-ad danger" type="button">Delete</button></div>
      </div>`).join('') : '<p class="muted">No advert submissions yet.</p>';
    } catch (error) { list.innerHTML = `<div class="error">${esc(error.message)}</div>`; }
  }
  function install() {
    if (installed || !document.getElementById('appWrap')) return; installed = true;
    const card = document.createElement('section'); card.className = 'card'; card.id = 'marketAdvertAdmin';
    card.innerHTML = '<span class="kicker">Campus market</span><h2>Advert approvals</h2><p class="muted">Review student and landlord promotions before they go live.</p><button type="button" id="refreshMarketAds">Refresh adverts</button><div id="marketAdvertAdminList" class="stack-list"></div>';
    const cards = document.querySelectorAll('#appWrap .card');
    (cards[1] || cards[0])?.insertAdjacentElement('afterend', card);
    card.querySelector('#refreshMarketAds').addEventListener('click', load);
    card.addEventListener('click', async event => {
      const row = event.target.closest('[data-admin-ad]'); if (!row) return;
      const id = row.dataset.adminAd; let body;
      if (event.target.closest('.approve-ad')) body = {status:'approved'};
      if (event.target.closest('.reject-ad')) body = {status:'rejected'};
      if (event.target.closest('.feature-ad')) body = {is_featured:event.target.textContent.trim() === 'Feature'};
      if (event.target.closest('.delete-ad')) { if (!confirm('Permanently delete this advert?')) return; await api(`/admin/market-adverts/${id}`, {method:'DELETE'}); load(); return; }
      if (body) { await api(`/admin/market-adverts/${id}`, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)}); load(); }
    });
    load();
  }
  const observer = new MutationObserver(() => { const wrap = document.getElementById('appWrap'); if (wrap && !wrap.classList.contains('hidden')) { install(); load(); } });
  document.addEventListener('DOMContentLoaded', () => { const wrap = document.getElementById('appWrap'); if (wrap) observer.observe(wrap, {attributes:true, attributeFilter:['class']}); if (wrap && !wrap.classList.contains('hidden')) install(); });
})();
