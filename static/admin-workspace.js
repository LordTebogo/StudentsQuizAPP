(() => {
  const descriptions = {
    overview: ['Overview', 'Your workspaces, live activity, and the next task at a glance.'],
    learning: ['Learning content', 'Manage quizzes, lessons, and learner scripts.'],
    people: ['People & access', 'Support learners, tutors, and every registered account.'],
    community: ['Community', 'Review posts and keep discussions welcoming.'],
    market: ['Campus market', 'Review rooms and manage marketplace listings.'],
    finance: ['Finance', 'Track media costs and promotion income.']
  };
  let current = 'overview';
  window.showAdminArea = (area, scroll = true) => {
    if (!descriptions[area]) return;
    current = area;
    document.querySelectorAll('[data-admin-area]').forEach(panel => {
      panel.hidden = panel.dataset.adminArea !== area;
    });
    document.querySelectorAll('[data-admin-nav]').forEach(button => {
      const active = button.dataset.adminNav === area;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    document.getElementById('adminAreaTitle').textContent = descriptions[area][0];
    document.getElementById('adminAreaDescription').textContent = descriptions[area][1];
    if (location.hash !== `#${area}`) history.replaceState(null, '', `#${area}`);
    if (scroll && !document.getElementById('appWrap').classList.contains('hidden')) {
      document.querySelector('.admin-intro').scrollIntoView({behavior:'smooth', block:'start'});
    }
  };
  document.querySelectorAll('[data-admin-nav]').forEach(button => button.addEventListener('click', () => showAdminArea(button.dataset.adminNav)));
  document.querySelectorAll('[data-admin-go]').forEach(button => button.addEventListener('click', () => showAdminArea(button.dataset.adminGo)));
  const market = document.getElementById('marketAdvertAdmin');
  if (market) { market.classList.add('admin-panel'); market.dataset.adminArea = 'market'; }
  const observer = new MutationObserver(() => {
    const newMarket = document.getElementById('marketAdvertAdmin');
    if (newMarket && !newMarket.dataset.adminArea) {
      newMarket.classList.add('admin-panel'); newMarket.dataset.adminArea = 'market'; newMarket.hidden = current !== 'market';
    }
  });
  observer.observe(document.getElementById('appWrap'), {childList:true, subtree:true});
  const initial = location.hash.slice(1);
  showAdminArea(descriptions[initial] ? initial : 'overview', false);
})();
