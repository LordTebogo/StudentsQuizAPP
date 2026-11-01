(() => {
  const byId = id => document.getElementById(id);
  const card = byId('appTrafficCard');
  if (!card) return;
  const start = byId('trafficStartDate'), end = byId('trafficEndDate'), view = byId('trafficHistoryView');
  const message = byId('appTrafficMessage');
  const dateKey = value => new Intl.DateTimeFormat('en-CA', { timeZone:'Africa/Johannesburg', year:'numeric', month:'2-digit', day:'2-digit' }).format(value);
  const today = dateKey(new Date());
  end.value = today;
  const weekStart = new Date(today + 'T12:00:00+02:00');
  weekStart.setUTCDate(weekStart.getUTCDate() - 6);
  start.value = dateKey(weekStart);
  start.max = end.max = today;
  let pending = false, data = null;
  const visible = () => !byId('appWrap').classList.contains('hidden') && !card.hidden && document.visibilityState === 'visible';
  const count = value => Number(value).toLocaleString('en-ZA');
  const formatDate = value => new Date(value).toLocaleString('en-ZA', { timeZone:'Africa/Johannesburg', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  function renderHistory() {
    if (!data) return;
    const hourly = view.value === 'hourly';
    start.disabled = end.disabled = hourly;
    const rows = hourly ? data.hourly : data.daily;
    const maximum = Math.max(1, ...rows.map(row => row.visitors));
    const todayKey = dateKey(new Date(data.generated_at));
    const trackingDay = data.tracking_started_at ? dateKey(new Date(data.tracking_started_at)) : null;
    const trackingHour = data.tracking_started_at ? new Date(data.tracking_started_at).getTime() : null;
    const fragment = document.createDocumentFragment();
    [...rows].reverse().forEach(row => {
      const tr = document.createElement('tr'), period = document.createElement('td');
      const when = hourly ? row.hour : row.date + 'T00:00:00+02:00';
      let label;
      if (hourly) {
        const hoursAgo = Math.floor((new Date(data.generated_at) - new Date(row.hour)) / 3600000);
        label = hoursAgo === 0 ? 'Current hour' : `${hoursAgo} hour${hoursAgo === 1 ? '' : 's'} ago`;
      } else {
        const daysAgo = Math.round((new Date(todayKey + 'T00:00:00+02:00') - new Date(when)) / 86400000);
        label = daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : daysAgo > 1 ? `${daysAgo} days ago` : 'Future date';
      }
      period.append(document.createTextNode(label));
      const time = document.createElement('time'); time.dateTime = when;
      time.textContent = hourly ? formatDate(when) : new Date(when).toLocaleDateString('en-ZA', {timeZone:'Africa/Johannesburg', day:'numeric', month:'short', year:'numeric'});
      period.append(time);
      const beforeTracking = !trackingDay || (hourly ? new Date(row.hour).getTime() + 3600000 <= trackingHour : row.date < trackingDay);
      const total = document.createElement('td'); total.textContent = beforeTracking ? '—' : count(row.visitors);
      if (beforeTracking) total.title = 'Tracking had not started';
      const chart = document.createElement('td'), bar = document.createElement('div'), fill = document.createElement('span');
      bar.className = 'traffic-bar'; bar.setAttribute('aria-hidden', 'true');
      fill.style.width = `${row.visitors / maximum * 100}%`;
      bar.append(fill); chart.append(bar); tr.append(period, total, chart); fragment.append(tr);
    });
    byId('trafficHistoryRows').replaceChildren(fragment);
    byId('trafficHistoryCaption').textContent = `${hourly ? 'Hourly visitors · past 24 hours' : 'Daily visitors'} · South Africa time (UTC+2)`;
    const todayNote = data.start_date <= todayKey && data.end_date >= todayKey ? ' Today is still in progress.' : '';
    byId('trafficPeriodSummary').textContent = hourly ? 'Each row counts distinct browsers active during that hour. The current hour is still in progress.' : `${count(data.summary.selected_period)} unique browser${data.summary.selected_period === 1 ? '' : 's'} from ${data.start_date} to ${data.end_date}.${todayNote}`;
  }
  async function load() {
    if (pending || !visible()) return;
    if (!start.value || !end.value || start.value > end.value) { message.textContent = 'Choose a valid start and end date.'; return; }
    pending = true;
    const button = byId('refreshAppTraffic'); button.disabled = true;
    try {
      const result = await api(`/admin/traffic?start_date=${encodeURIComponent(start.value)}&end_date=${encodeURIComponent(end.value)}`);
      // Locking administration while a request is in flight must keep it hidden.
      if (byId('appWrap').classList.contains('hidden')) return;
      data = result;
      for (const [id, key] of [['trafficActive','active_now'],['trafficHour','past_hour'],['trafficToday','today'],['trafficAllTime','all_time']]) byId(id).textContent = count(data.summary[key]);
      byId('trafficTrackingNote').textContent = data.tracking_started_at ? `History recorded since ${formatDate(data.tracking_started_at)} (South Africa time). Earlier visits are unavailable; the first day may be partial.` : 'No visits recorded yet. History will appear as people open the app. Earlier visits cannot be reconstructed.';
      renderHistory();
      message.textContent = `Updated ${formatDate(data.generated_at)}. Refreshes every 30 seconds while this overview is open.`;
    } catch (error) { message.textContent = `Traffic could not be refreshed. ${error.message}${data ? ' Showing the last successful update.' : ''}`; }
    finally { pending = false; button.disabled = false; }
  }
  byId('refreshAppTraffic').addEventListener('click', load);
  byId('trafficHistoryForm').addEventListener('submit', event => { event.preventDefault(); load(); });
  view.addEventListener('change', () => { start.disabled = end.disabled = view.value === 'hourly'; renderHistory(); load(); });
  window.addEventListener('admin:unlocked', load);
  window.addEventListener('admin:area', event => { if (event.detail === 'overview') load(); });
  document.addEventListener('visibilitychange', load);
  window.setInterval(load, 30000);
  load();
})();
