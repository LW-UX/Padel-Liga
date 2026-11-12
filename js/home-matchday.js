(function () {
  const TIME_ZONE = 'Europe/Berlin';
  const dayFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const timeFormatter = new Intl.DateTimeFormat('de-DE', {
    timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit'
  });
  let currentData = null;
  let dayTimer = null;

  function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }

  function dateKey(date) {
    const parts = Object.fromEntries(dayFormatter.formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function getEntries(data, now = new Date()) {
    const playerId = data?.profile?.player_id;
    if (!data?.ready || !data.session?.user?.id || data.profile?.id !== data.session.user.id
      || !playerId || !['player', 'admin'].includes(data.profile.app_role)) return [];

    const today = dateKey(now);
    const matches = (data.resultTasks || []).flatMap(task => {
      const at = new Date(task.match_at);
      const ownTeam = (task.match_players || []).find(member => member.player_id === playerId)?.team;
      if (![1, 2].includes(Number(ownTeam)) || task.task_type !== 'enter'
        || !Number.isFinite(at.getTime()) || dateKey(at) !== today) return [];
      const partner = task.match_players.find(member => Number(member.team) === Number(ownTeam) && member.player_id !== playerId);
      const opponents = task.match_players.filter(member => Number(member.team) !== Number(ownTeam));
      const booking = (data.courtBookings || []).find(item => item.match_id === task.match_id
        && Date.parse(item.starts_at) === at.getTime());
      return [{
        id: task.match_id, kind: 'match', time: timeFormatter.format(at), sortTime: timeFormatter.format(at),
        label: data.getMatchLabel(task), season: task.season_label,
        partner: partner ? data.getPlayerName(partner.player_id) : '',
        opponents: opponents.map(member => data.getPlayerName(member.player_id)),
        court: booking?.court_name || '',
        hallBooking: booking && /(?:^|\s)H[1-4]$/i.test(String(booking.court_name || '').trim())
          && Date.parse(booking.ends_at) > now.getTime() ? booking : null
      }];
    });
    const trainings = (data.trainingTasks || []).flatMap(task => {
      if (task.status !== 'scheduled' || task.played_on !== today
        || !task.player_ids?.includes(playerId) || !/^\d{2}:\d{2}/.test(task.display_time || '')) return [];
      const time = task.display_time.slice(0, 5);
      const booking = (data.courtBookings || []).find(item => String(item.training_session_id) === String(task.session_id)
        && dateKey(new Date(item.starts_at)) === today && timeFormatter.format(new Date(item.starts_at)) === time);
      return [{
        id: task.session_id, kind: 'training', time, sortTime: time,
        label: 'Training', participants: task.player_ids.filter(id => id !== playerId)
          .map(id => data.getPlayerName(id, task.guest_names, task.player_ids)),
        court: booking?.court_name || '',
        hallBooking: booking && /(?:^|\s)H[1-4]$/i.test(String(booking.court_name || '').trim())
          && Date.parse(booking.ends_at) > now.getTime() ? booking : null
      }];
    });
    return [...matches, ...trainings].sort((left, right) => left.sortTime.localeCompare(right.sortTime));
  }

  function renderEntry(entry) {
    const matchup = entry.kind === 'training'
      ? `<strong>Du trainierst mit</strong><p>${entry.participants.map(escapeHtml).join(' &amp; ')}</p>`
      : `<strong>Du${entry.partner ? ` &amp; ${escapeHtml(entry.partner)}` : ''}</strong><p>gegen ${entry.opponents.map(escapeHtml).join(' &amp; ')}</p>`;
    // Mobil steht der Platz in einer eigenen Zeile unter dem Ort.
    const location = entry.kind === 'training' && !entry.court
      ? 'Ort wie vereinbart'
      : `Lucky Star Padel<span class="home-matchday-location-separator"> · </span><span class="home-matchday-court">${escapeHtml(entry.court || 'Platz noch offen')}</span>`;
    return `<article class="home-matchday-entry match-card">
      <div class="home-matchday-time"><span>${escapeHtml(entry.time)}</span><span>Uhr</span></div>
      <div class="home-matchday-details">
        <div class="match-meta">${[entry.season, entry.label].filter(Boolean).map(escapeHtml).join(' · ')}</div>
        <div class="home-matchday-matchup">${matchup}</div>
        <div class="home-matchday-location"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg><span>${location}</span></div>
        ${entry.hallBooking ? `<div class="hall-code" data-hall-code-surface="home" data-hall-code-${entry.kind === 'training' ? 'training' : 'match'}="${escapeHtml(entry.id)}" data-hall-code-booking="${entry.hallBooking.booking_id}" data-hall-code-until="${Date.parse(entry.hallBooking.ends_at)}" role="status" aria-live="polite" hidden></div>` : ''}
      </div>
    </article>`;
  }

  function render(data, now = new Date()) {
    currentData = data;
    const target = document.getElementById('home-matchday');
    if (!target) return;
    window.clearTimeout(dayTimer);
    const entries = getEntries(data, now);
    target.hidden = !entries.length;
    if (!entries.length) target.innerHTML = '';
    else {
      const format = options => new Intl.DateTimeFormat('de-DE', { timeZone: TIME_ZONE, ...options }).format(now);
      target.innerHTML = `<header class="home-matchday-header">
        <div class="home-matchday-date" aria-hidden="true"><span>${format({ month: 'short' }).replace('.', '')}</span><span>${format({ day: '2-digit' })}</span></div>
        <div><div class="eyebrow">${format({ weekday: 'long' })} · ${entries.length === 1 ? 'Dein Termin' : `${entries.length} Termine`}</div><h2 id="home-matchday-title">Heute ist Spieltag</h2></div>
      </header>
      <div class="home-matchday-list">${entries.map(renderEntry).join('')}</div>
      <button class="text-link" type="button" data-home-matchday-open>Zu meiner Partie</button>`;
    }
    void data?.onHallCodesRendered?.();
    // Auch eine über Mitternacht geöffnete Startseite folgt dem Berliner Spieltag.
    if (data?.session?.user && data.ready) dayTimer = window.setTimeout(() => render(currentData), 60_000);
  }

  document.addEventListener('click', event => {
    if (event.target.closest('[data-home-matchday-open]')) window.PadelKonto?.openDialog();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentData) render(currentData);
  });
  window.PadelHomeMatchday = { render, getEntries };
})();
