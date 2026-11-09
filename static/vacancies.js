(() => {
  const list = document.getElementById('vacancyList');
  if (!list) return;
  async function load() {
    try {
      const response = await fetch('/vacancies/openings', {cache:'no-store'});
      if (!response.ok) throw new Error('Openings could not be loaded.');
      const openings = await response.json();
      if (!Array.isArray(openings)) throw new Error('Openings could not be loaded.');
      list.replaceChildren();
      if (!openings.length) {
        const note = document.createElement('p');
        note.className = 'vacancies-empty';
        note.textContent = 'There are no open roles right now. Please check back for updates.';
        list.append(note);
      }
      for (const opening of openings) {
        const card = document.createElement('article');
        card.className = 'vacancy-card';
        const label = document.createElement('span');label.className = 'vacancy-status';label.textContent = 'Open';
        const heading = document.createElement('h3');heading.textContent = opening.title;
        const summary = document.createElement('p');summary.textContent = opening.summary;
        const details = document.createElement('p');details.className = 'vacancy-details';details.textContent = opening.details;
        const apply = document.createElement('a');apply.className = 'vacancy-apply';
        apply.href = 'mailto:arounus.com@gmail.com?subject=' + encodeURIComponent('Arounus vacancy: ' + opening.title);
        apply.textContent = 'Apply by email →';
        card.append(label, heading, summary, details, apply);
        list.append(card);
      }
    } catch (error) {
      list.replaceChildren();
      const message = document.createElement('p');message.className = 'vacancies-empty';message.textContent = error.message;
      const retry = document.createElement('button');retry.type = 'button';retry.textContent = 'Try again';retry.addEventListener('click', load);
      list.append(message, retry);
    } finally { list.setAttribute('aria-busy', 'false'); }
  }
  load();
})();
