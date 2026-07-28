(function () {
  const body = document.body;
  if (!body) return;
  body.classList.add('nucleocampus-ui');
  document.querySelectorAll('.brand').forEach(brand => {
    brand.innerHTML = 'Nucleo<span>Campus</span>';
    brand.setAttribute('aria-label', 'NucleoCampus');
  });
  if (!document.title.includes('NucleoCampus')) document.title += ' — NucleoCampus';
  const main = document.querySelector('main, .wrap, .market-wrap');
  if (main && !main.id) main.id = 'main-content';
  if (main) {
    const skip = document.createElement('a');
    skip.className = 'skip-link';
    skip.href = '#' + main.id;
    skip.textContent = 'Skip to main content';
    body.prepend(skip);
  }
  document.querySelectorAll('header.top nav').forEach(nav => {
    nav.classList.add('experience-nav');
    const links = [
      ['/static/index.html', 'Home'],
      ['/static/student.html', 'Learning'],
      ['/static/lessons_student.html', 'Lessons'],
      ['/static/fun.html', 'Community'],
      ['/static/comrade.html', 'SRC'],
      ['/static/marketing.html', 'Market'],
    ];
    const lecturer = sessionStorage.getItem('lecturerToken');
    links.forEach(([href, label]) => {
      if (lecturer && (label === 'Learning' || label === 'Lessons')) return;
      if ([...nav.querySelectorAll('a')].some(a => a.getAttribute('href') === href)) return;
      const a = document.createElement('a');
      a.href = href;
      a.textContent = lecturer && label === 'Learning' ? 'Teaching' : label;
      nav.appendChild(a);
    });
    [...nav.querySelectorAll('a')].forEach(a => {
      if (new URL(a.href, location.href).pathname === location.pathname) a.setAttribute('aria-current', 'page');
    });
    if (nav.closest('#welcome') && !nav.querySelector('.primary-nav-links')) {
      const primary = document.createElement('div');
      primary.className = 'primary-nav-links';
      [...nav.children].filter(element => element.tagName === 'A').forEach(link => primary.appendChild(link));
      nav.appendChild(primary);
    }
  });
  const messagingAssets = {
    '/static/student.html': '/static/student-messaging.js',
    '/static/lecturer.html': '/static/lecturer-messaging.js',
    '/static/admin.html': '/static/admin-messaging.js',
  };
  const messagingScript = messagingAssets[location.pathname];
  if (messagingScript) {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet'; stylesheet.href = '/static/messaging.css';
    document.head.appendChild(stylesheet);
    const script = document.createElement('script'); script.src = messagingScript;
    document.body.appendChild(script);
  }
})();
