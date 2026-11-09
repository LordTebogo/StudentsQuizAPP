const {JSDOM}=require('jsdom');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../static/vacancies.html'),'utf8');
const script=fs.readFileSync(path.join(__dirname,'../static/vacancies.js'),'utf8');

test('vacancies page shows openings safely and has account links',async()=>{
  const dom=new JSDOM(html,{url:'https://arounus.test/vacancies',runScripts:'outside-only'}),w=dom.window;
  w.fetch=async()=>({ok:true,json:async()=>[{id:1,title:'Room agents',summary:'Help people find rooms.',details:'Know your area.',is_open:true},{id:2,title:'<script>alert(1)</script>',summary:'Marketing skills',details:'Grow Arounus.',is_open:true}]});
  w.eval(script);await new Promise(resolve=>setTimeout(resolve,15));
  const d=w.document;
  assert.equal(d.querySelectorAll('.vacancy-card').length,2);
  assert.equal(d.querySelector('.vacancy-card:nth-child(2) h3').textContent,'<script>alert(1)</script>');
  assert.equal(d.querySelector('.vacancy-card script'),null);
  assert.equal(d.querySelector('a[href="/?account=register"]').textContent,'Sign up');
  assert.ok(d.querySelector('a[href="/?account=login"]'));
  assert.match(d.querySelector('.vacancy-card a').href,/subject=Arounus%20vacancy%3A%20Room%20agents/);
  w.close();
});
