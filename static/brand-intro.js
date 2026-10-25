(() => {
  const intro = document.getElementById('brandIntro');
  if (!intro) return;

  let seen = false;
  try { seen = sessionStorage.getItem('arounusIntroSeen') === '1'; } catch (_) {}
  if (seen || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    intro.remove();
    document.body.classList.remove('brand-intro-active');
    return;
  }

  const started = performance.now();
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    try { sessionStorage.setItem('arounusIntroSeen', '1'); } catch (_) {}
    intro.classList.add('is-complete');
    document.body.classList.remove('brand-intro-active');
    window.setTimeout(() => intro.remove(), 450);
  };

  window.addEventListener('load', () => {
    window.setTimeout(finish, Math.max(0, 2200 - (performance.now() - started)));
  }, { once: true });
  window.setTimeout(finish, 3800);
  intro.addEventListener('click', finish);
})();
