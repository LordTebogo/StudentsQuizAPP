(() => {
  const selector = '[data-market-kind][data-market-id]';
  const attempted = new Set();
  const timers = new WeakMap();
  const style = document.createElement('style');
  style.textContent = '.market-metrics{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:10px 0;font-size:.82rem;color:var(--muted,#526675)}.market-metrics strong{color:var(--text,#17313a)}.market-stars{display:inline-flex;gap:2px}.market-stars button{border:0;background:transparent;color:#b38419;font-size:1.15rem;line-height:1;cursor:pointer;padding:2px}.market-stars button:hover,.market-stars button:focus-visible{color:#df9500;transform:scale(1.12)}.market-rating-note{font-size:.76rem}';
  document.head.appendChild(style);
  const cardsFor = card => [...document.querySelectorAll(selector)].filter(other => other.dataset.marketKind === card.dataset.marketKind && other.dataset.marketId === card.dataset.marketId);
  const paint = card => {
    const host = card.querySelector('.campus-card-body,.listing-body,.advert-copy');
    if (!host || card.dataset.metricsReady) return;
    card.dataset.metricsReady = 'true';
    const panel = document.createElement('div');
    panel.className = 'market-metrics';
    panel.innerHTML = '<span data-view-count></span><strong data-rating-summary></strong><span class="market-stars" aria-label="Rate this listing from 1 to 5 stars"></span><span class="market-rating-note" role="status"></span>';
    for (let stars = 1; stars <= 5; stars++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '★';
      button.title = `Rate ${stars} star${stars === 1 ? '' : 's'}`;
      button.setAttribute('aria-label', button.title);
      button.dataset.stars = String(stars);
      panel.querySelector('.market-stars').appendChild(button);
    }
    const actions = host.querySelector('.card-action,.advert-actions,.listing-actions');
    if (actions) actions.before(panel); else host.appendChild(panel);
    refresh(card);
  };
  const refresh = card => {
    card.querySelector('[data-view-count]').textContent = `${card.dataset.marketViews || 0} unique views`;
    const count = Number(card.dataset.marketRatingCount || 0);
    card.querySelector('[data-rating-summary]').textContent = count ? `★ ${card.dataset.marketRating} (${count})` : 'No ratings yet';
  };
  async function recordView(card) {
    const key = `${card.dataset.marketKind}:${card.dataset.marketId}`;
    if (attempted.has(key)) return;
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
    const offer = event.target.closest('[data-offer]');
    if (offer) { const card = offer.closest(selector); if (card) recordView(card); }
    const star = event.target.closest('.market-stars button');
    if (!star) return;
    event.stopPropagation();
    const card = star.closest(selector), note = card.querySelector('.market-rating-note');
    const token = sessionStorage.getItem('studentToken');
    if (!token) { note.textContent = 'Sign in as a learner to rate.'; return; }
    star.disabled = true;
    try {
      const response = await fetch(`/marketing/${card.dataset.marketKind}/${card.dataset.marketId}/rating`, {
        method:'PUT', headers:{'Content-Type':'application/json','X-Student-Token':token},
        body:JSON.stringify({stars:Number(star.dataset.stars)})
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'Rating could not be saved');
      cardsFor(card).forEach(other => { other.dataset.marketRating = String(result.rating); other.dataset.marketRatingCount = String(result.rating_count); refresh(other); });
      note.textContent = `Your rating: ${result.your_rating}/5`;
    } catch (error) { note.textContent = error.message; }
    finally { star.disabled = false; }
  });
  new MutationObserver(scheduleScan).observe(document.body, {childList:true, subtree:true});
  scheduleScan();
})();
