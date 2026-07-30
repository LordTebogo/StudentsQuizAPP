(function () {
  if (!document.querySelector('link[href="/static/product.css"]')) {
    const productStyles = document.createElement('link');
    productStyles.rel = 'stylesheet';
    productStyles.href = '/static/product.css';
    document.head.appendChild(productStyles);
  }
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
  const studentToken = sessionStorage.getItem('studentToken');
  const lecturerToken = sessionStorage.getItem('lecturerToken');
  const activeRole = lecturerToken ? 'lecturer' : studentToken ? 'student' : 'public';
  const roleLinks = activeRole === 'lecturer' ? [
    ['/static/index.html', 'Overview'], ['/static/lecturer.html', 'Quizzes'],
    ['/static/lessons_lecturer.html', 'Lessons'], ['/static/live_lesson.html', 'Live classroom'],
  ] : activeRole === 'student' ? [
    ['/static/index.html', 'Home'], ['/static/student.html', 'Quizzes'],
    ['/static/lessons_student.html', 'Lessons'], ['/static/live_lesson.html', 'Live'],
    ['/static/fun.html', 'Community'],
  ] : [
    ['/static/index.html', 'Home'], ['/static/student.html', 'Students'],
    ['/static/lecturer.html', 'Lecturers'], ['/static/marketing.html', 'Market'],
  ];
  const moreLinks = activeRole === 'lecturer' ? [
    ['/static/pdf_tools.html', 'PDF tools'], ['/static/fun.html', 'Community'],
    ['/static/comrade.html', 'SRC'], ['/static/marketing.html', 'Market'],
  ] : activeRole === 'student' ? [
    ['/static/comrade.html', 'SRC'], ['/static/marketing.html', 'Market'],
    ['/static/pdf_tools.html', 'PDF tools'],
  ] : [['/static/fun.html', 'Community'], ['/static/comrade.html', 'SRC']];

  document.querySelectorAll('header.top nav').forEach(nav => {
    nav.classList.add('experience-nav');
    if (nav.closest('#welcome')) {
      let primary=nav.querySelector('.primary-nav-links');
      if(!primary){primary=document.createElement('div');primary.className='primary-nav-links';nav.appendChild(primary)}
      primary.replaceChildren();
      roleLinks.forEach(([href,label])=>{const link=document.createElement('a');link.href=href;link.textContent=label;if(new URL(link.href,location.href).pathname===location.pathname)link.setAttribute('aria-current','page');primary.appendChild(link)});
      const more=document.createElement('a');more.href=activeRole==='lecturer'?'/static/lecturer.html#lecturerMessagesCard':'/static/marketing.html';more.textContent=activeRole==='lecturer'?'Messages':'More';primary.appendChild(more);
      return;
    }
    nav.replaceChildren();
    roleLinks.forEach(([href, label]) => {
      const link = document.createElement('a'); link.href = href; link.textContent = label;
      if (new URL(link.href, location.href).pathname === location.pathname) link.setAttribute('aria-current', 'page');
      nav.appendChild(link);
    });
    const more = document.createElement('details'); more.className = 'nav-more';
    more.innerHTML = '<summary>More</summary><div class="nav-more-menu"></div>';
    const menu = more.querySelector('.nav-more-menu');
    moreLinks.forEach(([href, label]) => { const link=document.createElement('a'); link.href=href; link.textContent=label; menu.appendChild(link); });
    if (activeRole !== 'public') {
      const profile = document.createElement('button'); profile.type='button'; profile.className='nav-profile-button'; profile.textContent='Profile';
      profile.addEventListener('click', () => {
        const existing = document.querySelector('.account-sheet'); if (existing) { existing.remove(); return; }
        const sheet=document.createElement('div'); sheet.className='account-sheet';
        sheet.innerHTML=`<strong>${activeRole==='lecturer'?'Lecturer':'Student'} account</strong><a href="${activeRole==='lecturer'?'/static/lecturer.html':'/static/student.html'}">Profile & settings</a><a href="/static/trust.html#support">Help & support</a><button type="button">Sign out</button>`;
        sheet.querySelector('button').addEventListener('click',()=>{sessionStorage.removeItem(activeRole+'Token');sessionStorage.removeItem('activeRole');location.href='/static/index.html'});
        document.body.appendChild(sheet);
      });
      menu.appendChild(profile);
    }
    nav.appendChild(more);
  });

  if (activeRole !== 'public' && !document.querySelector('.mobile-tabbar')) {
    const mobile = document.createElement('nav'); mobile.className='mobile-tabbar'; mobile.setAttribute('aria-label','Primary mobile navigation');
    const mobileLinks = activeRole === 'lecturer' ? roleLinks : roleLinks.slice(0,4);
    mobileLinks.forEach(([href,label])=>{const a=document.createElement('a');a.href=href;a.textContent=label;if(new URL(a.href,location.href).pathname===location.pathname)a.setAttribute('aria-current','page');mobile.appendChild(a)});
    const moreButton=document.createElement('button');moreButton.type='button';moreButton.textContent='More';moreButton.addEventListener('click',()=>document.querySelector('header.top .nav-more')?.setAttribute('open',''));mobile.appendChild(moreButton);document.body.appendChild(mobile);
  }

  const studentPortal = document.getElementById('studentPortal');
  if (studentPortal && !document.getElementById('studentStatusGrid')) {
    const status=document.createElement('div');status.id='studentStatusGrid';status.className='status-grid';status.innerHTML='<a href="/static/student.html"><span>Continue</span><strong>Quizzes & results</strong><small>Open your modules</small></a><a href="/static/lessons_student.html"><span>Learn</span><strong>Video lessons</strong><small>Resume your learning</small></a><a href="/static/student.html#studentBottomMessages"><span>Inbox</span><strong>Messages</strong><small>View lecturer support</small></a>';studentPortal.querySelector('.role-grid')?.before(status);
  }
  const lecturerPortal = document.getElementById('lecturerPortal');
  if (lecturerPortal && !document.getElementById('lecturerStatusGrid')) {
    const status=document.createElement('div');status.id='lecturerStatusGrid';status.className='status-grid';status.innerHTML='<a href="/static/lecturer.html"><span>Assess</span><strong>Submissions</strong><small>Review student work</small></a><a href="/static/live_lesson.html"><span>Teach</span><strong>Live classroom</strong><small>Start or rejoin a room</small></a><a href="/static/lecturer.html#lecturerMessagesCard"><span>Support</span><strong>Messages</strong><small>Answer students</small></a>';lecturerPortal.querySelector('.role-grid')?.before(status);
  }
  if (location.pathname.endsWith('/lecturer.html') && document.getElementById('appWrap')) {
    const app=document.getElementById('appWrap'), workbench=app.querySelector('.lecturer-workbench');
    if(workbench&&!document.querySelector('.workflow-nav')){const tabs=document.createElement('nav');tabs.className='workflow-nav';tabs.setAttribute('aria-label','Lecturer workspace sections');tabs.innerHTML='<a href="#quizCreate">Create quiz</a><a href="#quizLibrary">Quiz library</a><a href="#submissionsCard">Submissions</a><a href="#lecturerMessagesCard">Messages</a><a href="#myStudentsList">Students</a>';const cards=workbench.querySelectorAll('.card');if(cards[0])cards[0].id='quizCreate';if(cards[1])cards[1].id='quizLibrary';workbench.before(tabs)}
  }
  if (location.pathname.endsWith('/lessons_lecturer.html') && document.getElementById('appWrap')) {
    const app=document.getElementById('appWrap'),cards=[...app.querySelectorAll(':scope > .card')];
    if(cards.length&&!document.querySelector('.workflow-nav')){const tabs=document.createElement('nav');tabs.className='workflow-nav';tabs.setAttribute('aria-label','Lesson workspace sections');tabs.innerHTML='<a href="#lessonCreate">Create lesson</a><a href="#lessonLibrary">Lesson library</a><a href="#submissionsCard">Student answers</a>';cards[0].id='lessonCreate';if(cards[1])cards[1].id='lessonLibrary';app.querySelector('.lede')?.after(tabs)}
  }
  if (location.pathname.endsWith('/student.html') && document.getElementById('appWrap')) {
    const app=document.getElementById('appWrap');
    if(!document.querySelector('.workflow-nav')){const results=[...app.querySelectorAll('.card')].find(card=>card.querySelector('h2')?.textContent.includes('My results'));if(results)results.id='studentResults';const tabs=document.createElement('nav');tabs.className='workflow-nav';tabs.setAttribute('aria-label','Student workspace sections');tabs.innerHTML='<a href="#moduleCard">Quizzes</a><a href="#studentResults">Results</a><a href="#studentBottomMessages">Messages</a><a href="#studentModulePicker">My modules</a>';app.querySelector('.lede')?.after(tabs)}
  }
  if (location.pathname.endsWith('/marketing.html')) {
    const labels={campusFilter:'Campus or university',listingSearch:'Search accommodation',maxRentFilter:'Maximum monthly rent',roomTypeFilter:'Room type'};
    Object.entries(labels).forEach(([id,text])=>{const input=document.getElementById(id);if(!input||input.previousElementSibling?.classList.contains('field-name'))return;const label=document.createElement('label');label.className='field-name';label.htmlFor=id;label.textContent=text;input.before(label)});
  }
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
  if (location.pathname.endsWith('/lessons_student.html') || location.pathname.endsWith('/lessons_lecturer.html')) {
    const insights = document.createElement('script'); insights.src = '/static/lesson-insights.js';
    document.body.appendChild(insights);
  }
})();
