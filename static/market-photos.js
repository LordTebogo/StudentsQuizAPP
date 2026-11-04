(() => {
  const cache = new Map(), requests = new WeakMap();
  const variant = (source, width) => window.arounusThumb?.(source, width) || source;
  function trim() {
    for (const [key, entry] of cache) {
      if (cache.size <= 24) break;
      if (entry.state !== 'loading') cache.delete(key);
    }
  }
  function load(url, priority = 'low') {
    if (cache.get(url)?.state === 'error') cache.delete(url);
    if (cache.has(url)) {
      const entry = cache.get(url);
      cache.delete(url); cache.set(url, entry);
      if (priority === 'high') entry.image.fetchPriority = 'high';
      return entry;
    }
    const image = new Image();
    image.decoding = 'async'; image.fetchPriority = priority;
    const entry = {image, state: 'loading'};
    cache.set(url, entry);
    entry.promise = new Promise(resolve => {
      image.onload = async () => {
        try { if (image.decode) await image.decode(); } catch {}
        entry.state = 'ready'; trim(); resolve(entry);
      };
      image.onerror = () => { entry.state = 'error'; trim(); resolve(null); };
    });
    image.src = url;
    trim();
    return entry;
  }
  function prepare(gallery, selected = 0) {
    // Small copies finish first, so even a slow full-size request has a fallback.
    gallery.forEach(source => load(variant(source, 160), 'high'));
    [selected, ...gallery.map((_, i) => i).filter(i => i !== selected)].forEach(i => {
      if (gallery[i]) load(variant(gallery[i], 960), i === selected ? 'high' : 'low');
    });
  }
  function show(target, source, {full = false, onReady = () => {}, onError = () => {}} = {}) {
    const previous = requests.get(target);
    const request = {source, rank: previous?.source === source ? previous.rank : 0};
    requests.set(target, request);
    if (!request.rank) target.setAttribute('data-photo-pending', 'true');
    const options = [load(variant(source, 160), 'high'), load(variant(source, 960), 'high')];
    if (full || cache.get(source)?.state === 'ready') options.push(load(source, full ? 'high' : 'low'));
    function apply(entry, rank) {
      if (!entry || requests.get(target) !== request || rank < request.rank) return;
      request.rank = rank;
      if (target.src !== entry.image.src) target.src = entry.image.src;
      target.removeAttribute('data-photo-pending');
      onReady();
    }
    // Synchronous cache hit: clicking an arrow never waits for a new fetch.
    for (let i = options.length - 1; i >= 0; i--) {
      if (options[i].state === 'ready') { apply(options[i], i + 1); break; }
    }
    options.forEach((entry, i) => { entry.promise.then(result => apply(result, i + 1)); });
    Promise.all(options.map(entry => entry.promise)).then(results => {
      if (requests.get(target) === request && !request.rank && results.every(result => !result)) onError();
    });
  }
  function cancel(target) { requests.delete(target); target.removeAttribute('data-photo-pending'); }
  window.ArounusPhotos = {prepare, show, cancel, displayUrl: source => variant(source, 960)};
  document.addEventListener('market-listing-opened', () => {
    const details = document.getElementById('offerDetails');
    const main = details?.querySelector('.offer-gallery-main');
    if (!main) return;
    try {
      const gallery = JSON.parse(details.dataset.gallery || '[]');
      const index = Number(details.dataset.galleryIndex || 0);
      prepare(gallery, index); show(main, gallery[index]);
    } catch {}
  });
})();
