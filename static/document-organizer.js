// Loaded after the page's shared document helpers.
let organizerFiles = [], pageItems = [], draggedPageId = null;
let organizerGeneration = 0, organizerBusy = false, organizerController = null;
const organizerHistory = [], selectedPages = new Set();
const preview = document.getElementById('pagePreview');
const organizerStatus = document.getElementById('organizerStatus');
const organizerDownload = document.getElementById('downloadOrganizer');
const toolbar = document.createElement('div');
toolbar.className = 'organizer-actions';
toolbar.innerHTML = '<button class="btn secondary" id="undoPages" type="button">Undo</button><button class="btn secondary" id="selectPages" type="button">Select all</button><button class="btn secondary" id="rotatePages" type="button">Rotate selected</button><button class="btn secondary" id="removePages" type="button">Remove selected</button><button class="btn secondary" id="extractPages" type="button">Download selected</button><span id="selectionCount" aria-live="polite"></span>';
preview.before(toolbar);
function rememberPages() {
  organizerStatus.textContent = 'Changes not exported. Build a new PDF when ready.';
  organizerHistory.push(pageItems.map(item => ({...item})));
  if (organizerHistory.length > 30) organizerHistory.shift();
}
function renderPagePreview() {
  const ids = new Set(pageItems.map(item => item.id));
  for (const id of selectedPages) if (!ids.has(id)) selectedPages.delete(id);
  preview.innerHTML = pageItems.length ? pageItems.map((item, index) => `
    <article class="page-card" draggable="${!organizerBusy}" data-page-id="${item.id}">
      <label class="page-selection"><input type="checkbox" data-select ${selectedPages.has(item.id) ? 'checked' : ''} aria-label="Select output page ${index + 1}"> Page ${index + 1}</label>
      <button type="button" class="page-image" aria-label="Preview output page ${index + 1}"><img src="${item.thumbnail}" style="transform:rotate(${item.rotation}deg)" alt="Page ${index + 1}"></button>
      <div class="page-info"><strong>Output page ${index + 1}</strong><small>${safe(item.fileName)} · original page ${item.pageIndex + 1} · ${item.rotation}°</small></div>
      <div class="page-controls"><button class="btn secondary" type="button" data-move="-1" aria-label="Move page ${index + 1} left" ${index === 0 ? 'disabled' : ''}>←</button><button class="btn secondary" type="button" data-move="1" aria-label="Move page ${index + 1} right" ${index === pageItems.length - 1 ? 'disabled' : ''}>→</button><button class="btn secondary" type="button" data-rotate aria-label="Rotate page ${index + 1}">↻</button><button class="btn secondary remove-page" type="button" data-remove aria-label="Remove page ${index + 1}">×</button></div>
    </article>`).join('') : '<div class="preview-empty">Choose PDF documents to see their pages here.</div>';
  organizerDownload.disabled = organizerBusy || !pageItems.length;
  document.getElementById('organizerFiles').disabled = organizerBusy;
  document.getElementById('clearOrganizer').disabled = organizerBusy;
  toolbar.querySelectorAll('button').forEach(button => button.disabled = organizerBusy);
  document.getElementById('undoPages').disabled = organizerBusy || !organizerHistory.length;
  for (const id of ['rotatePages', 'removePages', 'extractPages']) document.getElementById(id).disabled = organizerBusy || !selectedPages.size;
  document.getElementById('selectionCount').textContent = `${selectedPages.size} selected · ${pageItems.length} pages`;
  preview.querySelectorAll('button,input').forEach(control => { if (organizerBusy) control.disabled = true; });
  bindPageCards();
}
function bindPageCards() {
  preview.querySelectorAll('.page-card').forEach(card => {
    const getItem = () => pageItems.find(item => item.id === card.dataset.pageId);
    card.querySelector('[data-select]').onchange = event => {
      if (event.target.checked) selectedPages.add(card.dataset.pageId); else selectedPages.delete(card.dataset.pageId);
      renderPagePreview();
    };
    card.querySelector('.page-image').onclick = () => {
      const item = getItem();
      document.getElementById('pageDialogTitle').textContent = `${item.fileName} · page ${item.pageIndex + 1}`;
      const image = document.getElementById('pageDialogImage');
      image.src = item.thumbnail; image.style.transform = `rotate(${item.rotation}deg)`;
      document.getElementById('pageDialog').showModal();
    };
    card.querySelector('[data-rotate]').onclick = () => { rememberPages(); getItem().rotation = (getItem().rotation + 90) % 360; renderPagePreview(); };
    card.querySelector('[data-remove]').onclick = () => { rememberPages(); pageItems = pageItems.filter(item => item.id !== card.dataset.pageId); renderPagePreview(); };
    card.querySelectorAll('[data-move]').forEach(button => button.onclick = () => {
      const index = pageItems.findIndex(item => item.id === card.dataset.pageId), next = index + Number(button.dataset.move);
      if (next < 0 || next >= pageItems.length) return;
      rememberPages(); [pageItems[index], pageItems[next]] = [pageItems[next], pageItems[index]]; renderPagePreview();
    });
    card.ondragstart = () => { draggedPageId = card.dataset.pageId; card.classList.add('dragging'); };
    card.ondragend = () => { draggedPageId = null; card.classList.remove('dragging'); };
    card.ondragover = event => { if (!organizerBusy) event.preventDefault(); };
    card.ondrop = event => {
      event.preventDefault(); if (organizerBusy) return;
      const from = pageItems.findIndex(item => item.id === draggedPageId), to = pageItems.findIndex(item => item.id === card.dataset.pageId);
      if (from < 0 || to < 0 || from === to) return;
      rememberPages(); const [item] = pageItems.splice(from, 1); pageItems.splice(to, 0, item); renderPagePreview();
    };
  });
}
async function loadPdfPreviews() {
  const generation = ++organizerGeneration;
  organizerFiles = [...document.getElementById('organizerFiles').files];
  pageItems = []; organizerHistory.length = 0; selectedPages.clear();
  organizerBusy = true; renderPagePreview();
  const stop = startProgress(organizerStatus, 'Reading PDF pages', () => { ++organizerGeneration; organizerBusy = false; pageItems = []; renderPagePreview(); organizerStatus.textContent = 'Preview loading cancelled.'; });
  try {
    if (!organizerFiles.length) return;
    if (organizerFiles.length > 20 || organizerFiles.some(file => file.size > 25 * 1024 * 1024)) throw new Error('Choose up to 20 PDFs, each 25 MB or smaller.');
    if (!window.pdfjsLib) throw new Error('The PDF reader could not load. Check your connection and retry.');
    const loaded = [];
    for (let fileIndex = 0; fileIndex < organizerFiles.length; fileIndex++) {
      const file = organizerFiles[fileIndex], bytes = await file.arrayBuffer();
      if (generation !== organizerGeneration) return;
      const task = pdfjsLib.getDocument({data: bytes});
      let pdf;
      try {
        pdf = await task.promise;
        if (pdf.numPages > 200 || loaded.length + pdf.numPages > 200) throw new Error('Choose at most 200 pages in total. Split larger PDFs first.');
        for (let number = 1; number <= pdf.numPages; number++) {
          if (generation !== organizerGeneration) return;
          const page = await pdf.getPage(number), viewport = page.getViewport({scale: .65});
          const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          await page.render({canvasContext: canvas.getContext('2d'), viewport}).promise;
          loaded.push({id: `${generation}-${fileIndex}-${number}`, fileIndex, pageIndex: number - 1, fileName: file.name, rotation: 0, thumbnail: canvas.toDataURL('image/jpeg', .84)});
          canvas.width = canvas.height = 1; page.cleanup();
          stop.update(`Rendering previews · ${loaded.length} pages ready`);
        }
      } finally { if (pdf) await pdf.destroy(); else await task.destroy(); }
    }
    if (generation !== organizerGeneration) return;
    pageItems = loaded; organizerStatus.textContent = `${pageItems.length} pages ready. Select, rotate, move or remove pages.`;
  } catch (error) { if (generation === organizerGeneration) organizerStatus.textContent = error.message; }
  finally { stop(); if (generation === organizerGeneration) { organizerBusy = false; renderPagePreview(); } }
}
async function buildOrganized(selectedOnly = false) {
  const items = pageItems.filter(item => !selectedOnly || selectedPages.has(item.id));
  if (organizerBusy || !items.length) return;
  organizerBusy = true; renderPagePreview(); organizerController = new AbortController();
  const stop = startProgress(organizerStatus, 'Uploading pages and building your PDF', () => organizerController.abort());
  const body = new FormData(); organizerFiles.forEach(file => body.append('files', file));
  body.append('page_order', JSON.stringify(items.map(item => [item.fileIndex, item.pageIndex, item.rotation])));
  try {
    const response = await fetch('/document-tools/organize', {method: 'POST', headers: authHeaders(), body, signal: organizerController.signal});
    stop.update('Receiving the organised PDF');
    showPreparedResult(organizerStatus, await prepareResponse(response, 'organised-document.pdf'));
  } catch (error) { organizerStatus.textContent = error.name === 'AbortError' ? 'Cancelled. Your page arrangement is still available.' : error.message; }
  finally { stop(); organizerBusy = false; organizerController = null; renderPagePreview(); }
}
document.getElementById('organizerFiles').onchange = loadPdfPreviews;
document.getElementById('clearOrganizer').onclick = () => { ++organizerGeneration; organizerFiles = []; pageItems = []; organizerHistory.length = 0; selectedPages.clear(); document.getElementById('organizerFiles').value = ''; organizerStatus.textContent = ''; renderPagePreview(); };
document.getElementById('undoPages').onclick = () => { if (organizerHistory.length) { pageItems = organizerHistory.pop(); organizerStatus.textContent = 'Change undone. Build a new PDF when ready.'; renderPagePreview(); } };
document.getElementById('selectPages').onclick = () => { if (selectedPages.size === pageItems.length) selectedPages.clear(); else pageItems.forEach(item => selectedPages.add(item.id)); renderPagePreview(); };
document.getElementById('rotatePages').onclick = () => { rememberPages(); pageItems.forEach(item => { if (selectedPages.has(item.id)) item.rotation = (item.rotation + 90) % 360; }); renderPagePreview(); };
document.getElementById('removePages').onclick = () => { rememberPages(); pageItems = pageItems.filter(item => !selectedPages.has(item.id)); renderPagePreview(); };
document.getElementById('extractPages').onclick = () => buildOrganized(true);
organizerDownload.onclick = () => buildOrganized();
renderPagePreview();
