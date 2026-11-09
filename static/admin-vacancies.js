(() => {
  const card = document.getElementById('vacancyAdminCard');
  const list = document.getElementById('vacancyAdminList');
  const form = document.getElementById('vacancyAdminForm');
  const status = document.getElementById('vacancyAdminStatus');
  if (!card || !list || !form) return;
  let rows = [];
  function reset() {
    form.reset();
    form.elements.vacancy_id.value = '';
    form.elements.is_open.checked = true;
    status.textContent = '';
  }
  function select(item) {
    form.elements.vacancy_id.value = item.id;
    form.elements.title.value = item.title;
    form.elements.summary.value = item.summary;
    form.elements.details.value = item.details;
    form.elements.is_open.checked = item.is_open;
    status.textContent = `Editing ${item.title}.`;
    form.elements.title.focus();
  }
  async function load() {
    if (document.getElementById('appWrap').classList.contains('hidden')) return;
    try {
      rows = await api('/admin/vacancies');
      list.replaceChildren();
      for (const item of rows) {
        const row = document.createElement('div');row.className='admin-list-item';
        const text = document.createElement('span');
        const title = document.createElement('strong');title.textContent=item.title;
        const detail = document.createElement('small');detail.textContent=item.is_open?'Open on vacancies page':'Closed';
        text.append(title,detail);
        const button = document.createElement('button');button.type='button';button.className='btn secondary';button.textContent='Edit';button.addEventListener('click',()=>select(item));
        row.append(text,button);list.append(row);
      }
      if (!rows.length) list.textContent='No vacancies yet.';
    } catch (error) { status.textContent = error.message; }
  }
  document.getElementById('newVacancyBtn').addEventListener('click',()=>{reset();form.elements.title.focus();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const id=form.elements.vacancy_id.value;
    const data={title:form.elements.title.value.trim(),summary:form.elements.summary.value.trim(),details:form.elements.details.value.trim(),is_open:form.elements.is_open.checked};
    const button=form.querySelector('[type=submit]');button.disabled=true;status.textContent='Saving…';
    try {
      await api(id?`/admin/vacancies/${id}`:'/admin/vacancies',{method:id?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
      reset();status.textContent='Vacancy saved.';await load();
    } catch(error){status.textContent=error.message;}
    finally{button.disabled=false;}
  });
  window.addEventListener('admin:area',event=>{if(event.detail==='market')load();});
  new MutationObserver(()=>{if(!document.getElementById('appWrap').classList.contains('hidden')&&location.hash==='#market')load();}).observe(document.getElementById('appWrap'),{attributes:true,attributeFilter:['class']});
  if (!document.getElementById('appWrap').classList.contains('hidden')) load();
})();
