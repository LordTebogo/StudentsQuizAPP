const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');

test('tutor library starts with modules and opens assessment and lesson folders', async () => {
  const html = `<!doctype html><main id="appWrap"><header class="top"><nav><a id="lockBtn">Lock</a></nav></header><div class="card"><div class="profile-strip"></div></div><section id="profileCard" class="hidden"></section><nav class="tutor-task-nav"><button data-tutor-view="library"></button><button data-tutor-view="create"></button><button data-tutor-view="submissions"></button><button data-tutor-view="students"></button><button data-tutor-view="messages"></button></nav><section id="tutorQuizLibrary"><div class="library-heading"><h2>Quiz library</h2><p></p></div><input id="tutorLibrarySearch"><div id="tutorQuizCrumbs"></div><div id="tutorQuizFolders"></div><div id="tutorQuizItems"></div></section><select id="builderModuleCode"><option value="PHY">Physics</option></select></main>`;
  const dom = new JSDOM(html,{url:'https://arounus.com/lecturers',runScripts:'outside-only'});
  const w=dom.window;
  try {
  w.escapeHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  w.moduleLabel=code=>code==='PHY'?'Physics':code;
  w.LECTURER_PROFILE={module_codes:['PHY']};
  w.api=async route=>route==='/lecturer/lessons'?[{id:9,title:'Forces lesson',module_code:'PHY',topic:'Forces'}]:{count:0};
  w.eval('let tutorQuizRows = [{id:7,title:"Forces quiz",module_code:"PHY",topic:"Forces",assessment_type:"quiz",is_fun:true}]; function renderTutorQuizLibrary(){};' + fs.readFileSync(path.join(__dirname,'../static/tutor-library.js'),'utf8'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await new Promise(resolve=>setImmediate(resolve));
  const root=[...w.document.querySelectorAll('#tutorQuizFolders button')];
  assert.deepEqual(root.map(button=>button.querySelector('strong').textContent),['Physics','PDF tools']);
  root[0].click();
  assert.match(w.document.getElementById('tutorQuizFolders').textContent,/Quizzes.*Tests.*Examinations.*Lessons/);
  assert.equal(w.document.querySelector('[data-create-lesson]').getAttribute('href'),'/lecturers/lessons?module=PHY');
  [...w.document.querySelectorAll('#tutorQuizFolders button')].find(button=>button.textContent.includes('Lessons')).click();
  w.document.querySelector('#tutorQuizFolders button').click();
  assert.equal(w.document.querySelector('#tutorQuizItems a').getAttribute('href'),'/lecturers/lessons?lesson=9');
  } finally { w.close(); }
});
