(() => {
  const form = document.getElementById('supportPaymentForm');
  const button = document.getElementById('supportPayButton');
  const status = document.getElementById('supportPaymentStatus');
  if (!form || !button || !status) return;

  const result = new URLSearchParams(location.search).get('support');
  const returnMessage = result === 'success'
    ? 'Thank you for supporting Arounus. Paystack confirmed your payment.'
    : result === 'pending' ? 'Your payment is not confirmed yet. Check your email or Paystack receipt before trying again.' : '';

  fetch('/billing/support/status', {cache: 'no-store'})
    .then(response => response.ok ? response.json() : Promise.reject())
    .then(data => {
      button.disabled = !data.available;
      status.textContent = returnMessage || (data.available ? 'Ready to continue to Paystack.' : 'Paystack donations are not available yet. Please check back later.');
    })
    .catch(() => { status.textContent = returnMessage || 'Payment availability could not be checked. Please try again later.'; });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled || !form.reportValidity()) return;
    button.disabled = true;
    status.textContent = 'Opening secure Paystack checkout…';
    try {
      const response = await fetch('/billing/support/checkout', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({amount_rand: Number(form.elements.amount.value), email: form.elements.email.value.trim()})
      });
      const data = await response.json();
      if (!response.ok || !data.checkout_url) throw new Error(data.detail || 'Checkout could not open.');
      location.assign(data.checkout_url);
    } catch (error) {
      status.textContent = error.message || 'Checkout could not open. Please try again.';
      button.disabled = false;
    }
  });
})();
