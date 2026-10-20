const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'static/pdf_tools.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const organizer = fs.readFileSync(path.join(root, 'static/document-organizer.js'), 'utf8');
function workspace() {
  const dom = new JSDOM(html, {url:'https://app.test/tools/pdf', runScripts:'outside-only'});
  const w = dom.window;
  w.sessionStorage.setItem('studentToken','test');
  w.URL.createObjectURL = () => 'blob:test'; w.URL.revokeObjectURL = () => {};
  w.HTMLDialogElement.prototype.showModal = function(){ this.open = true; };
  w.HTMLDialogElement.prototype.close = function(){ this.open = false; this.dispatchEvent(new w.Event('close')); };
  w.eval(scripts.join('\n') + '\n' + organizer + `;window.seedTestPages=()=>{organizerFiles=[new File(['pdf'],'test.pdf')];pageItems=[0,1,2].map(i=>({id:String(i),fileIndex:0,pageIndex:i,fileName:'test.pdf',rotation:0,thumbnail:'data:image/png;base64,'}));renderPagePreview()};window.testRotations=()=>pageItems.map(p=>p.rotation);`);
  return w;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function seed(w) {
  w.seedTestPages();
}
test('all inline scripts and the organizer parse', () => {
  scripts.forEach(code => new vm.Script(code)); new vm.Script(organizer);
});
test('multi-select rotate remove and undo preserve output state', () => {
  const w = workspace(); seed(w);
  w.document.querySelector('#selectPages').click();
  w.document.querySelector('#rotatePages').click();
  assert.deepEqual(Array.from(w.testRotations()), [90,90,90]);
  w.document.querySelector('#removePages').click();
  assert.equal(w.document.querySelectorAll('.page-card').length,0);
  w.document.querySelector('#undoPages').click();
  assert.equal(w.document.querySelectorAll('.page-card').length,3);
  w.document.querySelector('#undoPages').click();
  assert.deepEqual(Array.from(w.testRotations()), [0,0,0]);
  w.close();
});
test('selected export sends only selected pages and locks editing until completion', async () => {
  const w=workspace();seed(w);
  w.document.querySelector('[data-select]').click();
  let finish, sent;
  w.fetch = (url,options) => { sent=options.body.get('page_order'); return new Promise(resolve=>{finish=resolve;}); };
  w.document.querySelector('#extractPages').click();
  assert.equal(sent,'[[0,0,0]]');
  assert.equal(w.document.querySelector('#clearOrganizer').disabled,true);
  assert.equal(w.document.querySelector('[data-remove]').disabled,true);
  finish({ok:true,blob:async()=>new w.Blob(['pdf'],{type:'application/pdf'}),headers:{get:()=>null}});
  await tick();await tick();
  assert.equal(w.document.querySelector('#clearOrganizer').disabled,false);
  assert.match(w.document.querySelector('#organizerStatus').textContent,/Done/);
  w.close();
});
test('cancel aborts a conversion and restores form controls', async () => {
  const w=workspace();let signal;
  w.fetch=(url,options)=>new Promise((resolve,reject)=>{signal=options.signal;signal.addEventListener('abort',()=>reject(new w.DOMException('Cancelled','AbortError')));});
  const form=w.document.querySelector('#convertForm');
  const pending=w.runTool(form,'/document-tools/convert','test.pdf');
  form.querySelector('.processing-panel button').click();
  await pending;
  assert.equal(signal.aborted,true);
  assert.equal(form.querySelector('select').disabled,false);
  assert.match(form.textContent,/cancelled/i);
  w.close();
});
test('Office previews use authenticated server rendering and ZIP uses details label', async () => {
  const w=workspace();let called;
  w.fetch=async(url,options)=>{called={url,options};return {ok:true,blob:async()=>new w.Blob(['pdf'],{type:'application/pdf'}),headers:{get:()=>null}};};
  // The server-rendered PDF uses the same portable canvas viewer as PDF results.
  w.renderPdfPreview=async(result,body)=>{body.innerHTML='<canvas aria-label="PDF preview"></canvas>';};
  await w.previewPrepared({filename:'editable.docx',blob:new w.Blob(['docx']),type:'application/octet-stream'});
  assert.equal(called.url,'/document-tools/preview-office');
  assert.equal(called.options.headers['X-Student-Token'],'test');
  assert.ok(w.document.querySelector('#resultPreviewBody canvas'));
  w.showPreparedResult(w.document.querySelector('#organizerStatus'),{filename:'split.zip',blob:new w.Blob(['zip']),url:'blob:test'});
  assert.equal(w.document.querySelector('.preview-result').textContent,'File details');
  w.close();
});
