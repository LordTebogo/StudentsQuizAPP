(() => {
  const role = location.pathname.startsWith('/lecturers/') ? 'lecturer' : 'student';
  const token = sessionStorage.getItem(`${role}Token`);
  const back = role === 'student' ? '/students' : '/lecturers';
  if (!token) { location.replace(`/?role=${role}`); return; }
  document.title = `${role === 'student' ? 'Learner' : 'Tutor'} messages — Arounus`;
  document.getElementById('messagesBack').href = back;
  document.getElementById('messagesBack').textContent = role === 'student' ? '← My modules' : '← Tutor modules';
  document.getElementById('studentBottomMessages').hidden = role !== 'student';
  document.getElementById('lecturerMessagesCard').hidden = role !== 'lecturer';
  window.ArounusProfileMenu.mount({
    role, nav:document.getElementById('messagesHeaderNav'),
    onEdit:() => location.assign(`${back}?profile=1`),
    onSignOut:() => {sessionStorage.removeItem(`${role}Token`);if(sessionStorage.getItem('activeRole')===role)sessionStorage.removeItem('activeRole');location.assign(`/?role=${role}`);}
  });
  const install = () => window.ArounusChat?.installWorkspace(role);
  if (window.ArounusChat) install(); else window.addEventListener('load',install,{once:true});
})();
