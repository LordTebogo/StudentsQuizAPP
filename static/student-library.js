/* The learner library keeps subjects, assessment types and lessons together. */
(() => {
  const byId = id => document.getElementById(id);
  const state = {modules: [], quizzes: new Map(), lessons: new Map(), tutors: new Map(), code: null, tutorId: null, section: null, sub: null};
  const label = code => window.moduleLabel?.(code) || code;
  const clean = value => String(value || '').trim();
  const norm = value => clean(value).toLocaleLowerCase();
  const escape = value => escapeHtml(value);
  const folder = (title, detail, action, icon = '▤') => `<button class="library-folder" type="button" data-action="${action}"><span class="folder-mark" aria-hidden="true">${icon}</span><span><strong>${escape(title)}</strong><small>${escape(detail)}</small></span></button>`;
  const pdfCard = () => '<a class="library-folder" href="/tools/pdf"><span class="folder-mark" aria-hidden="true">▤</span><span><strong>PDF tools</strong><small>Open your PDF tools</small></span></a>';
  const syncPath = () => {
    const url = new URL(location.href);
    for (const key of ['module','tutor','section','folder']) url.searchParams.delete(key);
    if (state.code) url.searchParams.set('module',state.code);
    if (state.tutorId) url.searchParams.set('tutor',String(state.tutorId));
    if (state.section) url.searchParams.set('section',state.section);
    if (state.sub) url.searchParams.set('folder',state.sub);
    if (url.href !== location.href) history.pushState(null,'',url);
  };
  const quizSection = q => q.assessment_type === 'exam' ? 'exams' : q.assessment_type === 'test' ? 'tests' : 'quizzes';
  const queryLessons = code => (state.lessons.get(code) || []).filter(item => !state.tutorId || Number(item.lecturer_id) === state.tutorId);
  const queryQuizzes = code => (state.quizzes.get(code) || []).filter(item => !state.tutorId || Number(item.lecturer_id) === state.tutorId);
  const home = (push = true) => {byId('quizListCard').classList.add('hidden'); byId('moduleCard').classList.remove('hidden'); state.code = null; state.tutorId = null; state.section = null; state.sub = null; if(push)syncPath();};
  const show = (code, section = null, sub = null, push = true) => {
    if (state.code && state.code !== code) state.tutorId = null;
    state.code = code; state.section = section; state.sub = sub;
    if (push) syncPath();
    byId('moduleCard').classList.add('hidden');
    byId('quizListCard').classList.remove('hidden');
    const tutors = state.tutors.get(code) || [];
    const tutor = tutors.find(item => item.id === state.tutorId);
    byId('moduleLabel').textContent = tutor ? `${label(code)} · ${tutor.full_name}` : label(code);
    byId('quizListMsg').textContent = '';
    byId('quizListCard').querySelector('h2').textContent = section ? ({quizzes:'Quizzes', tests:'Tests', exams:'Examinations', lessons:'Lessons'})[section] : label(code);
    const list = byId('quizList');
    list.className = section ? 'library-items' : 'library-folder-grid';
    const trail = byId('libraryTrail');
    if (trail) {
      trail.replaceChildren();
      const steps = [{name:'My modules', open:home}, {name:label(code), open:() => {state.tutorId = null; show(code);}}];
      if (tutor) steps.push({name:tutor.full_name, open:() => show(code)});
      if (section) steps.push({name:({quizzes:'Quizzes',tests:'Tests',exams:'Examinations',lessons:'Lessons'})[section], open:() => show(code,section)});
      if (sub) steps.push({name:section === 'quizzes' ? (sub === 'fun' ? 'MCQ fun quizzes' : 'Challenging quizzes') : sub});
      steps.forEach((step,index) => {if (index) trail.append(document.createTextNode(' › ')); if (step.open && index < steps.length-1) {const button = document.createElement('button'); button.type='button'; button.textContent=step.name; button.onclick=step.open; trail.append(button);} else {const current=document.createElement('strong'); current.textContent=step.name; trail.append(current);}});
    }
    byId('moduleLessonLink')?.remove();
    const quizzes = queryQuizzes(code), lessons = queryLessons(code);
    if (!section && !state.tutorId && tutors.length && code !== 'AROUNUS') {
      list.innerHTML = tutors.map(item => folder(item.full_name, `${item.lesson_count} lesson(s) · ${item.quiz_count} assessment(s)${item.institution ? ' · ' + item.institution : ''}`, `tutor-${item.id}`, '◉')).join('');
      list.querySelectorAll('[data-action]').forEach(button => button.onclick = () => {state.tutorId = Number(button.dataset.action.slice(6)); show(code);});
      return;
    }
    if (!section) {
      const sections = [
        ['quizzes', 'Quizzes', `${quizzes.filter(q => quizSection(q) === 'quizzes').length} available · MCQ and challenging`, '✦'],
        ['tests', 'Tests', `${quizzes.filter(q => quizSection(q) === 'tests').length} available`, '✓'],
        ['exams', 'Examinations', `${quizzes.filter(q => quizSection(q) === 'exams').length} available`, '▣'],
        ['lessons', 'Lessons', `${lessons.length} available · by topic`, '▶']
      ];
      list.innerHTML = sections.map(([key, title, detail, icon]) => folder(title, detail, key, icon)).join('');
      list.querySelectorAll('[data-action]').forEach(button => button.onclick = () => show(code, button.dataset.action));
      return;
    }
    if (section === 'quizzes' && !sub) {
      const fun = quizzes.filter(q => quizSection(q) === 'quizzes' && q.is_fun).length;
      const normal = quizzes.filter(q => quizSection(q) === 'quizzes' && !q.is_fun).length;
      list.className = 'library-folder-grid';
      list.innerHTML = folder('MCQ fun quizzes', `${fun} available · quick practice`, 'fun', '✦') + folder('Challenging quizzes', `${normal} available · deeper practice`, 'normal', '◆');
      list.querySelectorAll('[data-action]').forEach(button => button.onclick = () => show(code, section, button.dataset.action));
      return;
    }
    let rows = section === 'lessons' ? lessons : quizzes.filter(q => quizSection(q) === section && (section !== 'quizzes' || q.is_fun === (sub === 'fun')));
    if (section === 'lessons' && !sub) {
      const topics = [...new Set(rows.map(row => clean(row.topic) || 'Other topics'))].sort((a,b) => a.localeCompare(b));
      list.className = 'library-folder-grid';
      list.innerHTML = topics.map(topic => folder(topic, `${rows.filter(row => (clean(row.topic) || 'Other topics') === topic).length} lesson(s)`, topic, '▶')).join('') || '<p class="muted">No lessons yet in this module.</p>';
      list.querySelectorAll('[data-action]').forEach(button => button.onclick = () => show(code, section, button.dataset.action));
      return;
    }
    if (section === 'lessons') rows = rows.filter(row => (clean(row.topic) || 'Other topics') === sub);
    list.innerHTML = rows.map(row => section === 'lessons'
      ? `<a class="library-item" href="/students/lessons?lesson=${encodeURIComponent(row.id)}"><span><strong>${escape(row.title)}</strong><small>${escape(row.topic || 'Lesson')}</small></span><span>Watch →</span></a>`
      : `<button class="library-item" type="button" data-quiz="${row.id}"><span><strong>${escape(row.title)}</strong><small>${escape(row.topic || label(code))}</small></span><span>${row.completed ? 'Completed' : 'Start →'}</span></button>`).join('') || '<p class="muted">Nothing published here yet.</p>';
    list.querySelectorAll('[data-quiz]').forEach(button => button.onclick = () => loadQuiz(button.dataset.quiz));
  };
  const renderHome = () => {
    const list = byId('moduleList');
    list.classList.add('library-folder-grid');
    list.innerHTML = state.modules.map(module => folder(module.module_name || label(module.module_code), `${module.quiz_count || 0} assessment(s) · ${queryLessons(module.module_code).length} lesson(s)`, module.module_code)).join('') + pdfCard();
    list.querySelectorAll('[data-action]').forEach(button => button.onclick = () => show(button.dataset.action));
    byId('moduleMsg').textContent = state.modules.length ? '' : 'Choose your subjects in your profile to see them here.';
  };
  const search = () => {
    const input = byId('learningSearch'), results = byId('learningSearchResults');
    if (!input || !results) return;
    const term = norm(input.value);
    const kind = byId('learningSearchType')?.value || 'all';
    const suggestions = byId('learningSearchSuggestions');
    const available = [...new Set(state.modules.flatMap(module => [module.module_name || label(module.module_code), module.module_code,
      ...(state.lessons.get(module.module_code) || []).map(row => clean(row.topic)).filter(Boolean),
      ...(state.quizzes.get(module.module_code) || []).map(row => clean(row.topic)).filter(Boolean)]))];
    const choices = available.filter(value => !term || norm(value).includes(term)).slice(0, 8);
    suggestions.innerHTML = choices.map((value, index) => `<button type="button" data-suggestion="${index}">${escape(value)}</button>`).join('');
    suggestions.classList.toggle('hidden', !choices.length);
    suggestions.querySelectorAll('[data-suggestion]').forEach(button => button.onclick = () => {input.value = choices[Number(button.dataset.suggestion)]; search(); input.focus();});
    if (!term) {results.classList.add('hidden'); results.innerHTML = ''; return;}
    const hits = [];
    for (const module of state.modules) {
      const code = module.module_code, name = module.module_name || label(code);
      const moduleMatch = norm(name + ' ' + code).includes(term);
      if (moduleMatch && ['all','module'].includes(kind)) hits.push({title:name, detail:'Module', open:() => show(code)});
      const lessons = state.lessons.get(code) || [], quizzes = state.quizzes.get(code) || [];
      const topics = new Map();
      for (const row of [...lessons, ...quizzes]) {
        const topic = clean(row.topic);
        if (!topic || !(moduleMatch || norm(topic).includes(term))) continue;
        const key = `${norm(topic)}\u0000${row.lecturer_id}`;
        if (!topics.has(key)) topics.set(key, {topic, tutorId:Number(row.lecturer_id), lessons:0, assessments:0});
        topics.get(key)[lessons.includes(row) ? 'lessons' : 'assessments']++;
      }
      if (['all','topic'].includes(kind)) for (const item of topics.values()) {
        const tutor = (state.tutors.get(code) || []).find(person => person.id === item.tutorId);
        hits.push({title:item.topic, detail:`${name} · ${tutor?.full_name || 'Tutor'} · ${item.lessons} lesson(s), ${item.assessments} assessment(s)`,
          open:() => {state.tutorId = item.tutorId; show(code, item.lessons ? 'lessons' : 'quizzes', item.lessons ? item.topic : null);}});
      }
      if (['all','lesson'].includes(kind)) for (const lesson of lessons) if (norm(`${lesson.title} ${lesson.topic} ${name}`).includes(term)) {
        const tutor = (state.tutors.get(code) || []).find(person => person.id === Number(lesson.lecturer_id));
        hits.push({title:lesson.title, detail:`${name} · ${tutor?.full_name || 'Tutor'} · Lesson`, href:`/students/lessons?lesson=${encodeURIComponent(lesson.id)}`});
      }
      if (['all','assessment'].includes(kind)) for (const quiz of quizzes) if (norm(`${quiz.title} ${quiz.topic} ${name}`).includes(term)) {
        const tutor = (state.tutors.get(code) || []).find(person => person.id === Number(quiz.lecturer_id));
        hits.push({title:quiz.title, detail:`${name} · ${tutor?.full_name || 'Tutor'} · ${quizSection(quiz)}`, open:() => loadQuiz(quiz.id)});
      }
    }
    results.classList.remove('hidden');
    results.innerHTML = hits.map((hit,index) => `<${hit.href ? 'a' : 'button'} class="library-item" ${hit.href ? `href="${hit.href}"` : `type="button" data-hit="${index}"`}><span><strong>${escape(hit.title)}</strong><small>${escape(hit.detail)}</small></span><span>Open →</span></${hit.href ? 'a' : 'button'}>`).join('') || '<p class="muted">No match in your available modules. Try another topic or title.</p>';
    results.querySelectorAll('[data-hit]').forEach(button => button.onclick = () => hits[Number(button.dataset.hit)].open());
  };
  loadModules = async function () {
    byId('moduleList').innerHTML = '<p class="muted">Loading your modules…</p>';
    try {
      state.modules = await api('/student/quiz-modules', {}, true);
      const data = await Promise.all(state.modules.map(async module => {
        const code = module.module_code;
        const [quizzes, lessons, tutors] = await Promise.all([
          api(`/student/quizzes/by-module/${encodeURIComponent(code)}`, {}, true).catch(() => []),
          api(`/student/lessons?module_code=${encodeURIComponent(code)}`, {}, true).catch(() => []),
          api(`/student/module-tutors/${encodeURIComponent(code)}`, {}, true).catch(() => [])
        ]);
        return {code, quizzes, lessons, tutors};
      }));
      data.forEach(({code, quizzes, lessons, tutors}) => {state.quizzes.set(code, quizzes); state.lessons.set(code, lessons); state.tutors.set(code, tutors)});
      renderHome(); restorePath(); search();
    } catch (error) {byId('moduleList').innerHTML = `<p class="muted">Could not load modules: ${escape(error.message)}</p>`;}
  };
  const restorePath = () => {
    const params = new URLSearchParams(location.search), code = params.get('module');
    if (!code || !state.modules.some(item => item.module_code === code)) {home(false);return;}
    const tutors = state.tutors.get(code) || [], tutorId = Number(params.get('tutor'));
    state.tutorId = tutors.some(item => item.id === tutorId) ? tutorId : null;
    const section = ['quizzes','tests','exams','lessons'].includes(params.get('section')) ? params.get('section') : null;
    show(code, section, section ? params.get('folder') : null, false);
  };
  loadModule = async code => {state.tutorId = null; show(code);};
  document.addEventListener('DOMContentLoaded', () => {
    if (location.hash === '#studentBottomMessages') {location.replace('/students/messages');return;}
    const app = byId('appWrap'); if (!app) return;
    if (app.dataset.studentLibraryReady) return;
    app.dataset.studentLibraryReady = 'true';
    app.querySelector('.learner-command-center')?.remove();
    app.querySelector('.workflow-nav')?.remove();
    app.querySelector('.learner-tools-grid')?.remove();
    app.querySelector('#mediaToolsCard')?.remove();
    app.querySelector('[aria-labelledby="arounusGuideHeading"]')?.remove();
    [...app.children].find(child => child.tagName === 'H2' && child.textContent === 'Find your quizzes')?.remove();
    [...app.children].find(child => child.classList?.contains('lede'))?.remove();
    app.querySelector('.profile-strip')?.closest('.card')?.classList.add('hidden');
    app.querySelector('header.top').after(byId('moduleCard'));
    const nav = app.querySelector('header.top nav'), lock = byId('lockBtn');
    nav.replaceChildren();
    const market = document.createElement('a'); market.href = '/'; market.className = 'student-icon-link'; market.textContent = '⌂'; market.setAttribute('aria-label', 'Market'); market.title = 'Market'; nav.append(market);
    const messages = document.createElement('a'); messages.href = '/students/messages'; messages.className = 'student-icon-link'; messages.innerHTML = '✉ <span id="studentUnreadBadge" class="student-unread hidden">0</span>'; messages.setAttribute('aria-label', 'Messages'); nav.append(messages);
    const editProfile = () => {byId('studentProfileCard').classList.remove('hidden'); byId('studentProfileCard').scrollIntoView({behavior:'smooth'});};
    window.ArounusProfileMenu?.mount({role:'student',nav,onEdit:editProfile,onSignOut:()=>window.ArounusProfileMenu.signOut('student')});
    lock.remove();
    if (new URLSearchParams(location.search).get('profile') === '1') editProfile();
    const moduleCard = byId('moduleCard'); moduleCard.querySelector('h2').textContent = 'My modules';
    const trail = document.createElement('nav'); trail.id='libraryTrail'; trail.className='library-crumbs'; trail.setAttribute('aria-label','Learning path'); byId('quizList').before(trail);
    const prompt = document.createElement('p'); prompt.className = 'muted'; prompt.textContent = 'Choose a module or search for a lesson, quiz, test, or exam.';
    const addLevel = document.createElement('button'); addLevel.type='button'; addLevel.className='btn secondary'; addLevel.textContent='Add a subject or next level';
    addLevel.onclick = async () => {const result = await window.addStudentModule?.(sessionStorage.getItem('studentToken')); if(result) loadModules();};
    const searchBox = document.createElement('div'); searchBox.className = 'learning-search'; searchBox.innerHTML = '<label for="learningSearch">Find something quickly</label><input id="learningSearch" type="search" placeholder="Search modules, topics, lessons and quizzes" autocomplete="off"><label for="learningSearchType">Filter results</label><select id="learningSearchType"><option value="all">Everything</option><option value="module">Modules</option><option value="topic">Topics and tutors</option><option value="lesson">Lessons</option><option value="assessment">Quizzes, tests and exams</option></select><div id="learningSearchSuggestions" class="learning-suggestions hidden" aria-label="Search suggestions"></div><div id="learningSearchResults" class="library-items hidden" aria-live="polite"></div>';
    moduleCard.querySelector('h2').after(prompt, searchBox, addLevel);
    byId('learningSearch').addEventListener('input', search);
    byId('learningSearch').addEventListener('focus', search);
    byId('learningSearchType').addEventListener('change', search);
    window.addEventListener('popstate', restorePath);
    byId('backBtn').onclick = home;
    const refreshBadge = async () => {try {const result = await api('/student/messages/unread', {}, true); const badge = byId('studentUnreadBadge'); badge.textContent = result.count || 0; badge.classList.toggle('hidden', !result.count);} catch (_) {}};
    refreshBadge(); setInterval(refreshBadge, 60000);
    if (!byId('appWrap').classList.contains('hidden') && !state.modules.length) loadModules();
    const result = byId('resultCard');
    new MutationObserver(async () => {
      if (result.classList.contains('hidden') || !currentQuiz) return;
      const score = byId('scoreStamp')?.textContent?.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
      if (!score || Number(score[2]) === 0 || Number(score[1]) / Number(score[2]) >= .5) return;
      const related = queryLessons(currentQuiz.module_code).find(lesson => norm(lesson.topic) === norm(currentQuiz.topic)) || queryLessons(currentQuiz.module_code)[0];
      if (!related || byId('reviewLessonLink')) return;
      const link = document.createElement('a'); link.id = 'reviewLessonLink'; link.className = 'btn secondary'; link.href = `/students/lessons?lesson=${encodeURIComponent(related.id)}`; link.textContent = `Review lesson: ${related.title}`; result.append(link);
    }).observe(result, {attributes:true, attributeFilter:['class']});
  });
})();
