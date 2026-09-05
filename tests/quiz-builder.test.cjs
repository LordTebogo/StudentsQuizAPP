const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const read = file => fs.readFileSync(path.join(__dirname, '..', 'static', file), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('workspace layout preserves the functioning quiz builder', async () => {
  const dom = new JSDOM(read('lecturer.html'), {
    url: 'https://example.test/lecturers', runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const w = dom.window;
  try {
    const byId = id => w.document.getElementById(id);
    const click = id => byId(id).click();
    const requests = [];
    let failGeneration = false;
    let drafts = [];
    const quiz = {title: 'Atoms', module_code: 'CHEMISTRY', num_questions: 1,
      questions: [{type: 'mcq', question: 'Which particle has positive charge?',
        options: ['Proton', 'Electron'], correct_answer: 'Proton', marks: 1}]};
    w.sessionStorage.setItem('lecturerToken', 'test-only');
    w.LECTURER_TOKEN = 'test-only';
    w.LECTURER_PROFILE = {full_name: 'Test Tutor', module_codes: ['CHEMISTRY', 'MATH']};
    w.scrollTo = () => {};
    w.HTMLElement.prototype.scrollIntoView = () => {};
    w.confirm = () => true;
    w.formatSAST = value => value;
    w.fetch = async () => ({ok: true, json: async () => w.LECTURER_PROFILE});
    w.api = async (url, options = {}) => {
      requests.push({url, options});
      if (url === '/lecturer/quiz/generate') {
        if (failGeneration) throw new Error('AI service unavailable');
        return quiz;
      }
      if (url === '/lecturer/quizzes/1') return quiz;
      if (url === '/lecturer/quiz-drafts' && options.method === 'POST') {
        drafts = [{id: 1, ...JSON.parse(options.body), question_count: 1, updated_at: '2026-09-05'}];
        return drafts[0];
      }
      if (url === '/lecturer/quiz-drafts') return drafts;
      throw new Error(`Unexpected request: ${url}`);
    };
    // Run the real scripts in the order used by the lecturer page.
    const scripts = [...w.document.querySelectorAll('script[src]')].map(el => el.getAttribute('src').split('?')[0]);
    assert.ok(scripts.indexOf('/static/experience.js') < scripts.indexOf('/static/quiz-builder.js'));
    w.eval(read('experience.js'));
    w.eval(read('quiz-builder.js'));
    await tick();
    assert.ok(byId('quizBuilderCard'), 'layout must preserve the builder root');
    assert.equal(w.document.querySelectorAll('.question-editor').length, 1);
    click('addQuestionBtn');
    assert.equal(w.document.querySelectorAll('.question-editor').length, 2);
    click('previewQuizBtn');
    assert.match(byId('builderMsg').textContent, /title/i);
    byId('builderQuizTitle').value = 'Test quiz';
    byId('aiQuizTopic').value = 'Basic atomic structure';
    byId('aiQuestionCount').value = '1';
    click('generateQuizBtn');
    assert.equal(byId('generateQuizBtn').disabled, true);
    await tick();
    assert.match(byId('aiQuizStatus').textContent, /1 editable questions generated/);
    assert.equal(w.document.querySelectorAll('.question-editor').length, 1);
    assert.equal(JSON.parse(requests.find(r => r.url.endsWith('/generate')).options.body).module_code, 'CHEMISTRY');
    click('previewQuizBtn');
    assert.ok(byId('quizPreviewDialog').hasAttribute('open'));
    click('saveQuizDraftBtn');
    await tick();
    assert.equal(byId('quizDraftSelect').value, '1');
    assert.match(byId('builderMsg').textContent, /draft saved/);
    failGeneration = true;
    click('generateQuizBtn');
    await tick();
    assert.match(byId('builderMsg').textContent, /AI service unavailable/);
    assert.equal(byId('generateQuizBtn').disabled, false);
    assert.equal(w.document.querySelectorAll('.question-editor').length, 1);
    click('newQuizBuilderBtn');
    assert.equal(byId('builderQuizTitle').value, '');
    byId('quizSelect').innerHTML = '<option value="1">Atoms</option>';
    click('duplicateQuizBtn');
    await tick();
    assert.equal(byId('builderQuizTitle').value, 'Atoms — copy');
    assert.equal(w.document.querySelectorAll('.question-editor').length, 1);
  } finally { w.close(); }
});
