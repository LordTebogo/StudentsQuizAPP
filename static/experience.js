(function () {
  const friendlyPaths = {
    '/static/index.html': '/',
    '/static/student.html': '/students',
    '/static/lecturer.html': '/lecturers',
    '/static/lessons_student.html': '/students/lessons',
    '/static/lessons_lecturer.html': '/lecturers/lessons',
    '/static/live_lesson.html': '/live',
    '/static/fun.html': '/community',
    '/static/marketing.html': '/market',
    '/static/admin.html': '/admin',
    '/static/pdf_tools.html': '/tools/pdf',
    '/static/trust.html': '/trust',
  };
  const legacyPaths = Object.fromEntries(Object.entries(friendlyPaths).map(([legacy, friendly]) => [friendly, legacy]));
  const pagePath = legacyPaths[location.pathname] || location.pathname;
  const cleanPath = path => friendlyPaths[path] || path;
  if (!document.querySelector('link[href="/static/product.css"]')) {
    const productStyles = document.createElement('link');
    productStyles.rel = 'stylesheet';
    productStyles.href = '/static/product.css';
    document.head.appendChild(productStyles);
  }
  const body = document.body;
  if (!body) return;
  body.classList.add('nucleocampus-ui');
  document.querySelectorAll('#appWrap .profile-strip').forEach(strip => strip.closest('.card')?.classList.add('hidden'));
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
  const adminPin = sessionStorage.getItem('lecturerPin');
  const activeRole = pagePath.endsWith('/admin.html') && adminPin ? 'admin' : lecturerToken ? 'lecturer' : studentToken ? 'student' : 'public';
  const activeSessionKey = activeRole === 'admin' ? 'lecturerPin' : activeRole + 'Token';
  const roleLinks = activeRole === 'admin' ? [
    ['/static/admin.html#adminOverview', 'Overview'], ['/static/admin.html#adminContent', 'Content'],
    ['/static/admin.html#adminPeople', 'Users'], ['/static/admin.html#marketAdvertAdmin', 'Approvals'],
  ] : activeRole === 'lecturer' ? [
    ['/static/index.html', 'Overview'], ['/static/lecturer.html', 'Quizzes'],
    ['/static/lessons_lecturer.html', 'Lessons'], ['/static/live_lesson.html', 'Live classroom'],
  ] : activeRole === 'student' ? [
    ['/static/index.html', 'Home'], ['/static/student.html', 'Quizzes'],
    ['/static/lessons_student.html', 'Lessons'], ['/static/live_lesson.html', 'Live'],
    ['/static/fun.html', 'Community'],
  ] : [
    ['/static/index.html', 'Home'], ['/static/student.html', 'Learners'],
    ['/static/lecturer.html', 'Tutors'], ['/static/marketing.html', 'Market'],
  ];
  const moreLinks = activeRole === 'admin' ? [
    ['/static/admin.html#liveMonitorCard','Live sessions'], ['/static/admin.html#adminScripts','Submissions'],
    ['/static/admin.html#adminModeration','Moderation'], ['/static/trust.html#support','Support'],
  ] : activeRole === 'lecturer' ? [
    ['/static/pdf_tools.html', 'PDF tools'], ['/static/fun.html', 'Community'],
    ['/static/marketing.html', 'Market'],
  ] : activeRole === 'student' ? [
    ['/static/marketing.html', 'Market'], ['/static/pdf_tools.html', 'PDF tools'],
  ] : [['/static/fun.html', 'Community']];
  function toggleMobileMenu(open) {
    let sheet=document.querySelector('.mobile-more-sheet'),scrim=document.querySelector('.mobile-more-scrim');
    if(!sheet){scrim=document.createElement('button');scrim.type='button';scrim.className='mobile-more-scrim';scrim.setAttribute('aria-label','Close menu');sheet=document.createElement('section');sheet.className='mobile-more-sheet';sheet.setAttribute('aria-label','More navigation');const all=[...moreLinks];if(activeRole!=='public')all.push([activeRole==='admin'?'/static/admin.html':activeRole==='lecturer'?'/static/lecturer.html':'/static/student.html',activeRole==='admin'?'Administration overview':'Profile & settings'],['/static/trust.html#support','Help & support']);sheet.innerHTML='<div class="mobile-sheet-handle"></div><div class="mobile-sheet-head"><strong>More</strong><button type="button" aria-label="Close menu">×</button></div><nav></nav>';const list=sheet.querySelector('nav');all.forEach(([href,label])=>{const a=document.createElement('a');a.href=href;a.textContent=label;list.appendChild(a)});if(activeRole!=='public'){const signout=document.createElement('button');signout.type='button';signout.className='mobile-signout';signout.textContent=activeRole==='admin'?'Lock administration':'Sign out';signout.addEventListener('click',()=>{sessionStorage.removeItem(activeSessionKey);sessionStorage.removeItem('activeRole');location.href=activeRole==='admin'?'/static/admin.html':'/static/index.html'});list.appendChild(signout)}document.body.append(scrim,sheet);scrim.addEventListener('click',()=>toggleMobileMenu(false));sheet.querySelector('.mobile-sheet-head button').addEventListener('click',()=>toggleMobileMenu(false))}
    const shouldOpen=open===undefined?!sheet.classList.contains('open'):open;sheet.classList.toggle('open',shouldOpen);scrim.classList.toggle('open',shouldOpen);document.body.classList.toggle('menu-open',shouldOpen);
  }

  document.querySelectorAll('header.top nav').forEach(nav => {
    nav.classList.add('experience-nav');
    if (nav.closest('#welcome')) {
      let primary=nav.querySelector('.primary-nav-links');
      if(!primary){primary=document.createElement('div');primary.className='primary-nav-links';nav.appendChild(primary)}
      primary.replaceChildren();
      roleLinks.forEach(([href,label])=>{const link=document.createElement('a');link.href=href;link.textContent=label;if(cleanPath(new URL(link.href,location.href).pathname)===cleanPath(location.pathname))link.setAttribute('aria-current','page');primary.appendChild(link)});
      const more=document.createElement('a');more.href=activeRole==='lecturer'?'/static/lecturer.html#lecturerMessagesCard':'/static/marketing.html';more.textContent=activeRole==='lecturer'?'Messages':'More';primary.appendChild(more);
      return;
    }
    nav.replaceChildren();
    roleLinks.forEach(([href, label]) => {
      const link = document.createElement('a'); link.href = href; link.textContent = label;
      if (cleanPath(new URL(link.href, location.href).pathname) === cleanPath(location.pathname)) link.setAttribute('aria-current', 'page');
      nav.appendChild(link);
    });
    const more = document.createElement('details'); more.className = 'nav-more';
    more.innerHTML = '<summary>More</summary><div class="nav-more-menu"></div>';
    more.querySelector('summary').addEventListener('click',event=>{if(matchMedia('(max-width:820px)').matches){event.preventDefault();more.removeAttribute('open');toggleMobileMenu(true)}});
    const menu = more.querySelector('.nav-more-menu');
    moreLinks.forEach(([href, label]) => { const link=document.createElement('a'); link.href=href; link.textContent=label; menu.appendChild(link); });
    if (activeRole === 'admin') {
      const profile = document.createElement('button'); profile.type='button'; profile.className='nav-profile-button'; profile.textContent='Profile';
      profile.addEventListener('click', () => {
        const existing = document.querySelector('.account-sheet'); if (existing) { existing.remove(); return; }
        const sheet=document.createElement('div'); sheet.className='account-sheet';
        sheet.innerHTML=`<strong>${activeRole==='admin'?'Administrator':activeRole==='lecturer'?'Tutor':'Learner'} account</strong><a href="${activeRole==='admin'?'/static/admin.html':activeRole==='lecturer'?'/static/lecturer.html':'/static/student.html'}">${activeRole==='admin'?'Administration overview':'Profile & settings'}</a><a href="/static/trust.html#support">Help & support</a><button type="button">${activeRole==='admin'?'Lock administration':'Sign out'}</button>`;
        sheet.querySelector('button').addEventListener('click',()=>{sessionStorage.removeItem(activeSessionKey);sessionStorage.removeItem('activeRole');location.href=activeRole==='admin'?'/static/admin.html':'/static/index.html'});
        document.body.appendChild(sheet);
      });
      menu.appendChild(profile);
    }
    nav.appendChild(more);
    if ((activeRole === 'student' || activeRole === 'lecturer') && nav.closest('#appWrap')) {
      const avatarButton=document.createElement('button');avatarButton.type='button';avatarButton.className='nav-account-avatar';avatarButton.setAttribute('aria-label','Open profile menu');avatarButton.setAttribute('aria-haspopup','menu');
      const avatar=document.createElement('img');avatar.src='/branding/logo';avatar.alt='';avatarButton.appendChild(avatar);nav.appendChild(avatarButton);
      const sourceImage=document.getElementById(activeRole==='student'?'studentImage':'profileImage');
      const syncAvatar=()=>{if(sourceImage?.getAttribute('src'))avatar.src=sourceImage.src};syncAvatar();
      if(sourceImage)new MutationObserver(syncAvatar).observe(sourceImage,{attributes:true,attributeFilter:['src']});
      const profileEndpoint=activeRole==='student'?'/student/me':'/lecturer/me';
      const profileHeader=activeRole==='student'?{'X-Student-Token':studentToken}:{'X-Lecturer-Token':lecturerToken};
      fetch(profileEndpoint,{headers:profileHeader}).then(response=>response.ok?response.json():null).then(profile=>{if(profile?.profile_image_url)avatar.src=profile.profile_image_url;avatarButton.dataset.accountName=profile?.full_name||''}).catch(()=>{});
      const openProfileEditor=()=>{const editor=document.getElementById(activeRole==='student'?'studentProfileCard':'profileCard');if(!editor){location.href=activeRole==='student'?'/static/student.html#edit-profile':'/static/lecturer.html#edit-profile';return}editor.classList.remove('hidden');history.replaceState(history.state,'',`${location.pathname}${location.search}#edit-profile`);requestAnimationFrame(()=>editor.scrollIntoView({behavior:'smooth',block:'start'}))};
      avatarButton.addEventListener('click',event=>{event.stopPropagation();const existing=document.querySelector('.account-sheet');if(existing){existing.remove();return}const sheet=document.createElement('div');sheet.className='account-sheet';sheet.setAttribute('role','menu');sheet.innerHTML='<strong></strong><button class="account-edit-profile" type="button">Edit profile</button><a href="/static/trust.html#support">Help & support</a><button class="account-signout" type="button">Sign out</button>';sheet.querySelector('strong').textContent=avatarButton.dataset.accountName||`${activeRole==='lecturer'?'Tutor':'Learner'} account`;sheet.querySelector('.account-edit-profile').addEventListener('click',()=>{sheet.remove();openProfileEditor()});sheet.querySelector('.account-signout').addEventListener('click',()=>{sessionStorage.removeItem(activeSessionKey);sessionStorage.removeItem('activeRole');location.href='/static/index.html'});document.body.appendChild(sheet)});
      document.addEventListener('click',event=>{const sheet=document.querySelector('.account-sheet');if(sheet&&!sheet.contains(event.target)&&!avatarButton.contains(event.target))sheet.remove()});
      if(location.hash==='#edit-profile')requestAnimationFrame(openProfileEditor);
    }
  });

  if (activeRole !== 'public' && !document.querySelector('.mobile-tabbar')) {
    const mobile = document.createElement('nav'); mobile.className='mobile-tabbar'; mobile.setAttribute('aria-label','Primary mobile navigation');
    const mobileLinks = activeRole === 'lecturer' ? roleLinks : roleLinks.slice(0,4);
    mobileLinks.forEach(([href,label])=>{const a=document.createElement('a');a.href=href;a.textContent=label;if(cleanPath(new URL(a.href,location.href).pathname)===cleanPath(location.pathname))a.setAttribute('aria-current','page');mobile.appendChild(a)});
    const moreButton=document.createElement('button');moreButton.type='button';moreButton.textContent='More';moreButton.setAttribute('aria-haspopup','dialog');moreButton.addEventListener('click',()=>toggleMobileMenu());mobile.appendChild(moreButton);document.body.appendChild(mobile);
  }

  const studentPortal = document.getElementById('studentPortal');
  if (studentPortal && !document.getElementById('studentStatusGrid')) {
    const status=document.createElement('div');status.id='studentStatusGrid';status.className='status-grid';status.innerHTML='<a href="/static/student.html"><span>Continue</span><strong>Quizzes & results</strong><small>Open your modules</small></a><a href="/static/lessons_student.html"><span>Learn</span><strong>Video lessons</strong><small>Resume your learning</small></a><a href="/static/student.html#studentBottomMessages"><span>Inbox</span><strong>Messages</strong><small>View tutor support</small></a>';studentPortal.querySelector('.role-grid')?.before(status);
  }
  const lecturerPortal = document.getElementById('lecturerPortal');
  if (lecturerPortal && !document.getElementById('lecturerStatusGrid')) {
    const status=document.createElement('div');status.id='lecturerStatusGrid';status.className='status-grid';status.innerHTML='<a href="/static/lecturer.html"><span>Assess</span><strong>Submissions</strong><small>Review student work</small></a><a href="/static/live_lesson.html"><span>Teach</span><strong>Live classroom</strong><small>Start or rejoin a room</small></a><a href="/static/lecturer.html#lecturerMessagesCard"><span>Support</span><strong>Messages</strong><small>Answer students</small></a>';lecturerPortal.querySelector('.role-grid')?.before(status);
  }
  if (pagePath.endsWith('/lecturer.html') && document.getElementById('appWrap')) {
    const app=document.getElementById('appWrap'), workbench=app.querySelector('.lecturer-workbench');
    if(workbench&&!document.querySelector('.workflow-nav')){const tabs=document.createElement('nav');tabs.className='workflow-nav';tabs.setAttribute('aria-label','Tutor workspace sections');tabs.innerHTML='<a href="#quizCreate">Create quiz</a><a href="#quizLibrary">Quiz library</a><a href="#submissionsCard">Submissions</a><a href="#lecturerMessagesCard">Messages</a><a href="#myStudentsList">Students</a>';const cards=workbench.querySelectorAll('.card');if(cards[0])cards[0].id='quizCreate';if(cards[1])cards[1].id='quizLibrary';workbench.before(tabs)}
  }
  if (pagePath.endsWith('/lessons_lecturer.html') && document.getElementById('appWrap')) {
    const app=document.getElementById('appWrap'),cards=[...app.querySelectorAll(':scope > .card')];
    if(cards.length&&!document.querySelector('.workflow-nav')){const tabs=document.createElement('nav');tabs.className='workflow-nav';tabs.setAttribute('aria-label','Lesson workspace sections');tabs.innerHTML='<a href="#lessonCreate">Create lesson</a><a href="#lessonLibrary">Lesson library</a><a href="#submissionsCard">Student answers</a>';cards[0].id='lessonCreate';if(cards[1])cards[1].id='lessonLibrary';app.querySelector('.lede')?.after(tabs)}
  }
  if (pagePath.endsWith('/student.html') && document.getElementById('appWrap')) {
    const app=document.getElementById('appWrap');
    if(!document.querySelector('.workflow-nav')){const results=[...app.querySelectorAll('.card')].find(card=>card.querySelector('h2')?.textContent.includes('My results'));if(results)results.id='studentResults';const tabs=document.createElement('nav');tabs.className='workflow-nav';tabs.setAttribute('aria-label','Student workspace sections');tabs.innerHTML='<a href="#moduleCard">Quizzes</a><a href="#studentResults">Results</a><a href="#studentBottomMessages">Messages</a><a href="#studentModulePicker">My modules</a>';app.querySelector('.lede')?.after(tabs)}
  }
  if (pagePath.endsWith('/admin.html') && document.getElementById('appWrap')) {
    const app=document.getElementById('appWrap'),heading=app.querySelector('h1'),lede=app.querySelector('.lede');if(heading)heading.id='adminOverview';
    const findCard=text=>[...app.querySelectorAll('.card')].find(card=>card.querySelector('h2')?.textContent.includes(text));
    const quizCard=findCard('Quizzes');if(quizCard?.parentElement)quizCard.parentElement.id='adminContent';const people=findCard('Tutor management');if(people)people.id='adminPeople';const scripts=findCard('All student scripts');if(scripts)scripts.id='adminScripts';const moderation=findCard('Community moderation');if(moderation)moderation.id='adminModeration';
    if(lede&&!document.getElementById('adminDashboard')){const dashboard=document.createElement('section');dashboard.id='adminDashboard';dashboard.className='admin-dashboard';dashboard.innerHTML='<div class="admin-stat"><span>Live now</span><strong id="dashLive">0</strong><small>active classrooms</small></div><div class="admin-stat"><span>Approvals</span><strong id="dashApprovals">—</strong><small>adverts awaiting review</small></div><div class="admin-stat"><span>Students</span><strong id="dashStudents">—</strong><small>registered accounts</small></div><div class="admin-stat"><span>Content</span><strong id="dashContent">—</strong><small>quizzes and lessons</small></div>';lede.after(dashboard);const setCounter=(id,value)=>{const element=document.getElementById(id),next=String(value);if(element&&element.textContent!==next)element.textContent=next};const update=()=>{const live=document.getElementById('activeLiveCount')?.textContent||'0',pending=[...document.querySelectorAll('[data-admin-ad] .status-chip')].filter(e=>e.textContent.trim()==='pending').length,students=typeof studentAdminRows!=='undefined'&&studentAdminRows.length?studentAdminRows.length:document.querySelectorAll('#studentList .account-row').length,content=document.querySelectorAll('#quizList .admin-list-item,#lessonList .admin-list-item').length;setCounter('dashLive',live);setCounter('dashApprovals',pending);setCounter('dashStudents',students);setCounter('dashContent',content)};let updateQueued=false;const scheduleUpdate=()=>{if(updateQueued)return;updateQueued=true;requestAnimationFrame(()=>{updateQueued=false;update()})};new MutationObserver(scheduleUpdate).observe(app,{childList:true,subtree:true});update()}
    if(!document.getElementById('adminActivity')){const activity=document.createElement('section');activity.id='adminActivity';activity.className='card admin-activity';activity.innerHTML='<span class="kicker">Accountability</span><h2>Recent activity</h2><p class="muted">Actions taken in this administrator session.</p><div id="adminActivityList" class="admin-list"><p class="muted">No actions yet.</p></div>';app.appendChild(activity);const render=()=>{const rows=JSON.parse(sessionStorage.getItem('adminSessionActivity')||'[]');document.getElementById('adminActivityList').innerHTML=rows.length?rows.map(row=>`<div class="activity-row"><strong>${row.action}</strong><span>${row.time}</span></div>`).join(''):'<p class="muted">No actions yet.</p>'};app.addEventListener('click',event=>{const button=event.target.closest('button');if(!button||button.classList.contains('card-toggle')||button.id==='refreshLiveSessionsBtn')return;const label=button.textContent.trim().replace(/\s+/g,' ').slice(0,80);if(!label)return;const rows=JSON.parse(sessionStorage.getItem('adminSessionActivity')||'[]');rows.unshift({action:label,time:new Date().toLocaleString()});sessionStorage.setItem('adminSessionActivity',JSON.stringify(rows.slice(0,20)));render()});render()}
    const searchable=[['quizList','Search quizzes'],['lessonList','Search lessons'],['lecturerList','Search lecturers'],['adminScriptsList','Search submissions']];searchable.forEach(([id,placeholder])=>{const list=document.getElementById(id);if(!list||document.querySelector(`[data-search-for="${id}"]`))return;const input=document.createElement('input');input.type='search';input.className='admin-inline-search';input.dataset.searchFor=id;input.placeholder=placeholder;input.setAttribute('aria-label',placeholder);list.before(input);const apply=()=>{const query=input.value.trim().toLowerCase();[...list.children].forEach(row=>row.classList.toggle('hidden',Boolean(query&&!row.textContent.toLowerCase().includes(query))))};input.addEventListener('input',apply);new MutationObserver(apply).observe(list,{childList:true})});
  }
  if (pagePath.endsWith('/marketing.html')) {
    const labels={campusFilter:'Campus or university',maxRentFilter:'Maximum monthly rent',roomFilter:'Room type'};
    Object.entries(labels).forEach(([id,text])=>{const input=document.getElementById(id);if(!input||input.previousElementSibling?.classList.contains('field-name'))return;const label=document.createElement('label');label.className='field-name';label.htmlFor=id;label.textContent=text;input.before(label)});
    const tools=document.querySelector('.market-tools'),feed=document.getElementById('listingFeed');
    if(tools&&!tools.closest('.market-filter-panel')){const panel=document.createElement('section');panel.className='market-filter-panel';panel.innerHTML='<div class="market-filter-head"><div><span class="market-kicker">Find accommodation</span><h2>Search and filter</h2></div><button type="button" class="filter-collapse" aria-expanded="true">Hide filters</button></div><div class="market-filter-fields"></div>';tools.before(panel);panel.querySelector('.market-filter-fields').appendChild(tools);panel.querySelector('.filter-collapse').addEventListener('click',event=>{const collapsed=panel.classList.toggle('filters-collapsed');event.currentTarget.setAttribute('aria-expanded',String(!collapsed));event.currentTarget.textContent=collapsed?'Show filters':'Hide filters'})}
    if(feed&&!document.querySelector('.market-results-head')){const head=document.createElement('div');head.className='market-results-head';head.innerHTML='<div><span id="marketResultCount">Loading places…</span><small>Verified landlord-managed listings</small></div><label>Sort by<select id="marketSort"><option value="recommended">Recommended</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="name">Name</option></select></label>';feed.before(head);const update=()=>{const cards=[...feed.querySelectorAll('.listing-card')],visible=cards.filter(card=>!card.classList.contains('hidden'));document.getElementById('marketResultCount').textContent=`${visible.length} ${visible.length===1?'place':'places'} found`;cards.forEach(card=>{if(card.querySelector('.listing-facts'))return;const location=card.querySelector('.location')?.textContent.split('·').map(part=>part.trim()).filter(Boolean)||[];if(location.length){const facts=document.createElement('div');facts.className='listing-facts';facts.innerHTML=location.slice(0,3).map(value=>`<span>${value.replace(/[<>&]/g,'')}</span>`).join('');card.querySelector('.listing-meta')?.after(facts)}})};const sort=()=>{const mode=document.getElementById('marketSort').value,cards=[...feed.querySelectorAll('.listing-card')];cards.sort((a,b)=>{if(mode==='name')return(a.querySelector('h2')?.textContent||'').localeCompare(b.querySelector('h2')?.textContent||'');const price=card=>Number((card.querySelector('.rent')?.textContent||'').replace(/[^0-9]/g,''))||Number.MAX_SAFE_INTEGER;if(mode==='price-low')return price(a)-price(b);if(mode==='price-high')return price(b)-price(a);return 0});cards.forEach(card=>feed.appendChild(card));update()};document.getElementById('marketSort').addEventListener('change',sort);new MutationObserver(update).observe(feed,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});update()}
  }
  const messagingAssets = {
    '/static/student.html': '/static/student-messaging.js',
    '/static/lecturer.html': '/static/lecturer-messaging.js',
    '/static/admin.html': '/static/admin-messaging.js',
  };
  const messagingScript = messagingAssets[pagePath];
  if (messagingScript) {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet'; stylesheet.href = '/static/messaging.css';
    document.head.appendChild(stylesheet);
    const script = document.createElement('script'); script.src = messagingScript;
    document.body.appendChild(script);
  }
  if (pagePath.endsWith('/lessons_student.html') || pagePath.endsWith('/lessons_lecturer.html')) {
    const insights = document.createElement('script'); insights.src = '/static/lesson-insights.js';
    document.body.appendChild(insights);
  }
  document.querySelectorAll('a[href]').forEach(link => {
    const target = new URL(link.getAttribute('href'), location.href);
    if (target.origin !== location.origin || !friendlyPaths[target.pathname]) return;
    link.href = `${friendlyPaths[target.pathname]}${target.search}${target.hash}`;
  });
  const friendlyPath = friendlyPaths[location.pathname];
  if (friendlyPath) history.replaceState(history.state, '', `${friendlyPath}${location.search}${location.hash}`);
})();
