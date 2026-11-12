const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../static/messages.html'),'utf8');
const profile=fs.readFileSync(path.join(__dirname,'../static/profile-menu.js'),'utf8');
const script=fs.readFileSync(path.join(__dirname,'../static/messages-page.js'),'utf8');

for(const [role,url,card,other] of [
  ['student','https://arounus.com/students/messages','studentBottomMessages','lecturerMessagesCard'],
  ['lecturer','https://arounus.com/lecturers/messages','lecturerMessagesCard','studentBottomMessages']
]) test(`${role} messages use a dedicated page with profile menu`,()=>{
  const dom=new JSDOM(html,{url,runScripts:'outside-only'});
  const w=dom.window;
  try {
    w.sessionStorage.setItem(`${role}Token`,'test-token');
    w.fetch=async()=>({ok:true,json:async()=>({full_name:'Test Person',profile_image_url:'/branding/logo'})});
    let installed='';w.ArounusChat={installWorkspace:value=>{installed=value}};
    w.eval(profile);w.eval(script);
    assert.equal(installed,role);
    assert.equal(w.document.getElementById(card).hidden,false);
    assert.equal(w.document.getElementById(other).hidden,true);
    assert.equal(w.document.querySelector('.profile-photo-menu').classList.contains('hidden'),true);
  } finally {w.close()}
});
