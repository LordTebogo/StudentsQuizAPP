(() => {
  const form = document.getElementById('entryForm') || document.getElementById('registerCard');
  if (!form) return;

  function install() {
    const input = form.querySelector('#entryUsername, #regNumber');
    if (!input || input.dataset.suggestionReady) return;
    input.dataset.suggestionReady = 'true';
    if (input.id === 'regNumber') {
      const label = form.querySelector('label[for="regNumber"]');
      if (label) label.textContent = 'Unique username';
      input.placeholder = 'Choose a username';
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn secondary';
    button.textContent = 'Generate username';
    button.setAttribute('aria-label', 'Generate an available username');
    const status = document.createElement('p');
    status.className = 'muted';
    status.setAttribute('role', 'status');
    input.after(button, status);

    button.addEventListener('click', async () => {
      button.disabled = true;
      status.textContent = 'Finding an available username…';
      try {
        const fullName = form.querySelector('#entryFullName, #regName')?.value.trim() || '';
        const response = await fetch('/students/username-suggestion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ full_name: fullName }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.username) throw new Error(result.detail || 'Could not generate a username. Try again.');
        input.value = result.username;
        status.textContent = `Available suggestion: ${result.username}. You can edit it before registering.`;
        input.focus();
      } catch (error) {
        status.textContent = error.message || 'Could not generate a username. Try again.';
      } finally {
        button.disabled = false;
      }
    });
  }

  new MutationObserver(install).observe(form, { childList: true });
  install();
})();
