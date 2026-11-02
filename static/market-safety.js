(() => {
  const reasons = [['unavailable', 'Sold, rented or no longer available'], ['outdated', 'Outdated details or price'], ['suspicious', 'Suspected scam or unsafe behaviour'], ['misleading', 'Misleading or inappropriate content'], ['other', 'Something else']];
  const formHtml = `<form class="market-report-form"><label>Listing link<input name="listing" type="url" required placeholder="https://arounus.com/listing/room/123"></label><label>What is wrong?<select name="reason" required><option value="">Choose a reason</option>${reasons.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label><label>More details (optional)<textarea name="details" maxlength="2000" rows="3" placeholder="Tell us what you noticed. Do not include passwords, ID numbers or payment details."></textarea></label><p>No sign-in required. Your report goes to Arounus administrators, not the listing provider. Reports do not automatically remove listings.</p><button type="submit">Submit report</button><p class="market-report-status" role="status" aria-live="polite"></p></form>`;
  function parseListing(value) {
    try {
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol) || ![location.host, 'arounus.com', 'www.arounus.com'].includes(url.host)) return null;
      const match = url.pathname.match(/^\/listing\/(room|offer)\/([1-9]\d*)\/?$/);
      return match && {kind: match[1], listing_id: Number(match[2])};
    } catch { return null; }
  }
  function installForm(host, listing = '') {
    host.innerHTML = formHtml;
    const form = host.querySelector('form'), status = form.querySelector('[role=status]');
    form.elements.listing.value = listing;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const listing = parseListing(form.elements.listing.value.trim());
      if (!listing) { status.textContent = 'Enter an Arounus listing link, such as https://arounus.com/listing/room/123.'; form.elements.listing.focus(); return; }
      const button = form.querySelector('[type=submit]');
      button.disabled = true; status.textContent = 'Submitting report…';
      try {
        const response = await fetch('/marketing/reports', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...listing, reason:form.elements.reason.value, details:form.elements.details.value.trim()}), signal:AbortSignal.timeout(15000)});
        const data = await response.json();
        if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Your report could not be submitted.');
        status.textContent = `Report received. Reference #${data.reference}. It is in the administrator review queue. This does not confirm the listing is unsafe. For urgent help, use the support contacts below.`;
        form.querySelectorAll('input,select,textarea').forEach(input => { input.disabled = true; });
        button.textContent = 'Report submitted';
      } catch (error) {
        status.textContent = `${error.name === 'TimeoutError' ? 'The request timed out.' : error.message} Please retry, or email arounus.com@gmail.com with the listing link.`;
        button.disabled = false;
      }
    });
  }
  const inline = document.querySelector('[data-market-report-host]');
  if (inline) {
    const key = new URLSearchParams(location.search).get('listing') || '';
    const match = key.match(/^(room|offer)-([1-9]\d*)$/);
    installForm(inline, match ? `${location.origin}/listing/${match[1]}/${match[2]}` : '');
  }
  let dialog;
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-report-listing]');
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'marketReportDialog'; dialog.setAttribute('aria-labelledby', 'marketReportTitle');
      dialog.innerHTML = '<div class="market-report-heading"><h2 id="marketReportTitle">Report a listing</h2><button type="button" aria-label="Close report">×</button></div><p class="market-report-name"></p><div data-report-form></div><p>Need help? <a href="mailto:arounus.com@gmail.com">Email Arounus</a> or <a href="/trust#support">see support contacts</a>.</p>';
      document.body.append(dialog);
      dialog.querySelector('button').addEventListener('click', () => dialog.close());
    }
    const key = trigger.dataset.reportListing.match(/^(room|offer)-([1-9]\d*)$/);
    if (!key) return;
    dialog.querySelector('.market-report-name').textContent = trigger.dataset.reportTitle || 'Tell us what needs attention.';
    installForm(dialog.querySelector('[data-report-form]'), `${location.origin}/listing/${key[1]}/${key[2]}`);
    dialog.showModal();
    dialog.querySelector('select').focus();
  });
})();
