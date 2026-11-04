(() => {
  const dialog = document.createElement('dialog');
  dialog.id = 'listingImagePreview';
  dialog.className = 'image-preview';
  dialog.setAttribute('aria-label', 'Listing photo preview');
  dialog.innerHTML = `<header class="image-preview-header"><span data-preview-title></span><button type="button" data-preview-close aria-label="Close image preview">✕</button></header>
    <div class="image-preview-stage" tabindex="0" aria-label="Photo. Use the zoom controls to enlarge, then scroll to explore."><div class="image-preview-canvas"><img alt="" draggable="false"></div><p class="image-preview-status" role="status"></p></div>
    <footer class="image-preview-controls"><div class="image-preview-paging"><button type="button" data-preview-step="-1" aria-label="Previous photo">‹</button><span data-preview-count aria-live="polite"></span><button type="button" data-preview-step="1" aria-label="Next photo">›</button></div><div class="image-preview-zoom"><button type="button" data-preview-zoom="-0.5" aria-label="Zoom out">−</button><button type="button" data-preview-fit aria-label="Fit photo to screen">Fit</button><button type="button" data-preview-zoom="0.5" aria-label="Zoom in">+</button></div></footer>`;
  document.body.appendChild(dialog);
  const stage = dialog.querySelector('.image-preview-stage');
  const img = dialog.querySelector('img');
  const status = dialog.querySelector('.image-preview-status');
  let gallery = [], index = 0, zoom = 1, drag = null, suppressClick = false;
  const safeImage = value => {
    try { const url = new URL(value, location.origin); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
    catch { return ''; }
  };
  function sizePhoto() {
    if (!img.naturalWidth || !dialog.open) return;
    const fit = Math.min(stage.clientWidth / img.naturalWidth, stage.clientHeight / img.naturalHeight);
    img.style.width = `${Math.round(img.naturalWidth * fit * zoom)}px`;
    img.style.height = `${Math.round(img.naturalHeight * fit * zoom)}px`;
    stage.classList.toggle('is-zoomed', zoom > 1);
    dialog.querySelector('[data-preview-zoom="-0.5"]').disabled = zoom <= 1;
    dialog.querySelector('[data-preview-zoom="0.5"]').disabled = zoom >= 3;
    stage.scrollLeft = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2);
    stage.scrollTop = Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2);
  }
  function showPhoto(next) {
    index = (next + gallery.length) % gallery.length;
    zoom = 1;
    stage.classList.remove('is-zoomed');
    dialog.querySelector('[data-preview-zoom="-0.5"]').disabled = true;
    dialog.querySelector('[data-preview-zoom="0.5"]').disabled = false;
    img.style.width = ''; img.style.height = '';
    status.textContent = 'Loading photo…';
    img.alt = `${dialog.querySelector('[data-preview-title]').textContent}, photo ${index + 1} of ${gallery.length}`;
    img.src = gallery[index];
    dialog.querySelector('[data-preview-count]').textContent = `${index + 1} of ${gallery.length}`;
    dialog.querySelectorAll('[data-preview-step]').forEach(button => { button.hidden = gallery.length < 2; });
    // Keep the listing gallery on the photo selected in the preview.
    document.querySelector(`#offerDetails [data-gallery-index="${index}"]`)?.click();
    if (img.complete && img.naturalWidth) { status.textContent = ''; sizePhoto(); }
  }
  function changeZoom(value) { zoom = Math.max(1, Math.min(3, value)); sizePhoto(); }
  img.addEventListener('load', () => { status.textContent = ''; sizePhoto(); });
  img.addEventListener('error', () => { status.textContent = 'This photo could not load. Try another photo or close the preview and try again.'; });
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-image-preview]');
    if (!trigger) return;
    const details = trigger.closest('#offerDetails');
    if (!details) return;
    try { gallery = JSON.parse(details.dataset.gallery || '[]').map(safeImage).filter(Boolean); }
    catch { gallery = []; }
    if (!gallery.length) return;
    index = Number(details.dataset.galleryIndex || 0);
    if (!Number.isInteger(index) || index < 0 || index >= gallery.length) index = 0;
    dialog.querySelector('[data-preview-title]').textContent = details.querySelector('h2')?.textContent || 'Listing photos';
    dialog.showModal();
    showPhoto(index);
  });
  dialog.addEventListener('click', event => {
    if (event.target.closest('[data-preview-close]')) { dialog.close(); return; }
    const step = event.target.closest('[data-preview-step]');
    if (step) { showPhoto(index + Number(step.dataset.previewStep)); return; }
    const control = event.target.closest('[data-preview-zoom]');
    if (control) { changeZoom(zoom + Number(control.dataset.previewZoom)); return; }
    if (event.target.closest('[data-preview-fit]')) { changeZoom(1); return; }
    if (event.target === img) {
      if (suppressClick) { suppressClick = false; return; }
      changeZoom(zoom > 1 ? 1 : 2);
    }
  });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (zoom > 1 && event.target === stage) return;
      event.preventDefault(); showPhoto(index + (event.key === 'ArrowRight' ? 1 : -1));
    } else if (event.key === '+' || event.key === '=') { event.preventDefault(); changeZoom(zoom + .5); }
    else if (event.key === '-') { event.preventDefault(); changeZoom(zoom - .5); }
    else if (event.key === '0') { event.preventDefault(); changeZoom(1); }
  });
  stage.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    suppressClick = false;
    drag = {id: event.pointerId, x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop, mouse: event.pointerType !== 'touch'};
    if (zoom > 1 && drag.mouse) stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId || zoom <= 1 || !drag.mouse) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 8) suppressClick = true;
    stage.scrollLeft = drag.left - dx; stage.scrollTop = drag.top - dy;
  });
  stage.addEventListener('pointerup', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (zoom === 1 && Math.abs(dx) > 50 && Math.abs(dy) < Math.abs(dx) * .6) {
      showPhoto(index + (dx < 0 ? 1 : -1)); suppressClick = true;
    }
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    drag = null;
  });
  stage.addEventListener('pointercancel', () => { drag = null; });
  window.addEventListener('resize', sizePhoto);
  document.getElementById('offerDialog')?.addEventListener('close', () => { if (dialog.open) dialog.close(); });
  dialog.addEventListener('close', () => { drag = null; img.removeAttribute('src'); status.textContent = ''; });
})();
