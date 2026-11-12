window.ArounusProfileMenu = {
  mount({role, nav, onEdit, onSignOut}) {
    const wrapper = document.createElement('div');
    wrapper.className = 'profile-menu-wrap';
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'profile-photo-button';
    button.setAttribute('aria-label', 'Open profile menu');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = '<img src="/branding/logo" alt="My profile picture">';
    const menu = document.createElement('div'); menu.className = 'profile-photo-menu hidden';
    menu.innerHTML = '<button type="button" data-profile-edit>Edit profile</button><button type="button" data-profile-signout>Sign out</button>';
    wrapper.append(button, menu); nav.append(wrapper);
    const close = () => {menu.classList.add('hidden');button.setAttribute('aria-expanded','false')};
    button.addEventListener('click', () => {const open=menu.classList.toggle('hidden')===false;button.setAttribute('aria-expanded',String(open));if(open)refresh()});
    menu.querySelector('[data-profile-edit]').addEventListener('click', () => {close();onEdit()});
    menu.querySelector('[data-profile-signout]').addEventListener('click', () => {close();onSignOut()});
    document.addEventListener('click', event => {if(!wrapper.contains(event.target))close()});
    document.addEventListener('keydown', event => {if(event.key==='Escape')close()});
    const refresh = async () => {
      const token=sessionStorage.getItem(`${role}Token`);if(!token)return;
      try {
        const response=await fetch(role==='student'?'/student/me':'/lecturer/me',{headers:{[role==='student'?'X-Student-Token':'X-Lecturer-Token']:token},cache:'no-store'});
        if(!response.ok)return;
        const profile=await response.json();
        button.querySelector('img').src=profile.profile_image_url||'/branding/logo';
        button.title=profile.full_name||'My profile';
      } catch (_) {}
    };
    refresh();
    return {refresh,button};
  }
};
