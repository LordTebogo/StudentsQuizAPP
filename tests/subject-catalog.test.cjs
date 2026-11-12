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
    assert.equal(rows.length,35);
    assert.equal(new Set(rows.map(row=>row.module_code)).size,rows.length);
    assert.ok(rows.every(row=>row.module_code.startsWith('ARU-')&&row.module_name.endsWith(`(${row.module_code})`)));
    for(const code of ['ARU-HS-GE08','ARU-HS-GE12','ARU-ML-GEN','ARU-ML-MOL','ARU-PM-GEM','ARU-MC-COS'])assert.ok(rows.some(row=>row.module_code===code));
    assert.equal(dom.window.moduleLabel('ARU-HS-PS10'),'Physical Sciences — Grade 10 (ARU-HS-PS10)');
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
