(() => {
  let clickedControl = null;
  const activeRequests = new Map();
  const nativeFetch = window.fetch.bind(window);

  function startLoading(control) {
    if (!control || control.dataset.noLoading !== undefined) return;
    const current = activeRequests.get(control);
    if (current) {
      current.count += 1;
      return;
    }
    const state = {
      count: 1,
      html: control.innerHTML,
      disabled: control.disabled,
      ariaBusy: control.getAttribute('aria-busy'),
    };
    activeRequests.set(control, state);
    control.classList.add('is-fetching');
    control.setAttribute('aria-busy', 'true');
    if ('disabled' in control) control.disabled = true;
    control.textContent = control.dataset.loadingText || 'Fetching…';
  }

  function stopLoading(control) {
    const state = activeRequests.get(control);
    if (!state) return;
    state.count -= 1;
    if (state.count > 0) return;
    activeRequests.delete(control);
    control.innerHTML = state.html;
    control.classList.remove('is-fetching');
    if ('disabled' in control) control.disabled = state.disabled;
    if (state.ariaBusy === null) control.removeAttribute('aria-busy');
    else control.setAttribute('aria-busy', state.ariaBusy);
  }

  document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const navigation = event.target.closest('a[href]');
    if (navigation && !navigation.getAttribute('href').startsWith('#') && !navigation.hasAttribute('download')) {
      navigation.classList.add('is-navigating');
      navigation.setAttribute('aria-busy', 'true');
    }
    const control = event.target.closest('button, .module-card, .lesson-list-item, [role="button"]');
    if (!control || control.disabled || control.dataset.noLoading !== undefined) return;
    control.classList.add('button-pending');
    window.setTimeout(() => control.classList.remove('button-pending'), 700);
    clickedControl = control;
    queueMicrotask(() => {
      if (clickedControl === control) clickedControl = null;
    });
  }, true);

  window.fetch = async (...args) => {
    const control = clickedControl;
    clickedControl = null;
    if (control) startLoading(control);
    try {
      return await nativeFetch(...args);
    } finally {
      if (control) stopLoading(control);
    }
  };
})();
