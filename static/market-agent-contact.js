(() => {
  const roles = {
    student: ['studentToken', 'X-Student-Token'],
    lecturer: ['lecturerToken', 'X-Lecturer-Token'],
    advertiser: ['landlordToken', 'X-Landlord-Token'],
  };
  function record(event) {
    const link = event.target.closest('a[data-agent-contact-listing]');
    if (!link || event.defaultPrevented || (event.type === 'auxclick' && event.button !== 1)) return;
    const listing = Number(link.dataset.agentContactListing);
    if (!Number.isSafeInteger(listing) || listing <= 0) return;
    const headers = {};
    try {
      const active = roles[sessionStorage.getItem('activeRole')];
      const sessions = active ? [active, ...Object.values(roles).filter(role => role !== active)] : Object.values(roles);
      for (const [key, header] of sessions) {
        const token = sessionStorage.getItem(key);
        if (token) {
          headers[header] = token;
          break;
        }
      }
    } catch {
      // Storage can be disabled. The server then treats the click as anonymous.
    }
    fetch(`/marketing/rooms/${listing}/agent-contact-click`, {method: 'POST', headers, keepalive: true}).catch(() => {});
  }
  document.addEventListener('click', record);
  document.addEventListener('auxclick', record);
})();
