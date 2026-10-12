(() => {
  const month = document.getElementById('mediaFinanceMonth');
  const summary = document.getElementById('mediaFinanceSummary');
  const entries = document.getElementById('mediaFinanceEntries');
  const message = document.getElementById('mediaFinanceMessage');
  const money = cents => `R${(cents / 100).toLocaleString('en-ZA', {minimumFractionDigits:2,maximumFractionDigits:2})}`;
  month.value = new Date().toISOString().slice(0, 7);
  async function load() {
    message.textContent = 'Loading media usage…';
    try {
      const data = await api(`/admin/media-finance?month=${encodeURIComponent(month.value)}`);
      const videos = data.uploads.lessons + data.uploads.community_videos + data.uploads.advert_videos;
      const usage = data.cloudinary_rolling_usage;
      const amount = key => usage?.[key]?.usage ?? usage?.[key]?.used ?? null;
      summary.innerHTML = `<div><strong>${money(data.income_cents)}</strong><p>Recorded income</p></div><div><strong>${money(data.expense_cents)}</strong><p>Recorded costs</p></div><div><strong>${money(data.net_cents)}</strong><p>Difference</p></div><div><strong>${videos}</strong><p>Videos uploaded this month</p></div><div><strong>${((data.uploads.source_bytes || 0) / 1048576).toFixed(1)} MB</strong><p>Original video uploads this month</p></div><div><strong>${data.unique_listing_views}</strong><p>Unique listing views this month</p></div><div><strong>${amount('credits') ?? '—'}</strong><p>Cloudinary credits used, rolling period</p></div>`;
      entries.innerHTML = data.entries.length ? data.entries.map(entry => `<div class="manage-item"><strong>${entry.kind === 'income' ? 'Income' : 'Cost'} · ${escapeHtml(entry.category)} · ${money(entry.amount_cents)}</strong><span class="muted">${escapeHtml(entry.note)}</span><button class="btn secondary" type="button" data-delete-finance="${entry.id}">Remove</button></div>`).join('') : '<p class="muted">No amounts recorded for this month.</p>';
      message.textContent = usage ? 'Cloudinary usage is from its rolling account report. Enter its actual invoice above to compare costs.' : 'Cloudinary usage is unavailable right now. Recorded amounts are still shown.';
    } catch (error) { message.textContent = error.message; }
  }
  document.getElementById('refreshMediaFinance').addEventListener('click', load);
  month.addEventListener('change', load);
  document.getElementById('mediaFinanceForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget, amount = Number(form.elements.amount.value);
    if (!Number.isFinite(amount) || amount <= 0) return;
    try {
      await api('/admin/media-finance', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({month:month.value,kind:form.elements.kind.value,category:form.elements.category.value,amount_cents:Math.round(amount * 100),note:form.elements.note.value})});
      form.reset(); await load();
    } catch (error) { message.textContent = error.message; }
  });
  entries.addEventListener('click', async event => {
    const button = event.target.closest('[data-delete-finance]');
    if (!button) return;
    try { await api(`/admin/media-finance/${button.dataset.deleteFinance}`, {method:'DELETE'}); await load(); }
    catch (error) { message.textContent = error.message; }
  });
})();
