(() => {
  const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const format = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });
  const today = () => format.format(new Date());
  const clock = value => new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  const dateLabel = value => new Intl.DateTimeFormat('de-DE', { dateStyle: 'full', timeZone: 'Europe/Berlin' }).format(new Date(`${value}T12:00:00Z`));
  const defaultFilter = seasonId => /winter/i.test(String(seasonId || '')) ? 'indoor' : 'outdoor';
  const minute = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const timeLabel = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  const currentSlot = slot => Date.parse(slot.start) > Date.now();
  const racketHint = 'Schläger bereits belegt. Platzzeit trotzdem auswählbar.';
  const racketIcon = `<span class="court-racket-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><g transform="rotate(40 12 12)"><path d="M12 1.5c3.4 0 5.6 2.7 5.6 6.2 0 3.6-2.4 6.6-5.6 6.6s-5.6-3-5.6-6.6c0-3.5 2.2-6.2 5.6-6.2Z"/><path d="M9.6 13.6 11 16.6h2l1.4-3"/><rect x="10.8" y="16.6" width="2.4" height="5.6" rx="1.1"/><path d="M10 6h.01M14 6h.01M12 8h.01M10 10h.01M14 10h.01"/></g><path d="m3 3 18 18"/></svg></span>`;

  function isRacketBusy(time, starts = []) {
    return starts.includes(timeLabel(Math.floor(minute(time) / 30) * 30));
  }

  function racketHourHint(time, starts = []) {
    const first = isRacketBusy(time, starts);
    const second = isRacketBusy(timeLabel(Math.floor(minute(time) / 30) * 30 + 30), starts);
    return first && second ? racketHint : first || second ? 'Schläger zum Teil bereits belegt. Platzzeit trotzdem auswählbar.' : '';
  }

  function renderRacketMarker(selectable, hint = racketHint) {
    return selectable ? racketIcon : racketIcon.replace('aria-hidden="true"', `tabindex="0" role="img" aria-label="${hint}"`);
  }

  function courtLabel(court) {
    const name = String(court?.name || '').trim();
    const number = Number(name.match(/(10|[1-9])$/)?.[1]);
    if (court?.location === 'indoor' && number >= 1 && number <= 4) return `H${number}`;
    if (court?.location === 'outdoor' && number >= 1 && number <= 10) return `C${number}`;
    return name || 'Platz';
  }

  function renderCourtLabel(court) {
    const full = String(court?.name || '').trim() || 'Platz';
    const short = courtLabel(court);
    return short === full ? escape(full)
      : `<span class="court-name-full">${escape(full)}</span><span class="court-name-short">${escape(short)}</span>`;
  }

  function hourBounds(data, hoursFilter = 'office') {
    return { from: Math.max(minute(data.opening.from), hoursFilter === 'office' ? 7 * 60 : 0),
      until: Math.min(minute(data.opening.until), hoursFilter === 'office' ? 20 * 60 : 24 * 60) };
  }

  function overlapsBooking(slot, bookings) {
    return bookings.some(booking => booking.courtId === slot.courtId
      && Date.parse(slot.start) < Date.parse(booking.end)
      && Date.parse(slot.end) > Date.parse(booking.start));
  }

  function visibleSlots(data, hoursFilter = 'office', bookings = []) {
    if (!data) return [];
    const bounds = hourBounds(data, hoursFilter);
    return data.slots.filter(slot => currentSlot(slot) && minute(slot.time) >= bounds.from && minute(slot.time) + 60 <= bounds.until
      && !overlapsBooking(slot, bookings));
  }

  function buildTimes(data, hoursFilter = 'office', extraSlots = []) {
    const bounds = hourBounds(data, hoursFilter);
    const times = new Set();
    for (let time = bounds.from; time < bounds.until; time += 30) times.add(timeLabel(time));
    for (const slot of [...data.slots, ...extraSlots]) {
      const start = minute(slot.time);
      const duration = slot.duration || 60;
      for (let offset = 0; offset < duration; offset += 30) {
        const time = start + offset;
        if (time >= bounds.from && time < bounds.until) times.add(timeLabel(time));
      }
    }
    return [...times].sort();
  }

  function renderAppointmentRow(times, appointments = [], skeleton = false) {
    if (!times.length) return '';
    const from = minute(times[0]);
    const until = minute(times.at(-1)) + 30;
    const position = value => {
      for (let index = 0; index < times.length; index++) {
        const start = minute(times[index]);
        const end = index + 1 < times.length ? minute(times[index + 1]) : until;
        if (value < end) return index + (value - start) / (end - start);
      }
      return times.length;
    };
    const lanes = [];
    const entries = appointments.map(entry => ({ ...entry, from: Math.max(from, minute(entry.time)),
      until: Math.min(until, minute(entry.time) + entry.duration) }))
      .filter(entry => entry.until > entry.from)
      .sort((a, b) => a.from - b.from || a.id.localeCompare(b.id));
    const blocks = entries.map(entry => {
      let lane = lanes.findIndex(end => end <= entry.from);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = entry.until;
      const left = position(entry.from) / times.length * 100;
      const width = (position(entry.until) - position(entry.from)) / times.length * 100;
      const info = `${entry.label} · ${entry.time}–${timeLabel(minute(entry.time) + entry.duration)} Uhr${entry.participants ? ` · ${entry.participants}` : ''}`;
      return `<span class="court-appointment" tabindex="0" role="img" aria-label="${escape(info)}" data-court-appointment-info="${escape(info)}" style="left:${left}%;width:${width}%;top:${lane * 35}px">${escape(entry.shortLabel)}</span>`;
    }).join('');
    return `<tr class="court-unassigned-row"><th scope="row"><span class="sr-only">Termine ohne zugeordnete Platzbuchung</span></th><td colspan="${times.length}"><div class="court-appointment-track"><div class="court-appointment-lanes" style="height:${Math.max(34, lanes.length * 35 - 1)}px">${skeleton ? '' : blocks}</div></div></td></tr>`;
  }

  // Public court metadata only. Never infer free times from this fallback.
  const fallbackCourts = [
    {"id": "88801221-e24c-420c-9f44-98209675546e", "name": "GEIGER Court 1", "location": "outdoor"},
    {"id": "2076aa23-52cb-4ebe-aaaf-a050b84c4202", "name": "CUPRA Court 2", "location": "outdoor"},
    {"id": "8b83cd3c-a998-427c-b60c-a14f20e9bb2a", "name": "CUPRA Court 3", "location": "outdoor"},
    {"id": "54a3822d-7772-4447-b2c2-f6f7a78967ce", "name": "DAS ANDERS Court 4", "location": "outdoor"},
    {"id": "1f343d4c-45b7-4cb3-a4d0-be41a196d10c", "name": "CUPRA Court 5", "location": "outdoor"},
    {"id": "34181566-cc2d-4af8-b102-fc05ed1045d7", "name": "CUPRA Court 6", "location": "outdoor"},
    {"id": "d118983f-c557-4117-ace8-dd078f81718f", "name": "Court 7", "location": "outdoor"},
    {"id": "6ebc6f1a-14cc-4554-ac0a-b35d13f9f3f4", "name": "CUPRA Court 8", "location": "outdoor"},
    {"id": "7ec5ac16-73a1-4bc6-ad62-f0380593353d", "name": "Court 9", "location": "outdoor"},
    {"id": "11dabe24-bf80-4ea2-bbc0-ba0632b3bf21", "name": "Court 10", "location": "outdoor"},
    {"id": "f7c7e37a-1fce-4b29-b3b1-41601f1f591c", "name": "CUPRA Indoor H1", "location": "indoor"},
    {"id": "8778f800-6d2d-46d8-b2b5-fbe35d9ad5b5", "name": "Indoor H2", "location": "indoor"},
    {"id": "ca99238e-ea6f-41e7-bafb-1fd67acc694c", "name": "Indoor H3", "location": "indoor"},
    {"id": "4aeb17f7-868f-4389-bb6e-4828dd0e61da", "name": "CUPRA Indoor H4", "location": "indoor"},
  ];

  function availabilityFailureMessage(reason) {
    const messages = {
      playtomic_timeout: 'Playtomic antwortet gerade nicht.',
      playtomic_unavailable: 'Playtomic ist gerade nicht erreichbar.',
      playtomic_access_denied: 'Playtomic lässt die Platzabfrage gerade nicht zu.',
      playtomic_login_required: 'Playtomic akzeptiert die Anmeldung nicht mehr.',
      playtomic_rate_limited: 'Zu viele Abfragen bei Playtomic. Bitte kurz warten.',
      playtomic_invalid_response: 'Die Platzdaten von Playtomic sind gerade nicht lesbar.',
    };
    return Object.hasOwn(messages, reason) ? messages[reason]
      : 'Freie Plätze nicht abrufbar. Ursache noch unklar.';
  }

  function bookingCalendar(date, bookings, failureReason = 'availability_unavailable') {
    const courts = new Map(fallbackCourts.map(court => [court.id, { ...court }]));
    for (const booking of bookings) {
      if (!booking.court_name) continue;
      const known = [...courts.values()].find(court => normalizeCourtName(court.name) === normalizeCourtName(booking.court_name));
      const id = booking.court_resource_id || known?.id || `booking-court:${normalizeCourtName(booking.court_name)}`;
      if (!courts.has(id)) courts.set(id, {
        id, name: booking.court_name,
        location: /indoor|halle|\bH[1-4]\b/i.test(booking.court_name) ? 'indoor' : 'outdoor',
      });
    }
    // Display bounds, not claimed opening hours or availability.
    return { date, courts: [...courts.values()], opening: { from: '00:00', until: '24:00' },
      slots: [], availabilityUnavailable: true, failureReason };
  }

  const dialog = document.createElement('dialog');
  dialog.id = 'court-availability-dialog';
  dialog.className = 'dialog dialog--page';
  dialog.setAttribute('aria-labelledby', 'court-availability-title');
  dialog.innerHTML = `<div class="dialog-card court-dialog-card">
    <button class="secondary-button modal-close-button" type="button" data-court-close aria-label="Freie Plätze schließen"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6 18 18M18 6 6 18"/></svg></button>
    <header><div class="eyebrow" data-court-context></div><h2 id="court-availability-title">Lucky Star Padel · Freie Plätze</h2></header>
    <div class="court-controls">
      <div class="court-date-controls"><button class="secondary-button detail-view-step" type="button" data-court-day="-1" aria-label="Vorheriger Tag"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m15 18-6-6 6-6"></path></svg></button>
        <label><span data-court-weekday aria-hidden="true">Wochentag</span><input type="date" data-court-date aria-label="Datum" required></label>
        <button class="secondary-button detail-view-step" type="button" data-court-day="1" aria-label="Nächster Tag"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9 18 6-6-6-6"></path></svg></button>
        <button class="secondary-button" type="button" data-court-booking-show hidden>Gebuchten Platz anzeigen</button></div>
      <div class="court-plan-proposal" aria-live="polite">
        <button type="button" class="secondary-button" data-court-proposal hidden></button>
        <span class="hint" data-court-no-proposal hidden>Kein passender Vorschlag vorhanden</span>
      </div>
      <div class="toggle" role="group" aria-label="Plätze filtern">
        <button type="button" data-court-filter="indoor">Indoor</button><button type="button" data-court-filter="outdoor">Outdoor</button>
      </div>
    </div>
    <div class="court-access-health court-outlook-health" data-court-outlook-health role="status" aria-live="polite" hidden></div>
    <div class="court-grid-stage">
      <div class="court-load-state hint" role="status" aria-live="polite">
        <div class="court-outage" data-court-outage hidden>
          <span data-court-outage-reason></span>
          <div class="court-outage-actions">
            <a class="text-link" href="https://playtomic.com/clubs/lucky-star-padel" target="_blank" rel="noopener noreferrer">Playtomic öffnen</a>
            <button type="button" class="text-link" data-court-retry>Erneut versuchen</button>
          </div>
        </div>
        <div data-court-status></div>
      </div>
      <div class="court-grid-wrap" data-court-grid tabindex="0" role="region" aria-label="Plätze und Uhrzeiten; freie Stunden auswählen"></div>
    </div>
    <footer class="court-footer">
      <div class="court-footer-actions"><div class="court-footer-message"><div class="court-selection" data-court-selection role="status" aria-live="polite" aria-invalid="false"></div>
        <p class="hint" data-court-racket-status role="status" aria-live="polite" hidden></p></div>
        <button type="button" class="primary-button" data-court-apply hidden>Uhrzeit übernehmen</button>
        <button type="button" class="text-link" data-court-account>Partie auswählen</button></div>
      <div class="court-legend" aria-label="Legende der Platzbelegung">
        <span class="court-legend-item"><span class="court-legend-swatch is-unavailable" aria-hidden="true"></span><span data-court-unavailable-label>Belegt</span></span>
        <span class="court-legend-item" data-court-free-legend><span class="court-legend-swatch is-free" aria-hidden="true"></span>Frei</span>
        <span class="court-legend-item"><span class="court-legend-swatch is-booked" aria-hidden="true"></span>Gebucht</span>
        <span class="court-legend-item"><span class="court-legend-swatch is-booked is-assigned" aria-hidden="true"></span>Gebucht + andere Partie</span>
        <span class="court-legend-item" data-court-game-legend hidden><span class="court-legend-swatch court-game-block" aria-hidden="true">×</span>Anderes Padelspiel · Gesperrt</span>
        <span class="court-legend-item" data-court-outlook-legend hidden><span class="court-legend-swatch court-outlook-swatch" aria-hidden="true"></span>Outlook-Belegung · Freie Plätze bleiben auswählbar.</span>
      </div>
      <p class="hint">Einen gebuchten Platz kannst du hier auswählen und einer Partie zuordnen. Neue Platzbuchungen sind in dieser Ansicht nicht möglich; sie erfolgen weiterhin über das Hanako Leben Squad oder Ludwig. Partien kannst du hier dennoch terminieren, ohne dadurch einen Platz zu buchen.</p>
    </footer>
    <div id="court-racket-tooltip" class="court-racket-tooltip" role="tooltip" hidden>${racketHint}</div>
  </div>`;
  document.body.append(dialog);
  const dateInput = dialog.querySelector('[data-court-date]');
  const grid = dialog.querySelector('[data-court-grid]');
  const status = dialog.querySelector('[data-court-status]');
  const racketStatus = dialog.querySelector('[data-court-racket-status]');
  const racketTooltip = dialog.querySelector('#court-racket-tooltip');
  let racketAvailability = null, racketController = null;
  let options = {}, data = null, selected = null, filter = 'outdoor', ownBookings = [];
  let availableBookings = [], hoursFilter = 'office', preview = null;
  let calendarUserId = null;
  let planning = null, planningController = null;
  let generation = 0, bookingShortcutVersion = 0, controller = null, interval = null, historyId = null, afterClose = null, trigger = null, revealBookingId = null;

  function updateDateControls() {
    const valid = dateInput.value && dateInput.validity.valid;
    dialog.querySelector('[data-court-weekday]').textContent = valid ? dateLabel(dateInput.value).split(',')[0] : 'Wochentag';
    dialog.querySelector('[data-court-day="-1"]').disabled = !valid || dateInput.value <= today();
  }

  function updateViewControls() {
    dialog.querySelectorAll('[data-court-filter]').forEach(button => {
      const active = button.dataset.courtFilter === filter;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
  }

  function setSelection(slot) {
    selected = slot;
    const court = data?.courts.find(item => item.id === slot?.courtId);
    const selection = dialog.querySelector('[data-court-selection]');
    selection.innerHTML = slot
      ? `${renderCourtLabel(court || { name: slot.courtName })} · ${escape(dateLabel(data.date))} · ${escape(slot.time)}–${escape(clock(slot.end))}${slot.reserved ? ' · Platz bereits gebucht' : ''}` : '';
    selection.setAttribute('aria-invalid', 'false');
    grid.querySelectorAll('[data-court-slot]').forEach(button => {
      const active = button.dataset.courtSlot === slot?.id;
      button.setAttribute('aria-pressed', String(active));
    });
    paintRange();
  }

  function paintRange() {
    for (const cell of grid.querySelectorAll('[data-court-cell]')) {
      const inRange = slot => slot && cell.dataset.courtCell === slot.courtId
        && minute(cell.dataset.courtTime) >= minute(slot.time) && minute(cell.dataset.courtTime) < minute(slot.time) + (slot.duration || 60);
      cell.classList.toggle('is-selected', Boolean(inRange(selected)));
      cell.classList.toggle('is-preview', Boolean(inRange(preview)));
    }
  }

  function normalizeCourtName(value) {
    return String(value || '').toLocaleLowerCase('de-DE').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function bookingMatchNumber(slot) {
    if (slot?.trainingId) return 'TR';
    if (!slot?.matchId) return '';
    return String(slot.matchLabel || '').match(/(\d+)\s*$/)?.[1]
      || String(slot.matchId).match(/(\d+)\s*$/)?.[1]
      || '';
  }

  function visibleBookedSlots(data, hoursFilter = 'office') {
    const bounds = hourBounds(data, hoursFilter);
    return ownBookings.flatMap(booking => {
      const court = data.courts.find(item => item.id === booking.court_resource_id)
        || data.courts.find(item => normalizeCourtName(item.name) === normalizeCourtName(booking.court_name));
      if (!court) return [];
      const time = clock(booking.starts_at);
      const start = minute(time);
      const duration = (Date.parse(booking.ends_at) - Date.parse(booking.starts_at)) / 60000;
      if (![60, 90].includes(duration) || Date.parse(booking.ends_at) <= Date.now()
        || format.format(new Date(booking.starts_at)) !== data.date
        || start >= bounds.until || start + duration <= bounds.from) return [];
      return [{
        id: `booking-${booking.booking_id}`,
        bookingId: Number(booking.booking_id),
        courtId: court.id,
        courtName: court.name,
        start: booking.starts_at,
        end: booking.ends_at,
        duration,
        time,
        matchId: booking.match_id || null,
        trainingId: booking.training_session_id || null,
        matchLabel: booking.match_label || '',
        reserved: true
      }];
    });
  }

  function conflictsWithGame(slot) {
    return planning?.date === data?.date && planning?.games.some(game =>
      Date.parse(slot.start) < game.end && Date.parse(slot.end) > game.start);
  }

  function manuallySelectable(slot) {
    return currentSlot(slot) && !conflictsWithGame(slot);
  }

  function isSelectableBooking(slot) {
    const bounds = hourBounds(data, hoursFilter);
    return manuallySelectable(slot) && minute(slot.time) >= bounds.from
      && minute(slot.time) + slot.duration <= bounds.until
      && !slot.trainingId && (!slot.matchId || slot.matchId === options.matchId);
  }

  function requestedBooking() {
    if (!revealBookingId) return null;
    return ownBookings.find(booking => Number(booking.booking_id) === Number(revealBookingId))
      || availableBookings.find(booking => Number(booking.booking_id) === Number(revealBookingId))
      || null;
  }

  async function loadBookingShortcut() {
    const version = ++bookingShortcutVersion;
    const bookings = await Promise.resolve(window.PadelKonto?.getCourtBookings?.() || []).catch(() => []);
    if (version !== bookingShortcutVersion || !dialog.open) return;
    availableBookings = (Array.isArray(bookings) ? bookings : [])
      .filter(booking => Date.parse(booking.starts_at) > Date.now()
        && !booking.training_session_id && (!booking.match_id || booking.match_id === options.matchId))
      .sort((left, right) => Number(right.match_id === options.matchId) - Number(left.match_id === options.matchId)
        || Date.parse(left.starts_at) - Date.parse(right.starts_at)
        || Number(left.booking_id) - Number(right.booking_id));
    dialog.querySelector('[data-court-booking-show]').hidden = !availableBookings.length;
  }

  function prepareBookedView(booking, nextData) {
    const court = nextData.courts.find(item => item.id === booking.court_resource_id)
      || nextData.courts.find(item => normalizeCourtName(item.name) === normalizeCourtName(booking.court_name));
    if (court) filter = court.location;
    const start = minute(clock(booking.starts_at));
    const duration = (Date.parse(booking.ends_at) - Date.parse(booking.starts_at)) / 60000;
    const office = hourBounds(nextData, 'office');
    hoursFilter = start >= office.from && start + duration <= office.until ? 'office' : 'all';
    updateViewControls();
  }

  function revealBookedSlot(booking) {
    const slot = visibleBookedSlots(data, hoursFilter)
      .find(item => Number(item.bookingId) === Number(booking.booking_id) && isSelectableBooking(item));
    if (!slot) return false;
    const button = grid.querySelector(`[data-court-slot="booking-${Number(booking.booking_id)}"]`);
    if (!button) return false;
    const gridRect = grid.getBoundingClientRect();
    const cellRect = button.closest('td').getBoundingClientRect();
    grid.scrollLeft += cellRect.left + cellRect.width / 2 - gridRect.left - gridRect.width / 2;
    grid.scrollTop += cellRect.top + cellRect.height / 2 - gridRect.top - gridRect.height / 2;
    button.focus({ preventScroll: true });
    return true;
  }

  function findSelectableSlot(slotId) {
    if (!data) return null;
    const booked = visibleBookedSlots(data, hoursFilter);
    return [
      ...visibleSlots(data, hoursFilter, booked),
      ...booked.filter(isSelectableBooking)
    ].find(slot => slot.id === slotId && manuallySelectable(slot));
  }

  function renderGridSkeleton(source = data) {
    const scroll = { top: grid.scrollTop, left: grid.scrollLeft };
    const currentHeight = grid.getBoundingClientRect().height;
    const skeletonData = source || { opening: { from: '07:00', until: '20:00' }, slots: [] };
    const times = buildTimes(skeletonData, hoursFilter);
    const courts = source?.courts.filter(court => court.location === filter) || Array(filter === 'indoor' ? 4 : 10).fill(null);
    if (currentHeight) grid.style.minHeight = `${currentHeight}px`;
    grid.innerHTML = `<table class="court-grid court-grid-skeleton loading-skeleton" aria-hidden="true">
      <thead><tr><th scope="col">Platz</th>${times.map(time => `<th scope="col">${time}</th>`).join('')}</tr></thead>
      <tbody>${courts.map(() => `<tr><th scope="row"><span></span></th>${times.map(() => '<td><span></span></td>').join('')}</tr>`).join('')}${renderAppointmentRow(times, [], true)}</tbody>
    </table>`;
    grid.scrollTop = scroll.top;
    grid.scrollLeft = scroll.left;
  }

  function renderPlanningControls() {
    const isCurrent = planning?.date === dateInput.value && planning?.filter === filter;
    const proposal = isCurrent ? planning.suggestion : null;
    const button = dialog.querySelector('[data-court-proposal]');
    button.hidden = proposal?.state !== 'suggested';
    button.textContent = '';
    if (!button.hidden) {
      const { date, time, courtName } = proposal.slot;
      const label = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' })
        .format(new Date(`${date}T12:00:00Z`));
      button.textContent = `Vorschlag · ${label} · ${time} · ${courtLabel({ name: courtName, location: filter })}`;
    }
    dialog.querySelector('[data-court-no-proposal]').hidden = proposal?.state !== 'no_match';
  }

  async function loadPlanning(date, proposedStart) {
    planningController?.abort();
    const matchId = options.matchId;
    const location = filter;
    const token = window.PadelKonto?.getSession?.()?.access_token;
    const config = window.PADEL_SUPABASE_CONFIG;
    if (!matchId || !token || !config) return null;
    const requestController = new AbortController();
    planningController = requestController;
    const timeout = setTimeout(() => requestController.abort(), 55_000);
    try {
      const response = await fetch(`${config.url}/functions/v1/court-planning`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: config.publishableKey, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ matchId, date, location, includeSuggestion: !proposedStart, proposedStart }), signal: requestController.signal, cache: 'no-store',
      });
      if (!response.ok) return null;
      const result = await response.json();
      if (!Array.isArray(result?.games)) return null;
      return { date, filter: location, ...result };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  function renderOutlookHealth(reason) {
    const warning = dialog.querySelector('[data-court-outlook-health]');
    const messages = {
      reconnect: 'Outlook muss neu verbunden werden.',
      unavailable: 'Die Outlook-Verbindung konnte gerade nicht geprüft werden.',
      calendar_unavailable: 'Mindestens ein Outlook-Kalender konnte nicht abgerufen werden.',
    };
    warning.textContent = window.PadelKonto?.getProfile?.()?.app_role === 'admin' && Object.hasOwn(messages, reason)
      ? `Admin-Hinweis · ${messages[reason]}` : '';
    warning.hidden = !warning.textContent;
  }

  async function loadOutlookHealth(version, active) {
    const account = window.PadelKonto;
    const userId = account?.getSession?.()?.user?.id;
    if (!userId || account.getProfile?.()?.app_role !== 'admin') {
      renderOutlookHealth(null);
      return;
    }
    try {
      const { data, error } = await account.getClient().rpc('get_my_court_outlook_health');
      if (version !== generation || active !== planningController || !dialog.open
        || account.getSession?.()?.user?.id !== userId) return;
      renderOutlookHealth(error ? null : data);
    } catch { /* Outlook diagnostics must not affect the place search. */ }
  }

  function refreshPlanning(date, version, proposedStart) {
    const request = loadPlanning(date, proposedStart);
    const active = planningController;
    return request.then(result => {
      if (version !== generation || !dialog.open || active !== planningController) return null;
      planning = result;
      renderPlanningControls();
      void loadOutlookHealth(version, active);
      if (data?.date === date) renderGrid();
      return result;
    });
  }

  function renderGrid() {
    const unavailable = Boolean(data?.availabilityUnavailable);
    dialog.querySelector('[data-court-outage]').hidden = !unavailable;
    dialog.querySelector('[data-court-outage-reason]').textContent = unavailable ? availabilityFailureMessage(data.failureReason) : '';
    dialog.querySelector('[data-court-free-legend]').hidden = unavailable;
    dialog.querySelector('[data-court-unavailable-label]').textContent = unavailable ? 'Nicht prüfbar' : 'Belegt';
    dialog.querySelector('.court-legend-swatch.is-unavailable').classList.toggle('is-unknown', unavailable);
    const currentPlanning = data && planning?.date === data.date ? planning : null;
    const outlookTimes = new Set(currentPlanning?.outlook ?? []);
    dialog.querySelector('[data-court-outlook-legend]').hidden = !outlookTimes.size;
    dialog.querySelector('[data-court-game-legend]').hidden = !currentPlanning?.games.length;
    if (!data) { grid.replaceChildren(); grid.style.minHeight = ''; return; }
    const scroll = { top: grid.scrollTop, left: grid.scrollLeft };
    const focusId = grid.contains(document.activeElement) ? document.activeElement.dataset.courtSlot : null;
    const courts = data.courts.filter(court => court.location === filter);
    const booked = visibleBookedSlots(data, hoursFilter);
    const times = buildTimes(data, hoursFilter, booked);
    const visible = visibleSlots(data, hoursFilter, booked);
    const gameStarts = new Set(currentPlanning ? times.filter(time => {
      const baseline = new Date(`${data.date}T12:00:00Z`);
      const localMinute = minute(clock(baseline));
      const start = baseline.getTime() + (minute(time) - localMinute) * 60_000;
      return currentPlanning.games.some(game => start < game.end && start + 60 * 60_000 > game.start);
    }) : []);
    const slots = new Map(visible.map(slot => [`${slot.courtId}:${slot.time}`, slot]));
    preview = null;
    grid.innerHTML = courts.length && times.length ? `<table class="court-grid"><caption class="sr-only">${escape(dateLabel(data.date))}, ${unavailable ? 'Buchungen und Termine; freie Plätze nicht prüfbar' : 'freie Startzeiten für 60 Minuten'}</caption>
      <thead><tr><th scope="col">Platz</th>${times.map(time => `<th scope="col">${time}</th>`).join('')}</tr></thead>
      <tbody>${courts.map((court, row) => {
        return `<tr><th scope="row">${renderCourtLabel(court)}</th>${times.map((time, column) => {
        const slot = slots.get(`${court.id}:${time}`);
        const bookedCover = booked.find(item => item.courtId === court.id && minute(time) >= minute(item.time) && minute(time) < minute(item.time) + item.duration);
        const freeCovered = visible.some(item => item.courtId === court.id && minute(time) >= minute(item.time) && minute(time) < minute(item.time) + 60);
        const bookingStart = !bookedCover || time === bookedCover.time;
        const gameBlocked = gameStarts.has(time) || (bookingStart && bookedCover && conflictsWithGame(bookedCover));
        const choice = gameBlocked ? null : bookedCover
          ? isSelectableBooking(bookedCover) ? bookedCover : null
          : slot;
        const outlook = outlookTimes.has(time);
        const adjacent = index => outlookTimes.has(times[index]) && Math.abs(minute(times[index]) - minute(time)) === 30;
        const outlookEdges = outlook ? [
          ' court-outlook', !adjacent(column - 1) ? ' court-outlook-start' : '', !adjacent(column + 1) ? ' court-outlook-end' : '',
          row === 0 ? ' court-outlook-top' : '', row === courts.length - 1 ? ' court-outlook-bottom' : '',
        ].join('') : '';
        const bookingLabel = bookedCover
          ? `Platz bereits gebucht, ${court.name}, ${bookedCover.time} bis ${clock(bookedCover.end)}${bookedCover.matchLabel ? `, ${bookedCover.matchLabel}` : ''}` : '';
        const bookingNumber = bookingMatchNumber(bookedCover);
        const bookingCellIndex = bookedCover ? (minute(time) - minute(bookedCover.time)) / 30 : -1;
        const bookingMarker = bookingNumber && bookingCellIndex === 0
          ? `<span class="court-booking-match-number" aria-hidden="true">${bookingNumber === 'TR' ? 'TR' : `P.${escape(bookingNumber)}`}</span>` : '';
        const className = bookedCover
          ? `is-booked${(bookedCover.matchId || bookedCover.trainingId) ? ' is-assigned' : ''}${minute(time) === minute(bookedCover.time) ? ' is-booked-start' : ''}${minute(time) + 30 >= minute(bookedCover.time) + bookedCover.duration ? ' is-booked-end' : ''}`
          : freeCovered ? 'is-free' : unavailable ? 'is-unknown' : 'is-unavailable';
        const label = choice?.reserved ? bookingLabel : choice ? `${court.name}, ${time} bis ${clock(choice.end)}, frei` : '';
        const racketBusy = !(bookedCover?.matchId || bookedCover?.trainingId) && isRacketBusy(time, data.racketBusyStarts);
        const racketText = (bookedCover?.matchId || bookedCover?.trainingId) ? '' : racketHourHint(time, data.racketBusyStarts);
        return `<td data-court-cell="${escape(court.id)}" data-court-time="${time}" class="${className}${outlookEdges}${gameBlocked ? ' court-game-block' : ''}">${choice
          ? `<button type="button" class="court-slot" data-court-slot="${escape(choice.id)}" data-court-label="${escape(label)}" aria-pressed="false" aria-label="${escape(label + (racketText ? `. ${racketText}` : ''))}"></button>`
          : `<span class="sr-only">${escape(gameBlocked ? 'Anderes Padelspiel · Gesperrt' : bookingLabel || (unavailable ? 'Platzverfügbarkeit nicht prüfbar' : 'Nicht als Stundenbeginn verfügbar'))}</span>`}${gameBlocked ? '<span class="court-game-mark" aria-hidden="true">×</span>'
          : (racketBusy ? renderRacketMarker(Boolean(choice), racketText) : '') + bookingMarker}</td>`;
      }).join('')}</tr>`;
      }).join('')}${renderAppointmentRow(times, data.appointments || [])}</tbody></table>` : '<p class="hint">Für diese Auswahl sind keine Plätze verfügbar.</p>';
    grid.style.minHeight = '';
    grid.scrollTop = scroll.top;
    grid.scrollLeft = scroll.left;
    if (focusId) [...grid.querySelectorAll('[data-court-slot]')].find(button => button.dataset.courtSlot === focusId)?.focus({ preventScroll: true });
    if (selected) {
      const updated = [...visible, ...booked.filter(isSelectableBooking)].find(slot => slot.id === selected.id && manuallySelectable(slot) && courts.some(court => court.id === slot.courtId));
      setSelection(updated || null);
      if (!updated) status.textContent = 'Die ausgewählte Zeit ist nicht mehr verfügbar. Bitte wähle eine andere Zeit.';
    }
  }

  function hideRacketTooltip() {
    racketTooltip.hidden = true;
    grid.querySelectorAll('[aria-describedby="court-racket-tooltip"]').forEach(button => button.removeAttribute('aria-describedby'));
  }

  function showRacketTooltip(event) {
    if (event.type === 'focusin' && !event.target.matches(':focus-visible')) return;
    hideRacketTooltip();
    const appointment = event.target.closest('[data-court-appointment-info]');
    if (appointment) {
      showCalendarTooltip(appointment, appointment.dataset.courtAppointmentInfo, appointment);
      return;
    }
    const cell = event.target.closest('[data-court-cell]');
    if (!cell || cell.classList.contains('is-assigned')) return;
    const hint = racketHourHint(cell.dataset.courtTime, data?.racketBusyStarts);
    if (!hint) return;
    const target = event.type === 'focusin' ? event.target : cell.querySelector('[data-court-slot]') || cell.querySelector('.court-racket-icon') || cell;
    showCalendarTooltip(cell, hint, target);
  }

  function showCalendarTooltip(cell, hint, target) {
    const anchor = cell.getBoundingClientRect();
    const visible = grid.getBoundingClientRect();
    if (anchor.right <= visible.left || anchor.left >= visible.right
      || anchor.bottom <= visible.top || anchor.top >= visible.bottom) return;
    const bounds = dialog.getBoundingClientRect();
    racketTooltip.textContent = hint;
    racketTooltip.hidden = false;
    const width = racketTooltip.offsetWidth;
    const height = racketTooltip.offsetHeight;
    racketTooltip.style.left = `${Math.max(bounds.left + 8, Math.min(anchor.left + anchor.width / 2 - width / 2, bounds.right - width - 8))}px`;
    racketTooltip.style.top = `${anchor.bottom + height + 8 < bounds.bottom ? anchor.bottom + 6 : anchor.top - height - 6}px`;
    target.setAttribute('aria-describedby', 'court-racket-tooltip');
  }

  // Ein nachgeladener Schlägerstatus verändert weder die Platzwahl noch den Fokus.
  function applyRacketAvailability() {
    hideRacketTooltip();
    if (!data) return;
    data.racketBusyStarts = racketAvailability?.date === data.date ? racketAvailability.busyStarts : [];
    grid.querySelectorAll('[data-court-cell]').forEach(cell => {
      const button = cell.querySelector('[data-court-slot]');
      const assigned = cell.classList.contains('is-assigned');
      const busy = !assigned && isRacketBusy(cell.dataset.courtTime, data.racketBusyStarts);
      const hint = assigned ? '' : racketHourHint(cell.dataset.courtTime, data.racketBusyStarts);
      const marker = cell.querySelector('.court-racket-icon');
      if (busy && !marker) cell.insertAdjacentHTML('beforeend', renderRacketMarker(Boolean(button), hint));
      if (!busy) marker?.remove();
      if (marker?.matches('[role="img"]')) marker.setAttribute('aria-label', hint);
      button?.setAttribute('aria-label', button.dataset.courtLabel + (hint ? `. ${hint}` : ''));
    });
    if (grid.contains(document.activeElement) && document.activeElement.matches(':focus-visible')) {
      showRacketTooltip({ target: document.activeElement, type: 'focusin' });
    }
  }

  async function loadRacketAvailability(date, version) {
    racketController?.abort();
    const requestController = new AbortController();
    racketController = requestController;
    const timeout = setTimeout(() => requestController.abort(), 12000);
    try {
      const config = window.PADEL_SUPABASE_CONFIG;
      const response = await fetch(`${config.url}/functions/v1/racket-availability`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: config.publishableKey },
        body: JSON.stringify({ date }), signal: requestController.signal, cache: 'no-store',
      });
      if (!response.ok) throw new Error('Nicht verfügbar');
      const result = await response.json();
      if (result.date !== date || !Array.isArray(result.busyStarts)
        || !result.busyStarts.every(time => typeof time === 'string' && /^([01]\d|2[0-3]):(00|30)$/.test(time))) throw new Error('Ungültige Antwort');
      if (version !== generation || !dialog.open) return;
      racketAvailability = result;
      racketStatus.textContent = ''; racketStatus.hidden = true;
      applyRacketAvailability();
    } catch {
      if (version !== generation || !dialog.open) return;
      racketAvailability = null;
      applyRacketAvailability();
      racketStatus.textContent = 'Schlägerbelegung gerade nicht prüfbar.'; racketStatus.hidden = false;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function load(background = false, proposedSlot = null) {
    if (!dialog.open || document.hidden) return;
    const version = ++generation;
    controller?.abort();
    const requestController = new AbortController();
    controller = requestController;
    const timeout = setTimeout(() => requestController.abort(), 15000);
    const date = dateInput.value;
    hideRacketTooltip();
    if (!background) {
      planning = null;
      renderPlanningControls();
    }
    updateDateControls();
    if (!date || !dateInput.validity.valid) {
      racketController?.abort(); racketAvailability = null;
      racketStatus.textContent = ''; racketStatus.hidden = true;
      clearTimeout(timeout); data = null; setSelection(null); renderGrid();
      status.textContent = 'Bitte ein gültiges zukünftiges Datum wählen.';
      return;
    }
    if (!background || racketAvailability?.date !== date) {
      racketAvailability = null;
      racketStatus.textContent = ''; racketStatus.hidden = true;
    }
    const planningRequest = refreshPlanning(date, version, proposedSlot?.start);
    void loadRacketAvailability(date, version);
    grid.setAttribute('aria-busy', 'true');
    if (!background) {
      const skeletonSource = data;
      setSelection(null); data = null; renderGridSkeleton(skeletonSource);
      status.textContent = '';
    }
    try {
      const config = window.PADEL_SUPABASE_CONFIG;
      const ownBookingsPromise = Promise.resolve(window.PadelKonto?.getCourtBookings?.(date) || [])
        .catch(() => []);
      const appointmentsPromise = Promise.resolve(window.PadelKonto?.getCourtAppointments?.(date) || [])
        .catch(() => []);
      const publicAvailability = (async () => {
        const response = await fetch(`${config.url}/functions/v1/court-availability`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', apikey: config.publishableKey },
          body: JSON.stringify({ date }), signal: requestController.signal, cache: 'no-store',
        });
        if (!response.ok) {
          const failure = await response.json().catch(() => null);
          const reason = failure?.source === 'playtomic' && [
            'playtomic_timeout', 'playtomic_unavailable', 'playtomic_access_denied',
            'playtomic_login_required', 'playtomic_rate_limited', 'playtomic_invalid_response',
          ].includes(failure.reason) ? failure.reason : 'availability_unavailable';
          throw Object.assign(new Error('Nicht verfügbar'), { availabilityReason: reason });
        }
        const result = await response.json();
        if (result.date !== date || !Array.isArray(result.courts) || !Array.isArray(result.slots) || !result.opening) throw new Error('Ungültige Antwort');
        return { value: result };
      })().catch(error => ({ value: null, reason: error?.availabilityReason || 'availability_unavailable' }));
      const [publicData, bookings, appointments] = await Promise.all([
        publicAvailability, ownBookingsPromise, appointmentsPromise,
      ]);
      if (version !== generation || !dialog.open) return;
      const result = publicData.value || bookingCalendar(date, Array.isArray(bookings) ? bookings : [], publicData.reason);
      data = result;
      data.racketBusyStarts = racketAvailability?.date === date ? racketAvailability.busyStarts : [];
      ownBookings = Array.isArray(bookings) ? bookings : [];
      const assignedIds = new Set(ownBookings.map(booking => booking.training_session_id
        ? `training:${booking.training_session_id}` : `match:${booking.match_id}`));
      data.appointments = (Array.isArray(appointments) ? appointments : []).filter(entry => !assignedIds.has(entry.id));
      const revealRequested = Boolean(revealBookingId);
      const bookingToReveal = requestedBooking();
      if (bookingToReveal) prepareBookedView(bookingToReveal, result);
      status.textContent = '';
      renderGrid();
      if (revealRequested) {
        if (!bookingToReveal || !revealBookedSlot(bookingToReveal)) {
          status.textContent = 'Der gebuchte Platz konnte im Raster nicht gefunden werden.';
        }
        revealBookingId = null;
      }
      if (!result.availabilityUnavailable && !status.textContent && !selected
        && !visibleSlots(result, hoursFilter, visibleBookedSlots(result, hoursFilter)).some(slot => result.courts.some(court => court.id === slot.courtId && court.location === filter))
        && !visibleBookedSlots(result, hoursFilter).some(slot => result.courts.some(court => court.id === slot.courtId && court.location === filter))) {
        status.textContent = 'Für diese Auswahl sind keine freien Stunden verfügbar.';
      }
      if (proposedSlot) {
        const fresh = await planningRequest;
        if (version !== generation || !dialog.open) return;
        const slot = fresh?.fitsOutlook && findSelectableSlot(proposedSlot.id);
        if (slot) {
          setSelection(slot);
          const button = [...grid.querySelectorAll('[data-court-slot]')].find(item => item.dataset.courtSlot === proposedSlot.id);
          button?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          button?.focus({ preventScroll: true });
        }
        void refreshPlanning(date, version);
      }
    } catch (_error) {
      if (version !== generation || !dialog.open) return;
      data = null; ownBookings = []; setSelection(null); renderGrid();
      status.innerHTML = 'Freie Plätze konnten nicht geladen werden. <button type="button" class="text-link" data-court-retry>Erneut versuchen</button>';
    } finally {
      clearTimeout(timeout);
      if (version === generation) grid.setAttribute('aria-busy', 'false');
    }
  }

  function finishClose() {
    generation++; controller?.abort(); planningController?.abort(); planning = null; clearInterval(interval); interval = null;
    racketController?.abort(); racketAvailability = null; hideRacketTooltip();
    if (dialog.open) dialog.close();
    historyId = null;
    const callback = afterClose;
    afterClose = null;
    const focus = trigger;
    bookingShortcutVersion++;
    options = {}; data = null; ownBookings = []; availableBookings = []; selected = null; revealBookingId = null;
    if (focus?.isConnected) focus.focus({ preventScroll: true });
    callback?.();
  }

  function close(callback) {
    afterClose = typeof callback === 'function' ? callback : null;
    if (historyId && history.state?.courtAvailability === historyId) history.back();
    else finishClose();
  }

  function open(next = {}) {
    if (dialog.open) return;
    options = next;
    calendarUserId = window.PadelKonto?.getSession?.()?.user?.id || null;
    trigger = next.trigger || document.activeElement;
    filter = defaultFilter(next.seasonId);
    hoursFilter = 'office'; preview = null; revealBookingId = null; availableBookings = []; planning = null;
    renderPlanningControls();
    renderOutlookHealth(null);
    updateViewControls();
    dateInput.min = today();
    dateInput.value = next.date && next.date >= today() ? next.date : today();
    updateDateControls();
    dialog.querySelector('[data-court-context]').textContent = next.label || 'Platzverfügbarkeit';
    dialog.querySelector('[data-court-booking-show]').hidden = true;
    dialog.querySelector('[data-court-apply]').hidden = !next.onSelect;
    dialog.querySelector('[data-court-account]').hidden = Boolean(next.onSelect);
    data = null; ownBookings = []; setSelection(null); renderGrid();
    // Ein bereits geöffnetes mobiles Konto muss seinen Verlaufsschritt vor
    // dem darüberliegenden Modal erhalten, auch bei unmittelbar folgendem Öffnen.
    window.PadelMobileDialogPages?.sync();
    dialog.showModal();
    historyId = `court-${Date.now()}`;
    history.pushState({ ...history.state, courtAvailability: historyId }, '', location.href);
    void loadBookingShortcut();
    void load();
    interval = setInterval(() => { if (!document.hidden) void load(true); }, 60000);
  }

  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('click', event => {
    if (event.target === dialog || event.target.closest('[data-court-close]')) { close(); return; }
    if (event.target.closest('[data-court-booking-show]') && availableBookings.length) {
      const booking = availableBookings[0];
      revealBookingId = Number(booking.booking_id);
      dateInput.value = format.format(new Date(booking.starts_at));
      void load(); return;
    }
    if (event.target.closest('[data-court-proposal]')) {
      const suggestion = planning?.suggestion;
      if (suggestion?.state === 'suggested') {
        dateInput.value = suggestion.slot.date;
        void load(false, suggestion.slot);
      }
      return;
    }
    const day = event.target.closest('[data-court-day]');
    if (day) {
      const date = new Date(`${dateInput.value}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + Number(day.dataset.courtDay));
      dateInput.value = date.toISOString().slice(0, 10) < today() ? today() : date.toISOString().slice(0, 10);
      void load(); return;
    }
    const filterButton = event.target.closest('[data-court-filter]');
    if (filterButton) {
      hideRacketTooltip();
      filter = filterButton.dataset.courtFilter;
      dialog.querySelectorAll('[data-court-filter]').forEach(button => {
        const active = button === filterButton;
        button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
      });
      if (selected && !data?.courts.some(court => court.id === selected.courtId && court.location === filter)) setSelection(null);
      status.textContent = ''; renderGrid(); renderPlanningControls();
      if (options.matchId) void refreshPlanning(dateInput.value, generation);
      return;
    }
    if (event.target.closest('[data-court-retry]')) { void load(); return; }
    if (event.target.closest('[data-court-account]')) { close(() => window.PadelKonto?.chooseCourtMatch(null)); return; }
    const slotButton = event.target.closest('[data-court-slot]')
      || event.target.closest('.court-racket-icon')?.closest('[data-court-cell]')?.querySelector('[data-court-slot]');
    if (slotButton) {
      const slot = findSelectableSlot(slotButton.dataset.courtSlot);
      if (!slot) { void load(); return; }
      if (options.onSelect) setSelection(slot);
      else { const selection = { ...slot, date: data.date }; close(() => window.PadelKonto?.chooseCourtMatch(selection)); }
      return;
    }
    if (event.target.closest('[data-court-apply]')) {
      if (!selected || !manuallySelectable(selected)) {
        setSelection(null);
        const selection = dialog.querySelector('[data-court-selection]');
        selection.textContent = 'Bitte wähle zuerst eine freie Zeit aus.';
        selection.setAttribute('aria-invalid', 'true');
        return;
      }
      const selection = { ...selected, date: data.date };
      const onSelect = options.onSelect;
      close(() => onSelect?.(selection));
    }
  });
  const previewSlot = event => {
    const button = event.target.closest('[data-court-slot]')
      || event.target.closest('.court-racket-icon')?.closest('[data-court-cell]')?.querySelector('[data-court-slot]');
    preview = button ? findSelectableSlot(button.dataset.courtSlot) : null;
    paintRange();
    showRacketTooltip(event);
  };
  grid.addEventListener('pointerover', previewSlot);
  grid.addEventListener('focusin', previewSlot);
  grid.addEventListener('pointerleave', () => { preview = null; paintRange(); hideRacketTooltip(); });
  grid.addEventListener('focusout', () => { preview = null; paintRange(); hideRacketTooltip(); });
  grid.addEventListener('scroll', () => {
    hideRacketTooltip();
    if (grid.contains(document.activeElement) && document.activeElement.matches(':focus-visible')) {
      showRacketTooltip({ target: document.activeElement, type: 'focusin' });
    }
  }, { capture: true });
  window.addEventListener('resize', hideRacketTooltip);
  dateInput.addEventListener('change', () => { if (dateInput.validity.valid) void load(); });
  window.addEventListener('popstate', () => { if (dialog.open && history.state?.courtAvailability !== historyId) finishClose(); });
  document.addEventListener('visibilitychange', () => { if (dialog.open && !document.hidden) void load(true); });
  window.addEventListener('padel:auth-state-changed', event => {
    const userId = event.detail?.session?.user?.id || null;
    if (!dialog.open) return;
    if (event.detail?.profile?.app_role !== 'admin') renderOutlookHealth(null);
    if (userId === calendarUserId) return;
    calendarUserId = userId;
    planningController?.abort(); planning = null; renderPlanningControls(); renderOutlookHealth(null);
    ownBookings = [];
    if (data) { data.appointments = []; renderGrid(); }
    void load();
  });
  document.addEventListener('click', event => {
    const link = event.target.closest('[data-court-info-open]');
    if (link) { event.preventDefault(); open({ seasonId: link.dataset.courtSeason, trigger: link }); }
  });
  window.PadelCourtAvailability = { open, close, defaultFilter, buildTimes, visibleSlots };
})();
