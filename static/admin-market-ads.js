(() => {
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  let installed = false;
  const reportReasons = {unavailable:'No longer available', outdated:'Outdated details', suspicious:'Suspected scam or unsafe behaviour', misleading:'Misleading content', other:'Other concern'};
  async function loadReports() {
    const list = document.getElementById('marketReportAdminList');
    if (!list) return;
    try {
      const reports = await api(`/admin/market-reports?status=${document.getElementById('marketReportFilter').value}`);
      list.innerHTML = reports.length ? reports.map(report => `<article class="moderation-item" data-admin-report="${report.id}"><h3>#${report.id} · ${esc(report.listing_title)}</h3><p><strong>${esc(reportReasons[report.reason] || report.reason)}</strong> · ${esc(report.status)} · ${esc(report.created_at.slice(0, 10))}</p><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(report.details || 'No extra details supplied.')}</p><p><a href="/listing/${report.kind === 'room' ? 'room' : 'offer'}/${Number(report.listing_id)}" target="_blank" rel="noopener noreferrer">Open reported listing ↗</a> · Listing ID ${Number(report.listing_id)} (${esc(report.kind)})</p><button class="btn secondary" type="button" data-review-status="${report.status === 'open' ? 'resolved' : 'open'}">${report.status === 'open' ? 'Mark reviewed' : 'Reopen report'}</button></article>`).join('') : '<p>No reports in this view.</p>';
    } catch (error) { list.textContent = `Reports could not be loaded: ${error.message}`; }
  }
  async function load() {
    const list = document.getElementById('marketAdvertAdminList'); if (!list) return;
    try {
      const [rooms, ads] = await Promise.all([api('/admin/market-rooms'), api('/admin/market-adverts')]);
      const roomList = document.getElementById('marketRoomAdminList');
      roomList.innerHTML = rooms.length ? rooms.map(room => `<article class="moderation-item advert-review-card" data-admin-room="${room.id}">
        ${room.image_url ? `<img class="advert-review-image" src="${esc(room.image_url)}" alt="Room preview for ${esc(room.title)}">` : '<div class="advert-review-image advert-placeholder">No media</div>'}
        <div class="advert-review-copy"><div class="advert-review-head"><div><span class="kicker">Room · ${esc(room.campus)}</span><h3>${esc(room.title)}</h3></div><span class="status-chip advert-status ${room.is_approved ? 'approved' : 'pending'}">${room.is_approved ? 'Approved' : 'Awaiting approval'}</span></div>
        <p>${esc(room.description)}</p><dl class="review-meta"><div><dt>Area</dt><dd>${esc(room.area)}</dd></div><div><dt>Submitted by</dt><dd>${esc(room.owner_name)}</dd></div><div><dt>Listing contact</dt><dd>${esc(room.contact || 'Missing')}</dd></div><div><dt>Registration contact</dt><dd>${esc(room.registration_contact || 'Missing')}</dd></div></dl>
        <div class="actions review-actions"><button class="btn approve-room" type="button" ${room.is_approved ? 'disabled' : ''}>Approve room</button><button class="btn secondary unapprove-room" type="button" ${room.is_approved ? '' : 'disabled'}>Remove approval</button><button class="btn danger delete-room" type="button">Delete</button></div></div>
      </article>`).join('') : '<div class="empty-state"><strong>No room submissions yet</strong></div>';
      list.innerHTML = ads.length ? ads.map(ad => `<article class="moderation-item advert-review-card" data-admin-ad="${ad.id}">
        ${ad.video_url?`<video class="advert-review-image" src="${esc(ad.video_url)}" controls muted playsinline aria-label="Advert video for ${esc(ad.business_name)}"></video>`:ad.image_url?`<img class="advert-review-image" src="${esc(ad.image_url)}" alt="Advert preview for ${esc(ad.business_name)}">`:'<div class="advert-review-image advert-placeholder">No media</div>'}
        <div class="advert-review-copy"><div class="advert-review-head"><div><span class="kicker">${esc(ad.category)} · ${esc(ad.placement)}</span><h3>${esc(ad.headline)}</h3></div><span class="status-chip advert-status ${esc(ad.status)}">${esc(ad.status)}</span></div>
        <p>${esc(ad.description)}</p><dl class="review-meta"><div><dt>Business</dt><dd>${esc(ad.business_name)}</dd></div><div><dt>Submitted by</dt><dd>${esc(ad.owner_name||'Unknown account')}</dd></div><div><dt>Registration contact</dt><dd>${esc(ad.registration_contact||'See account')}</dd></div><div><dt>Submitted</dt><dd>${esc(ad.created_at.slice(0,10))}</dd></div><div><dt>Engagement</dt><dd>${ad.impressions} views · ${ad.clicks} clicks</dd></div></dl>
        <p class="muted"><strong>Destination:</strong> ${esc(ad.website_url||ad.contact||'Missing')}</p>
        <div class="actions review-actions">${ad.status !== 'approved' ? '<button class="btn approve-ad" type="button">Publish</button>' : '<button class="btn secondary pause-ad" type="button">Pause listing</button>'}<button class="btn secondary feature-ad${ad.is_featured?' is-featured':''}" type="button" data-featured="${ad.is_featured?'true':'false'}" aria-describedby="feature-help-${ad.id}" title="${ad.is_featured?'Return this advert to normal ordering':'Show this approved advert before regular adverts'}">${ad.is_featured?'★ Featured':'☆ Feature advert'}</button><button class="btn danger delete-ad" type="button">Delete</button></div>
        <p class="feature-help" id="feature-help-${ad.id}"><span aria-hidden="true">★</span><span><strong>${ad.is_featured?'This advert is featured.':'What does Feature do?'}</strong> ${ad.is_featured?'It is shown before regular approved adverts in its selected Local Market placement.':'It moves an approved advert ahead of regular adverts in its selected Local Market placement. It does not approve the advert or change its dates.'}</span></p></div>
      </article>`).join('') : '<div class="empty-state"><strong>No other listings</strong></div>';
    } catch (error) { list.innerHTML = `<div class="error">${esc(error.message)}</div>`; }
  }
  function install() {
    if (installed || !document.getElementById('appWrap')) return; installed = true;
    const card = document.createElement('section'); card.className = 'card'; card.id = 'marketAdvertAdmin';
    card.innerHTML = '<div class="admin-editor-heading"><div><span class="kicker">Local market</span><h2>Room approvals</h2><p class="muted">Rooms appear publicly only after approval. Other listings publish automatically.</p></div><button class="btn secondary" type="button" id="refreshMarketAds">Refresh listings</button></div><div id="marketRoomAdminList" class="stack-list"></div><h2>Other listings</h2><div id="marketAdvertAdminList" class="stack-list"></div>';
    const content = document.querySelector('#appWrap .admin-content');
    if (content) content.insertBefore(card, document.getElementById('mediaFinanceCard'));
    else {
      const cards = document.querySelectorAll('#appWrap .card');
      (cards[1] || cards[0])?.insertAdjacentElement('afterend', card);
    }
    const reports = document.createElement('section');
    reports.innerHTML = '<h2>Listing reports</h2><p class="muted">Review stale or suspicious listings here. Reports do not automatically remove a listing. Use Remove approval for rooms or Pause listing for other listings when appropriate; marking a report reviewed only updates this queue. Up to 100 most recent reports are shown.</p><label for="marketReportFilter">Show reports</label><select id="marketReportFilter"><option value="open">Needs review</option><option value="resolved">Reviewed</option></select><div id="marketReportAdminList" class="stack-list" aria-live="polite"></div>';
    card.prepend(reports);
    reports.querySelector('select').addEventListener('change', loadReports);
    card.querySelector('#refreshMarketAds').addEventListener('click', () => { load(); loadReports(); });
    card.addEventListener('click', async event => {
      const review = event.target.closest('[data-review-status]');
      if (review) {
        review.disabled = true;
        try {
          await api(`/admin/market-reports/${review.closest('[data-admin-report]').dataset.adminReport}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status:review.dataset.reviewStatus})});
          await loadReports();
        } catch (error) { review.disabled = false; alert(`Report could not be updated: ${error.message}`); }
        return;
      }
      const room = event.target.closest('[data-admin-room]');
      if (room && event.target.closest('.delete-room')) {
        if (!confirm(`Permanently delete the room listing "${room.querySelector('h3')?.textContent || 'this room'}"?`)) return;
        await api(`/admin/market-rooms/${room.dataset.adminRoom}`, {method:'DELETE'});
        load();
        return;
      }
      if (room && (event.target.closest('.approve-room') || event.target.closest('.unapprove-room'))) {
        const approved = Boolean(event.target.closest('.approve-room'));
        await api(`/admin/market-rooms/${room.dataset.adminRoom}/approval?approved=${approved}`, {method:'PUT'});
        load();
        return;
      }
      const row = event.target.closest('[data-admin-ad]'); if (!row) return;
      const id = row.dataset.adminAd; let body;
      if (event.target.closest('.approve-ad')) body = {status:'approved'};
      if (event.target.closest('.pause-ad')) body = {status:'paused'};
      if (event.target.closest('.reject-ad')) { if (!confirm('Reject this advert? The submitter will see it as rejected.')) return; body = {status:'rejected'}; }
      const featureButton = event.target.closest('.feature-ad');
      if (featureButton) body = {is_featured:featureButton.dataset.featured !== 'true'};
      if (event.target.closest('.delete-ad')) { if (!confirm('Permanently delete this advert?')) return; await api(`/admin/market-adverts/${id}`, {method:'DELETE'}); load(); return; }
      if (body) { await api(`/admin/market-adverts/${id}`, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)}); load(); }
    });
    load();
    loadReports();
  }
  const observer = new MutationObserver(() => { const wrap = document.getElementById('appWrap'); if (wrap && !wrap.classList.contains('hidden')) { install(); load(); } });
  document.addEventListener('DOMContentLoaded', () => { const wrap = document.getElementById('appWrap'); if (wrap) observer.observe(wrap, {attributes:true, attributeFilter:['class']}); if (wrap && !wrap.classList.contains('hidden')) install(); });
})();
