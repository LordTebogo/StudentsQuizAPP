const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const read = name => fs.readFileSync(path.join(__dirname, '../static', name), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('tutor dashboard counts actual records and keeps tools inside main', async () => {
  const dom = new JSDOM(read('lecturer.html'), { url: 'https://arounus.test/lecturers', runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  const w = dom.window;
  try {
    w.sessionStorage.setItem('lecturerToken', 'test-only');
    w.fetch = async () => ({ ok: true, json: async () => ({}) });
    w.scrollTo = () => {};
    w.document.getElementById('myStudentsList').innerHTML = '<p>No enrolled students yet.</p>';
    w.eval(read('experience.js'));
    assert.equal(w.document.getElementById('tutorStatLearners').textContent, '0');
    w.document.getElementById('builderModuleCode').innerHTML = '<option value="">Choose a module</option><option value="MATH">Maths</option>';
    w.document.getElementById('quizSelect').innerHTML = '<option value="">Choose a quiz</option><option value="1">Quiz one</option><option value="2">Quiz two</option>';
    w.document.getElementById('myStudentsList').innerHTML = '<div class="admin-list-item">First learner</div><div class="admin-list-item">Second learner</div>';
    await tick();
    assert.equal(w.document.getElementById('tutorStatModules').textContent, '1');
    assert.equal(w.document.getElementById('tutorStatQuizzes').textContent, '2');
    assert.equal(w.document.getElementById('tutorStatLearners').textContent, '2');
    assert.equal(w.document.getElementById('tutorStatModules').nextElementSibling.textContent, 'Module');
    assert.ok(w.document.querySelector('main #quizBuilderCard'));
    assert.ok(w.document.querySelector('main .tutor-command-center'));
    const optional = w.document.querySelectorAll('.builder-optional-tool');
    assert.equal(optional.length, 3);
    assert.ok([...optional].every(section => !section.open));
  } finally { w.close(); }
});

test('learner workspace no longer inserts the extra overview and navigation', async () => {
  const dom = new JSDOM(read('student.html'), { url: 'https://arounus.test/students', runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  const w = dom.window;
  try {
    w.sessionStorage.setItem('studentToken', 'test-only');
    w.fetch = async () => ({ ok: true, json: async () => ({}) });
    w.scrollTo = () => {};
    w.eval(read('experience.js'));
    await tick();
    assert.equal(w.document.querySelector('.learner-command-center'), null);
    assert.equal(w.document.querySelector('.workflow-nav'), null);
    assert.equal(w.document.querySelector('.learner-tools-grid'), null);
  } finally { w.close(); }
});

test('installed app includes the new math fonts and current asset versions', () => {
  const worker = read('service-worker.js');
  for (const file of ['student.html', 'lecturer.html']) {
    const dom = new JSDOM(read(file));
    const fonts = dom.window.document.querySelector('link[href*="mathlive-fonts.css"]');
    assert.ok(fonts);
    assert.ok(worker.includes(fonts.getAttribute('href')));
    dom.window.close();
  }
  for (const name of ['ui.css', 'quiz-builder.js']) {
    const dom = new JSDOM(read('lecturer.html'));
    const el = dom.window.document.querySelector(`[href*="${name}"], [src*="${name}"]`);
    assert.ok(worker.includes(el.getAttribute('href') || el.getAttribute('src')));
    dom.window.close();
  }
});

test('Premium reconciles a paid first month before displaying the next purchase price', async () => {
  const dom = new JSDOM(read('premium.html'), {url:'https://arounus.test/premium',runScripts:'outside-only',virtualConsole:new VirtualConsole()});
  const w=dom.window;
  try {
    w.sessionStorage.setItem('studentToken','test-only');
    let confirmed=false;
    w.fetch=async (url,options)=>{
      assert.equal(options.headers['X-Student-Token'],'test-only');
      if(url==='/billing/premium/me') {
        confirmed=true;
        return {ok:true,json:async()=>({active:true,lifetime:false})};
      }
      assert.equal(url,'/billing/premium/plans');
      return {ok:true,json:async()=>({plans:[{id:'monthly',label:'30 days',amount_cents:confirmed?5000:1500,introductory:!confirmed}],checkout_available:true,google_pay_available:false})};
    };
    const script=[...w.document.scripts].find(el=>el.textContent.includes('async function load()'));
    w.eval(script.textContent);
    await tick();
    assert.equal(w.document.querySelector('.price').textContent,'R50');
    assert.match(w.document.getElementById('status').textContent,/access is active/);
  } finally {w.close();}
});
