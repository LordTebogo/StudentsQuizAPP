const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('profile sign out clears every account session and returns to role sign in',()=>{
  const values=new Map([['studentToken','student'],['lecturerToken','tutor'],['landlordToken','market'],['activeRole','student']]);
  const redirects=[];
  const context={window:{},sessionStorage:{removeItem:key=>values.delete(key)},location:{replace:url=>redirects.push(url)}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../static/profile-menu.js'),'utf8'),context);
  context.window.ArounusProfileMenu.signOut('student');
  assert.equal(values.size,0);
  assert.deepEqual(redirects,['/?role=learner']);
});
