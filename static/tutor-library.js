/* A module-first library for tutors. The existing builder and marking tools stay intact. */
(() => {
  const $ = id => document.getElementById(id);
  const state = {module: '', section: '', sub: '', lessons: []};
  const clean = value => String(value || '').trim();
  const norm = value => clean(value).toLocaleLowerCase();
  const esc = value => escapeHtml(value);
  const name = code => window.moduleLabel?.(code) || code;
  const moduleRows = () => tutorQuizRows.filter(row => row.module_code === state.module);
  const lessonRows = () => state.lessons.filter(row => row.module_code === state.module);
  const sectionFor = row => row.assessment_type === 'exam' ? 'exams' : row.assessment_type === 'test' ? 'tests' : 'quizzes';
  const folder = (title, detail, action, icon='▤') => `<button class="library-folder" type="button" data-tutor-step="${esc(action)}"><span class="folder-mark" aria-hidden="true">${icon}</span><span><strong>${esc(title)}</strong><small>${esc(detail)}</small></span></button>`;
  const pdfCard = () => '<a class="library-folder" href="/tools/pdf"><span class="folder-mark" aria-hidden="true">▤</span><span><strong>PDF tools</strong><small>Open PDF tools</small></span></a>';
  const quizItem = row => `<button class="library-item" type="button" data-library-quiz="${row.id}"><span><strong>${esc(row.title)}</strong><small>${esc(row.topic || name(row.module_code))} · ${row.is_fun ? 'Fun MCQ quiz' : row.assessment_type === 'exam' ? 'Examination' : row.assessment_type === 'test' ? 'Test' : 'Challenging quiz'}</small></span><span>Open →</span></button>`;
  const lessonItem = row => `<a class="library-item" href="/lecturers/lessons?lesson=${encodeURIComponent(row.id)}"><span><strong>${esc(row.title)}</strong><small>${esc(row.topic || 'Other topics')} · Lesson</small></span><span>Open →</span></a>`;
  const syncPath = () => {const url=new URL(location.href);for(const key of ['module','section','folder'])url.searchParams.delete(key);if(state.module)url.searchParams.set('module',state.module);if(state.section)url.searchParams.set('section',state.section);if(state.sub)url.searchParams.set('folder',state.sub);if(url.href!==location.href)history.pushState(null,'',url)};
  const go = (module='', section='', sub='', push=true) => {state.module=module;state.section=section;state.sub=sub;if(push)syncPath();renderTutorQuizLibrary();};
  const restorePath = () => {const params=new URLSearchParams(location.search),module=params.get('module')||'',section=['quizzes','tests','exams','lessons'].includes(params.get('section'))?params.get('section'):'';go(module,section,section?params.get('folder')||'':'',false)};
  const renderCrumbs = () => {
    const crumbs = $('tutorQuizCrumbs'); crumbs.replaceChildren();
    const steps = [{title:'My modules', action:() => go()}];
    if (state.module) steps.push({title:name(state.module), action:() => go(state.module)});
    if (state.section) steps.push({title:({quizzes:'Quizzes',tests:'Tests',exams:'Examinations',lessons:'Lessons'})[state.section],action:() => go(state.module,state.section)});
    if (state.sub) steps.push({title:state.section === 'quizzes' ? (state.sub === 'fun' ? 'MCQ fun quizzes' : 'Challenging quizzes') : state.sub});
    steps.forEach((step,index) => {if(index) crumbs.append(document.createTextNode(' › ')); if (index < steps.length-1) {const button=document.createElement('button');button.type='button';button.textContent=step.title;button.onclick=step.action;crumbs.append(button);} else {const strong=document.createElement('strong');strong.textContent=step.title;crumbs.append(strong);}});
  };
  renderTutorQuizLibrary = function () {
    const folders = $('tutorQuizFolders'), items = $('tutorQuizItems'), query = norm($('tutorLibrarySearch').value);
    if (!folders || !items) return;
    folders.replaceChildren(); items.replaceChildren(); renderCrumbs();
    if (query) {
      const modules = [...new Set([...(window.LECTURER_PROFILE?.module_codes || []), ...tutorQuizRows.map(row=>row.module_code), ...state.lessons.map(row=>row.module_code)])];
      folders.innerHTML = modules.filter(code => norm(name(code)+' '+code).includes(query)).map(code => folder(name(code),'Module',`module:${code}`)).join('');
      items.innerHTML = tutorQuizRows.filter(row => norm(`${row.title} ${row.topic} ${name(row.module_code)}`).includes(query)).map(quizItem).join('') + state.lessons.filter(row => norm(`${row.title} ${row.topic} ${name(row.module_code)}`).includes(query)).map(lessonItem).join('');
    } else if (!state.module) {
      const modules = [...new Set([...(window.LECTURER_PROFILE?.module_codes || []), ...tutorQuizRows.map(row=>row.module_code), ...state.lessons.map(row=>row.module_code)])].sort((a,b)=>name(a).localeCompare(name(b)));
      folders.innerHTML = modules.map(code => folder(name(code),`${tutorQuizRows.filter(row=>row.module_code===code).length} assessment(s) · ${state.lessons.filter(row=>row.module_code===code).length} lesson(s)`,`module:${code}`)).join('') + pdfCard();
    } else if (!state.section) {
      const rows=moduleRows(), lessons=lessonRows();
      folders.innerHTML = folder('Quizzes',`${rows.filter(row=>sectionFor(row)==='quizzes').length} available · MCQ and challenging`,'section:quizzes','✦') + folder('Tests',`${rows.filter(row=>sectionFor(row)==='tests').length} available`,'section:tests','✓') + folder('Examinations',`${rows.filter(row=>sectionFor(row)==='exams').length} available`,'section:exams','▣') + folder('Lessons',`${lessons.length} available · by topic`,'section:lessons','▶');
      const actions=$('tutorModuleActions');if(actions){actions.classList.remove('hidden');actions.querySelector('[data-create-quiz]').onclick=()=>{$('builderModuleCode').value=state.module;document.querySelector('[data-tutor-view="create"]')?.click();};actions.querySelector('[data-create-lesson]').href=`/lecturers/lessons?module=${encodeURIComponent(state.module)}`;}
    } else if (state.section === 'quizzes' && !state.sub) {
      const rows=moduleRows().filter(row=>sectionFor(row)==='quizzes');
      folders.innerHTML=folder('MCQ fun quizzes',`${rows.filter(row=>row.is_fun).length} available`,'sub:fun','✦') + folder('Challenging quizzes',`${rows.filter(row=>!row.is_fun).length} available`,'sub:normal','◆');
    } else if (state.section === 'lessons' && !state.sub) {
      const topics=[...new Set(lessonRows().map(row=>clean(row.topic)||'Other topics'))].sort((a,b)=>a.localeCompare(b));
      folders.innerHTML=topics.map(topic=>folder(topic,`${lessonRows().filter(row=>(clean(row.topic)||'Other topics')===topic).length} lesson(s)`,`topic:${topic}`,'▶')).join('');
    } else if (state.section === 'lessons') {
      items.innerHTML=lessonRows().filter(row=>(clean(row.topic)||'Other topics')===state.sub).map(lessonItem).join('');
    } else {
      items.innerHTML=moduleRows().filter(row=>sectionFor(row)===state.section && (state.section!=='quizzes'||row.is_fun===(state.sub==='fun'))).map(quizItem).join('');
    }
    if (state.section || !state.module) $('tutorModuleActions')?.classList.add('hidden');
    if (!folders.children.length && !items.children.length) items.innerHTML='<p class="muted">Nothing here yet. Use the Create actions to add content.</p>';
  };
  const install = () => {
    if (['#messages','#lecturerMessagesCard'].includes(location.hash)) {location.replace('/lecturers/messages');return;}
    const app=$('appWrap'), library=$('tutorQuizLibrary'); if (!app || !library) return;
    if (app.dataset.tutorLibraryReady) return;
    app.dataset.tutorLibraryReady='true';
    app.querySelector('.tutor-command-center')?.remove();
    app.querySelector('[data-tutor-view-panel="messages"]')?.remove();
    window.addEventListener('hashchange',()=>{if(['#messages','#lecturerMessagesCard'].includes(location.hash))location.replace('/lecturers/messages')});
    app.querySelector('.profile-strip')?.closest('.card')?.classList.add('hidden');
    app.querySelector('.builder-checklist')?.closest('.card')?.remove();
    library.querySelector('h2').textContent='My modules';
    library.querySelector('.library-heading p').textContent='Choose a module or search for a quiz, exam, topic, or lesson.';
    $('tutorLibrarySearch').placeholder='Search modules, topics, quizzes and lessons';
    const actions=document.createElement('div');actions.id='tutorModuleActions';actions.className='tutor-module-actions hidden';actions.innerHTML='<button class="btn" type="button" data-create-quiz>Create quiz in this module</button><a class="btn secondary" data-create-lesson href="/lecturers/lessons">Add lesson</a>'; $('tutorQuizFolders').before(actions);
    const tabs=app.querySelector('.tutor-task-nav'); if (tabs) {tabs.querySelector('[data-tutor-view="library"]').textContent='Modules';tabs.querySelector('[data-tutor-view="create"]').textContent='Create quiz';tabs.querySelector('[data-tutor-view="submissions"]').textContent='Mark work';tabs.querySelector('[data-tutor-view="students"]').textContent='Learners';tabs.querySelector('[data-tutor-view="messages"]').remove();const lesson=document.createElement('a');lesson.href='/lecturers/lessons';lesson.textContent='Add lesson';tabs.append(lesson);const live=document.createElement('a');live.href='/live';live.textContent='Live classroom';tabs.append(live);}
    const nav=app.querySelector('header.top nav'), lock=$('lockBtn');nav.replaceChildren();
    const market=document.createElement('a');market.href='/';market.className='tutor-icon-link';market.textContent='⌂';market.title='Market';market.setAttribute('aria-label','Market');nav.append(market);
    const messages=document.createElement('a');messages.href='/lecturers/messages';messages.className='tutor-icon-link';messages.innerHTML='✉ <span id="tutorUnreadBadge" class="tutor-unread hidden">0</span>';messages.setAttribute('aria-label','Messages');nav.append(messages);
    const editProfile=()=>{$('profileCard').classList.remove('hidden');$('profileCard').scrollIntoView({behavior:'smooth'});};
    window.ArounusProfileMenu?.mount({role:'lecturer',nav,onEdit:editProfile,onSignOut:()=>window.ArounusProfileMenu.signOut('lecturer')});lock.remove();
    if(new URLSearchParams(location.search).get('profile')==='1')editProfile();
    const refreshBadge=async()=>{try{const value=await api('/lecturer/messages/unread',{},true);const badge=$('tutorUnreadBadge');badge.textContent=value.count||0;badge.classList.toggle('hidden',!value.count);}catch(_){}};refreshBadge();setInterval(refreshBadge,60000);
    $('tutorQuizFolders').addEventListener('click',event=>{const action=event.target.closest('[data-tutor-step]')?.dataset.tutorStep;if(!action)return;const [kind,...rest]=action.split(':');const value=rest.join(':');if(kind==='module')go(value);else if(kind==='section')go(state.module,value);else if(kind==='sub'||kind==='topic')go(state.module,state.section,value);});
    $('tutorLibrarySearch').addEventListener('input',renderTutorQuizLibrary);
    window.addEventListener('popstate',restorePath);
    restorePath();
    api('/lecturer/lessons',{},true).then(rows=>{state.lessons=rows;renderTutorQuizLibrary();}).catch(()=>{});
    renderTutorQuizLibrary();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
