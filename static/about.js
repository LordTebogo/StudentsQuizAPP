(() => {
  const button = document.getElementById('copyDonationAccount');
  const status = document.getElementById('donationCopyStatus');
  if (!button || !status) return;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(document.getElementById('donationAccount').textContent.trim());
      status.textContent = 'Account number copied.';
    } catch (_) {
      status.textContent = 'Select and copy the account number above.';
    }
  });
})();
