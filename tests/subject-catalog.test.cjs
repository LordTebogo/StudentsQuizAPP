const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');

test('Arounus catalog has unique school and varsity codes with full labels',()=>{
  const dom=new JSDOM('',{url:'https://arounus.com',runScripts:'outside-only'});
  try {
    dom.window.eval(fs.readFileSync(path.join(__dirname,'../static/module-names.js'),'utf8'));
    const rows=dom.window.moduleCatalog;
    assert.equal(rows.length,99);
    assert.equal(new Set(rows.map(row=>row.module_code)).size,rows.length);
    assert.ok(rows.every(row=>row.module_code.startsWith('ARU-')&&row.module_name.endsWith(`(${row.module_code})`)));
    for(const code of ['ARU-HS-GE08','ARU-HS-GE12','ARU-ML-GEN-Y1','ARU-ML-MOL-H1','ARU-PM-GEM-FY','ARU-MC-COS-Y3'])assert.ok(rows.some(row=>row.module_code===code));
    assert.equal(dom.window.moduleLabel('ARU-HS-PS10'),'Physical Sciences — Grade 10 (ARU-HS-PS10)');
    assert.equal(dom.window.moduleLabel('ARU-ML-BCH-Y1'),'Fundamentals of Biochemistry — 1st year (ARU-ML-BCH-Y1)');
    assert.equal(dom.window.moduleLabel('ARU-ML-BCH-H1'),'Biochemistry Research — Honours (ARU-ML-BCH-H1)');
    const university=rows.filter(row=>row.subject);
    assert.equal(new Set(university.map(row=>row.subject)).size,16);
    for(const subject of new Set(university.map(row=>row.subject)))assert.deepEqual([...university.filter(row=>row.subject===subject).map(row=>row.level)],['1st year','2nd year','3rd year','Final year','Honours']);
  } finally {dom.window.close()}
});

test('tutor can search and choose more than one subject during registration',async()=>{
  const dom=new JSDOM('<div data-module-picker></div>',{url:'https://arounus.com',runScripts:'outside-only'});
  const w=dom.window;
  try {
    w.fetch=async()=>({ok:true,json:async()=>[
      {module_code:'ARU-HS-PS10',module_name:'Physical Sciences — Grade 10 (ARU-HS-PS10)',group:'High school · Grades 10–12'},
      {module_code:'ARU-ML-GEN',module_name:'Genetics (ARU-ML-GEN)',group:'University · Molecular and Life Sciences'}
    ]});
    w.eval(fs.readFileSync(path.join(__dirname,'../static/module-picker.js'),'utf8'));
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    await new Promise(resolve=>setImmediate(resolve));
    const host=w.document.querySelector('[data-module-picker]');
    const checks=[...host.querySelectorAll('input[type=checkbox]')];
    assert.equal(checks.length,2);
    checks.forEach(check=>{check.checked=true});
    assert.deepEqual(Array.from(w.ArounusModulePicker.selected(host)),['ARU-HS-PS10','ARU-ML-GEN']);
    const search=host.querySelector('input[type=search]');search.value='genetics';search.dispatchEvent(new w.Event('input'));
    assert.equal(host.querySelectorAll('.module-picker-option:not([hidden])').length,1);
  } finally {w.close()}
});

test('learner can add the next university level without losing earlier levels',async()=>{
  const dom=new JSDOM('<!doctype html><body></body>',{url:'https://arounus.com/students',runScripts:'outside-only'});
  const w=dom.window,requests=[];
  w.fetch=async (route,options={})=>{requests.push({route,options});return {ok:true,json:async()=>options.method==='POST'?{completed:true,module_codes:['ARU-ML-BCH-Y1','ARU-ML-BCH-Y2']}:{completed:true,module_codes:['ARU-ML-BCH-Y1'],available_modules:[
    {module_code:'ARU-ML-BCH-Y1',module_name:'Fundamentals of Biochemistry — 1st year (ARU-ML-BCH-Y1)',group:'University · Molecular and Life Sciences · 1st year'},
    {module_code:'ARU-ML-BCH-Y2',module_name:'Introduction to Biochemistry — 2nd year (ARU-ML-BCH-Y2)',group:'University · Molecular and Life Sciences · 2nd year'}]}}};
  try{
    w.eval(fs.readFileSync(path.join(__dirname,'../static/student-module-enrollment.js'),'utf8'));
    const pending=w.addStudentModule('student-token');
    await new Promise(resolve=>setImmediate(resolve));
    const checks=[...w.document.querySelectorAll('#moduleEnrollmentList input[type=checkbox]')];
    assert.deepEqual(checks.map(input=>input.value),['ARU-ML-BCH-Y2']);
    checks[0].click();
    w.document.querySelector('.module-enrollment-save').click();
    const result=await pending;
    assert.deepEqual(result.module_codes,['ARU-ML-BCH-Y1','ARU-ML-BCH-Y2']);
    assert.equal(requests[1].route,'/student/modules/add');
    assert.equal(requests[1].options.method,'POST');
  }finally{w.close()}
});
