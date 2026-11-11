const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');

const read = name => fs.readFileSync(path.join(__dirname, '..', 'static', name), 'utf8');
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

test('tutor library separates modules, topics and tests', () => {
  const source = read('lecturer.html').match(/function renderTutorQuizLibrary\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source);
  const dom = new JSDOM('<input id="tutorLibrarySearch"><div id="tutorQuizCrumbs"></div><div id="tutorQuizFolders"></div><div id="tutorQuizItems"></div><select id="quizSelect"><option value="1">One</option></select><div id="tutorQuizDetail" class="hidden"></div>');
  const $ = id => dom.window.document.getElementById(id);
  const library = new Function('$', 'escapeHtml', 'moduleLabel', 'moduleDisplayTitle', 'window', `let tutorQuizRows=[], tutorLibraryModule='', tutorLibraryTopic=''; ${source}; return {set(rows,module='',topic=''){tutorQuizRows=rows;tutorLibraryModule=module;tutorLibraryTopic=topic},render:renderTutorQuizLibrary};`)($, escapeHtml, x => x, x => x, dom.window);
  library.set([{id:1,title:'DNA replication',module_code:'BIO',topic:'DNA replication',assessment_type:'quiz'},{id:2,title:'Final paper',module_code:'BIO',topic:'All topics',assessment_type:'test'},{id:3,title:'Algebra',module_code:'MATH',topic:'Algebra',assessment_type:'quiz'}]);
  library.render();
  assert.deepEqual([...dom.window.document.querySelectorAll('[data-library-module]')].map(el => el.dataset.libraryModule), ['BIO','MATH']);
  library.set([{id:1,title:'DNA replication',module_code:'BIO',topic:'DNA replication',assessment_type:'quiz'},{id:2,title:'Final paper',module_code:'BIO',topic:'All topics',assessment_type:'test'}], 'BIO');
  library.render();
  assert.deepEqual([...dom.window.document.querySelectorAll('[data-library-topic]')].map(el => el.dataset.libraryTopic), ['DNA replication','Tests']);
  library.set([{id:1,title:'DNA replication',module_code:'BIO',topic:'DNA replication',assessment_type:'quiz'},{id:2,title:'Final paper',module_code:'BIO',topic:'All topics',assessment_type:'test'}], 'BIO', 'DNA replication');
  library.render();
  assert.deepEqual([...dom.window.document.querySelectorAll('[data-library-quiz]')].map(el => el.dataset.libraryQuiz), ['1']);
  dom.window.close();
});

test('tutor lesson library opens one topic at a time', () => {
  const source = read('lessons_lecturer.html').match(/function renderTutorLessonLibrary\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source);
  const dom = new JSDOM('<input id="lessonLibrarySearch"><div id="lessonLibraryCrumbs"></div><div id="lessonLibraryFolders"></div><div id="myLessonList"></div><select id="moduleCodeInput"><option value="BIO">Biology</option></select>');
  const $ = id => dom.window.document.getElementById(id);
  const library = new Function('$', 'escapeHtml', 'moduleLabel', 'moduleDisplayTitle', `let tutorLessonRows=[], tutorLessonModule='', tutorLessonTopic=''; ${source}; return {set(rows,module='',topic=''){tutorLessonRows=rows;tutorLessonModule=module;tutorLessonTopic=topic},render:renderTutorLessonLibrary};`)($, escapeHtml, x => x, x => x);
  const rows = [{id:1,title:'Replication video',module_code:'BIO',topic:'DNA replication',question_count:2,submission_count:1},{id:2,title:'Protein video',module_code:'BIO',topic:'Protein synthesis',question_count:3,submission_count:0}];
  library.set(rows);
  library.render();
  assert.deepEqual([...dom.window.document.querySelectorAll('[data-lesson-module]')].map(el => el.dataset.lessonModule), ['BIO']);
  library.set(rows,'BIO'); library.render();
  assert.deepEqual([...dom.window.document.querySelectorAll('[data-lesson-topic]')].map(el => el.dataset.lessonTopic), ['DNA replication','Protein synthesis']);
  library.set(rows,'BIO','DNA replication'); library.render();
  assert.deepEqual([...dom.window.document.querySelectorAll('[data-open-lesson]')].map(el => el.dataset.openLesson), ['1']);
  dom.window.close();
});
