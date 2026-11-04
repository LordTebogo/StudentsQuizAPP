(() => {
  const selector = '[data-market-kind][data-market-id]';
  const attempted = new Set();
  const timers = new WeakMap();
  const style = document.createElement('style');
  style.textContent = '.market-metrics{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:10px 0;font-size:.82rem;color:var(--muted,#526675)}.market-metrics strong{color:var(--text,#17313a)}.market-stars{display:inline-flex;gap:2px}.market-stars button{min-width:44px;min-height:44px;border:0;background:transparent;color:#b38419;font-size:1.15rem;line-height:1;cursor:pointer;padding:8px}.market-stars button:hover,.market-stars button:focus-visible{color:#df9500;transform:scale(1.12)}.market-stars button[data-active=true]{color:#df9500}.market-rating-note{font-size:.76rem}';
  document.head.appendChild(style);
  const cardsFor = card => [...document.querySelectorAll(selector)].filter(other => other.dataset.marketKind === card.dataset.marketKind && other.dataset.marketId === card.dataset.marketId);
  const paint = card => {
    const host = card.querySelector('.campus-card-body,.listing-body,.advert-copy,.offer-detail-body');
    if (!host || card.dataset.metricsReady) return;
    card.dataset.metricsReady = 'true';
    const panel = document.createElement('div');
    panel.className = 'market-metrics';
    if (card.dataset.demo === 'true') return;
    const summaryOnly = card.dataset.ratingReadonly === 'true';
    panel.innerHTML = '<strong data-rating-summary></strong>' + (summaryOnly ? '' : '<span class="market-stars" aria-label="Rate this listing from 1 to 5 stars"></span><span class="market-rating-note" role="status"></span>');
    for (let stars = 1; !summaryOnly && stars <= 5; stars++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '☆';
      button.title = `Rate ${stars} star${stars === 1 ? '' : 's'}`;
      button.setAttribute('aria-label', `${button.title} for ${card.querySelector('h2,h3')?.textContent || 'this listing'}`);
      button.dataset.stars = String(stars);
      panel.querySelector('.market-stars').appendChild(button);
    }
    const actions = host.querySelector('.card-action,.advert-actions,.listing-actions,.offer-actions');
    if (actions) actions.before(panel); else host.appendChild(panel);
    refresh(card);
  };
  const refresh = card => {
    const count = Number(card.dataset.marketRatingCount || 0);
    card.querySelector('[data-rating-summary]').textContent = count ? `★ ${card.dataset.marketRating} (${count})` : 'No ratings yet';
  };
  async function recordView(card) {
    const key = `${card.dataset.marketKind}:${card.dataset.marketId}`;
    if (card.dataset.demo === 'true' || attempted.has(key)) return;
    attempted.add(key);
    try {
      const response = await fetch(`/marketing/${card.dataset.marketKind}/${card.dataset.marketId}/view`, {method:'POST'});
      if (!response.ok) throw new Error('View unavailable');
      const result = await response.json();
      cardsFor(card).forEach(other => { other.dataset.marketViews = String(result.views); if (other.dataset.metricsReady) refresh(other); });
    } catch { attempted.delete(key); }
  }
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const card = entry.target;
      if (entry.isIntersecting) {
        timers.set(card, setTimeout(() => { recordView(card); observer.unobserve(card); }, 1200));
      } else {
        clearTimeout(timers.get(card));
      }
    });
  }, {threshold:0.2}) : null;
  let scheduled = false;
  function scan() {
    scheduled = false;
    document.querySelectorAll(selector).forEach(card => {
      if (card.dataset.metricsReady) return;
      paint(card);
      if (!card.dataset.viewOnOpen && observer) observer.observe(card);
    });
  }
  function scheduleScan() { if (!scheduled) { scheduled = true; queueMicrotask(scan); } }
  document.addEventListener('click', async event => {
    const cardOpened = event.target.closest('.campus-card');
    if (cardOpened && !event.target.closest('.market-stars button,[data-save]')) recordView(cardOpened);
    const star = event.target.closest('.market-stars button');
    if (!star) return;
    event.stopPropagation();
    const card = star.closest(selector), note = card.querySelector('.market-rating-note');
    star.disabled = true;
    try {
      const result = await ArounusMarketAuth.request(`/marketing/${card.dataset.marketKind}/${card.dataset.marketId}/rating`, {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({stars:Number(star.dataset.stars)})
      });
      if(!result)return;
      cardsFor(card).forEach(other => { other.dataset.marketRating = String(result.rating); other.dataset.marketRatingCount = String(result.rating_count); refresh(other); });
      document.dispatchEvent(new CustomEvent('market-rating-updated', {detail: {kind: card.dataset.marketKind, id: card.dataset.marketId, rating: result.rating, count: result.rating_count}}));
      card.querySelectorAll('.market-stars button').forEach(button => { const active = Number(button.dataset.stars) <= result.your_rating; button.dataset.active = String(active); button.textContent = active ? '★' : '☆'; });
      note.textContent = `Your rating: ${result.your_rating}/5`;
    } catch (error) { note.textContent = error.message; }
    finally { star.disabled = false; }
  });
  document.addEventListener('market-listing-opened', () => {
    const detail = document.querySelector('#offerDetails [data-market-kind][data-market-id]');
    if (detail) recordView(detail);
  });
  new MutationObserver(scheduleScan).observe(document.body, {childList:true, subtree:true});
  scheduleScan();
})();
