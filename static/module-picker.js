(() => {
  let catalogPromise;
  const catalog = () => catalogPromise ||= fetch('/module-catalog').then(response => {if(!response.ok)throw new Error('Subjects are unavailable');return response.json()});
  function selected(scope) {return [...scope.querySelectorAll('[data-module-picker] input[type=checkbox]:checked')].map(input=>input.value)}
  async function mount(host) {
    if (host.dataset.pickerReady) return;
    host.dataset.pickerReady='true';
    host.innerHTML='<label class="module-picker-title">Choose the subjects you teach <small>(optional)</small></label><input type="search" class="module-picker-search" placeholder="Find a subject, grade or code" aria-label="Search subjects"><div class="module-picker-list" role="group" aria-label="Subjects you teach">Loading subjects…</div><small class="module-picker-count">You can choose more than one.</small>';
    const list=host.querySelector('.module-picker-list'),search=host.querySelector('.module-picker-search'),count=host.querySelector('.module-picker-count');
    try {
      const rows=await catalog();
      if(!host.isConnected)return;
      const groups=[...new Set(rows.map(row=>row.group))];
      for(const group of groups){
        const section=document.createElement('section');section.className='module-picker-group';
        const heading=document.createElement('h3');heading.textContent=group;section.append(heading);
        for(const row of rows.filter(item=>item.group===group)){
          const label=document.createElement('label');label.className='module-picker-option';
          const input=document.createElement('input');input.type='checkbox';input.value=row.module_code;
          const span=document.createElement('span');span.textContent=row.module_name;
          label.append(input,span);section.append(label);
        }
        list.append(section);
      }
      list.firstChild?.nodeType===3 && list.firstChild.remove();
      const filter=()=>{const term=search.value.trim().toLocaleLowerCase();list.querySelectorAll('.module-picker-option').forEach(option=>option.hidden=!!term&&!option.textContent.toLocaleLowerCase().includes(term));list.querySelectorAll('.module-picker-group').forEach(group=>group.hidden=![...group.querySelectorAll('.module-picker-option')].some(option=>!option.hidden))};
      search.addEventListener('input',filter);
      list.addEventListener('change',()=>{const total=selected(host).length;count.textContent=total?`${total} subject${total===1?'':'s'} chosen`:'You can choose more than one.'});
    } catch(error){list.textContent=error.message;}
  }
  const scan=()=>{if(typeof document==='undefined'||!document?.querySelectorAll)return;document.querySelectorAll('[data-module-picker]').forEach(mount)};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan);else scan();
  new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});
  window.ArounusModulePicker={selected};
})();
