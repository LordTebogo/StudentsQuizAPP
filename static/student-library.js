/* The learner library keeps subjects, assessment types and lessons together. */
(() => {
  const byId = id => document.getElementById(id);
  const state = {modules: [], quizzes: new Map(), lessons: new Map(), code: null, section: null};
  const label = code => window.moduleLabel?.(code) || code;
  const clean = value => String(value || '').trim();
  const norm = value => clean(value).toLocaleLowerCase();
  const escape = value => escapeHtml(value);
  const folder = (title, detail, action, icon = '▤') => `<button class="library-folder" type="button" data-action="${action}"><span class="folder-mark" aria-hidden="true">${icon}</span><span><strong>${escape(title)}</strong><small>${escape(detail)}</small></span></button>`;
  const quizSection = q => q.assessment_type === 'exam' ? 'exams' : q.assessment_type === 'test' ? 'tests' : 'quizzes';
  const queryLessons = code => (state.lessons.get(code) || []);
  const queryQuizzes = code => (state.quizzes.get(code) || []);
  const home = () => {byId('quizListCard').classList.add('hidden'); byId('moduleCard').classList.remove('hidden'); state.code = null; state.section = null;};
  const show = (code, section = null, sub = null) => {
    state.code = code; state.section = section;
    byId('moduleCard').classList.add('hidden');
    byId('quizListCard').classList.remove('hidden');
    byId('moduleLabel').textContent = label(code);
    byId('quizListMsg').textContent = '';
    byId('quizListCard').querySelector('h2').textContent = section ? ({quizzes:'Quizzes', tests:'Tests', exams:'Examinations', lessons:'Lessons'})[section] : label(code);
    const list = byId('quizList');
    list.className = section ? 'library-items' : 'library-folder-grid';
    const trail = byId('libraryTrail');
    if (trail) {
      trail.replaceChildren();
      const steps = [{name:'My modules', open:home}, {name:label(code), open:() => show(code)}];
      if (section) steps.push({name:({quizzes:'Quizzes',tests:'Tests',exams:'Examinations',lessons:'Lessons'})[section], open:() => show(code,section)});
      if (sub) steps.push({name:section === 'quizzes' ? (sub === 'fun' ? 'MCQ fun quizzes' : 'Challenging quizzes') : sub});
      steps.forEach((step,index) => {if (index) trail.append(document.createTextNode(' › ')); if (step.open && index < steps.length-1) {const button = document.createElement('button'); button.type='button'; button.textContent=step.name; button.onclick=step.open; trail.append(button);} else {const current=document.createElement('strong'); current.textContent=step.name; trail.append(current);}});
    }
    byId('moduleLessonLink')?.remove();
    const quizzes = queryQuizzes(code), lessons = queryLessons(code);
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
    list.innerHTML = state.modules.map(module => folder(module.module_name || label(module.module_code), `${module.quiz_count || 0} assessment(s) · ${queryLessons(module.module_code).length} lesson(s)`, module.module_code)).join('') + folder('PDF tools', 'Open your PDF tools', 'pdf', '▤');
    list.querySelectorAll('[data-action]').forEach(button => button.onclick = () => button.dataset.action === 'pdf' ? location.assign('/tools/pdf') : show(button.dataset.action));
    byId('moduleMsg').textContent = state.modules.length ? '' : 'Choose your subjects in your profile to see them here.';
  };
  const search = () => {
    const term = norm(byId('learningSearch').value);
    const results = byId('learningSearchResults');
    if (!term) {results.classList.add('hidden'); results.innerHTML = ''; return;}
    const hits = [];
    for (const module of state.modules) {
      const code = module.module_code, name = module.module_name || label(code);
      if (norm(name + ' ' + code).includes(term)) hits.push({title:name, detail:'Module', open:() => show(code)});
      for (const lesson of queryLessons(code)) if (norm(`${lesson.title} ${lesson.topic} ${name}`).includes(term)) hits.push({title:lesson.title, detail:`${name} · Lesson · ${lesson.topic || 'Other topics'}`, href:`/students/lessons?lesson=${encodeURIComponent(lesson.id)}`});
      for (const quiz of queryQuizzes(code)) if (norm(`${quiz.title} ${quiz.topic} ${name}`).includes(term)) hits.push({title:quiz.title, detail:`${name} · ${quizSection(quiz)}`, open:() => loadQuiz(quiz.id)});
    }
    results.classList.remove('hidden');
    results.innerHTML = hits.slice(0, 30).map((hit,index) => `<${hit.href ? 'a' : 'button'} class="library-item" ${hit.href ? `href="${hit.href}"` : `type="button" data-hit="${index}"`}><span><strong>${escape(hit.title)}</strong><small>${escape(hit.detail)}</small></span><span>Open →</span></${hit.href ? 'a' : 'button'}>`).join('') || '<p class="muted">No match yet. Try a module, topic, or title.</p>';
    results.querySelectorAll('[data-hit]').forEach(button => button.onclick = () => hits[Number(button.dataset.hit)].open());
  };
  loadModules = async function () {
    byId('moduleList').innerHTML = '<p class="muted">Loading your modules…</p>';
    try {
      state.modules = await api('/student/quiz-modules', {}, true);
      const data = await Promise.all(state.modules.map(async module => {
        const code = module.module_code;
        const [quizzes, lessons] = await Promise.all([
          api(`/student/quizzes/by-module/${encodeURIComponent(code)}`, {}, true).catch(() => []),
          api(`/student/lessons?module_code=${encodeURIComponent(code)}`, {}, true).catch(() => [])
        ]);
        return {code, quizzes, lessons};
      }));
      data.forEach(({code, quizzes, lessons}) => {state.quizzes.set(code, quizzes); state.lessons.set(code, lessons)});
      renderHome(); search();
    } catch (error) {byId('moduleList').innerHTML = `<p class="muted">Could not load modules: ${escape(error.message)}</p>`;}
  };
  loadModule = async code => show(code);
  document.addEventListener('DOMContentLoaded', () => {
    const app = byId('appWrap'); if (!app) return;
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
    const messages = document.createElement('button'); messages.type = 'button'; messages.className = 'student-icon-link'; messages.innerHTML = '✉ <span id="studentUnreadBadge" class="student-unread hidden">0</span>'; messages.setAttribute('aria-label', 'Messages'); nav.append(messages);
    messages.onclick = () => {const card = byId('studentBottomMessages'); if (!card) return; card.classList.toggle('hidden'); if (!card.classList.contains('hidden')) card.scrollIntoView({behavior:'smooth'});};
    const profile = document.createElement('button'); profile.type = 'button'; profile.className = 'student-icon-link'; profile.textContent = 'Profile'; profile.onclick = () => {byId('studentProfileCard').classList.toggle('hidden'); byId('studentProfileCard').scrollIntoView({behavior:'smooth'});}; nav.append(profile);
    lock.textContent = 'Sign out'; nav.append(lock);
    const messagesCard = byId('studentBottomMessages'); if (messagesCard) messagesCard.classList.add('hidden');
    const moduleCard = byId('moduleCard'); moduleCard.querySelector('h2').textContent = 'My modules';
    const trail = document.createElement('nav'); trail.id='libraryTrail'; trail.className='library-crumbs'; trail.setAttribute('aria-label','Learning path'); byId('quizList').before(trail);
    const prompt = document.createElement('p'); prompt.className = 'muted'; prompt.textContent = 'Choose a module or search for a lesson, quiz, test, or exam.';
    const searchBox = document.createElement('div'); searchBox.className = 'learning-search'; searchBox.innerHTML = '<label for="learningSearch">Find something quickly</label><input id="learningSearch" type="search" placeholder="Search modules, topics, lessons and quizzes" autocomplete="off"><div id="learningSearchResults" class="library-items hidden" aria-live="polite"></div>';
    moduleCard.querySelector('h2').after(prompt, searchBox);
    byId('learningSearch').addEventListener('input', search);
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
