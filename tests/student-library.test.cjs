const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');

test('student library starts with modules, keeps PDF last, and links lessons by topic', async () => {
  const dom = new JSDOM(`<!doctype html><main id="appWrap" class="hidden"><header class="top"><nav><a id="lockBtn">Lock</a></nav></header><div class="card"><div class="profile-strip"></div></div><section id="studentProfileCard" class="hidden"></section><h2>Find your quizzes</h2><p class="lede">Old intro</p><section id="moduleCard"><h2>Choose a module</h2><div id="moduleList"></div><div id="moduleMsg"></div></section><section id="quizListCard" class="hidden"><div><h2>Available quizzes</h2><span id="moduleLabel"></span><button id="backBtn"></button></div><div id="quizList"></div><div id="quizListMsg"></div></section><section id="resultCard" class="hidden"><div id="scoreStamp"></div></section><section id="studentBottomMessages"></section></main>`, {url:'https://arounus.com/students', runScripts:'outside-only'});
  const {window} = dom;
  window.escapeHtml = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  window.moduleLabel = code => code === 'PHY' ? 'Physics' : code;
  window.loadModules = async () => {};
  window.loadModule = async () => {};
  window.loadQuiz = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.api = async route => {
    if (route === '/student/quiz-modules') return [{module_code:'PHY',module_name:'Physics',quiz_count:1}];
    if (route.includes('/student/quizzes/by-module/')) return [{id:7,title:'Forces quiz',topic:'Forces',assessment_type:'quiz',is_fun:true}];
    if (route.includes('/student/lessons?')) return [{id:9,title:'Forces lesson',topic:'Forces'}];
    if (route === '/student/messages/unread') return {count:2};
    return [];
  };
  window.eval(fs.readFileSync(path.join(__dirname,'../static/profile-menu.js'),'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname,'../static/student-library.js'),'utf8'));
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await window.loadModules();
  const modules = [...window.document.querySelectorAll('#moduleList button')];
  assert.deepEqual(modules.map(button => button.querySelector('strong').textContent), ['Physics','PDF tools']);
  modules[0].click();
  assert.match(window.document.getElementById('quizList').textContent, /Quizzes.*Tests.*Examinations.*Lessons/);
  [...window.document.querySelectorAll('#quizList button')].find(button => button.textContent.includes('Lessons')).click();
  assert.match(window.document.getElementById('quizList').textContent, /Forces/);
  window.document.querySelector('#quizList button').click();
  assert.equal(window.document.querySelector('#quizList a').getAttribute('href'), '/students/lessons?lesson=9');
  assert.equal(window.document.getElementById('studentUnreadBadge').textContent, '2');
  assert.equal(window.document.querySelector('a[aria-label="Messages"]').getAttribute('href'),'/students/messages');
  window.document.querySelector('.profile-photo-button').click();
  assert.equal(window.document.querySelector('.profile-photo-menu').classList.contains('hidden'),false);
  window.document.querySelector('[data-profile-edit]').click();
  assert.equal(window.document.getElementById('studentProfileCard').classList.contains('hidden'),false);
  window.close();
});

test('student chooses a tutor before seeing that tutor’s subject content', async () => {
  const dom = new JSDOM(`<!doctype html><main id="appWrap" class="hidden"><header class="top"><nav><a id="lockBtn">Lock</a></nav></header><section id="studentProfileCard"></section><section id="moduleCard"><h2>Modules</h2><div id="moduleList"></div><div id="moduleMsg"></div></section><section id="quizListCard" class="hidden"><h2></h2><span id="moduleLabel"></span><div id="quizList"></div><div id="quizListMsg"></div><button id="backBtn"></button></section><section id="resultCard" class="hidden"></section></main>`, {url:'https://arounus.com/students',runScripts:'outside-only'});
  const w=dom.window;
  w.escapeHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;');
  w.moduleLabel=code=>code;
  w.loadModules=async()=>{}; w.loadModule=async()=>{}; w.loadQuiz=()=>{};
  w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.api=async route=>{
    if(route==='/student/quiz-modules')return [{module_code:'PHY',module_name:'Physics',quiz_count:2}];
    if(route.includes('module-tutors'))return [{id:1,full_name:'Tutor A',lesson_count:1,quiz_count:1},{id:2,full_name:'Tutor B',lesson_count:1,quiz_count:1}];
    if(route.includes('quizzes/by-module'))return [{id:11,title:'A quiz',lecturer_id:1},{id:22,title:'B quiz',lecturer_id:2}];
    if(route.includes('/student/lessons?'))return [{id:31,title:'A lesson',topic:'One',lecturer_id:1},{id:32,title:'B lesson',topic:'Two',lecturer_id:2}];
    if(route==='/student/messages/unread')return {count:0};
    return [];
  };
  w.eval(fs.readFileSync(path.join(__dirname,'../static/profile-menu.js'),'utf8'));
  w.eval(fs.readFileSync(path.join(__dirname,'../static/student-library.js'),'utf8'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await w.loadModules();
  w.document.querySelector('#moduleList button').click();
  assert.match(w.document.querySelector('#quizList').textContent,/Tutor A.*Tutor B/);
  w.document.querySelector('#quizList [data-action="tutor-1"]').click();
  [...w.document.querySelectorAll('#quizList button')].find(button=>button.textContent.includes('Lessons')).click();
  assert.match(w.document.querySelector('#quizList').textContent,/One/);
  assert.doesNotMatch(w.document.querySelector('#quizList').textContent,/Two/);
  w.close();
});

test('modules load when the account request finishes before search is mounted', async () => {
  const dom = new JSDOM('<!doctype html><main id="appWrap"><header class="top"><nav><a id="lockBtn">Lock</a></nav></header><section id="studentProfileCard"></section><section id="moduleCard"><h2>Choose a module</h2><div id="moduleList"></div><div id="moduleMsg"></div></section><section id="quizListCard" class="hidden"><h2></h2><span id="moduleLabel"></span><div id="quizList"></div><div id="quizListMsg"></div><button id="backBtn"></button></section><section id="resultCard" class="hidden"></section></main>',{url:'https://arounus.com/students',runScripts:'outside-only'});
  const w=dom.window;
  w.escapeHtml=value=>String(value);
  w.moduleLabel=code=>code;
  w.api=async route=>route==='/student/quiz-modules'?[{module_code:'PHY',module_name:'Physics',quiz_count:0}]:[];
  w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.eval(fs.readFileSync(path.join(__dirname,'../static/profile-menu.js'),'utf8'));
  w.eval(fs.readFileSync(path.join(__dirname,'../static/student-library.js'),'utf8'));
  await w.loadModules();
  assert.match(w.document.querySelector('#moduleList').textContent,/Physics/);
  assert.doesNotMatch(w.document.querySelector('#moduleList').textContent,/Could not load modules/);
  w.close();
});
