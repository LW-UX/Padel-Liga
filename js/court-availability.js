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

  const dialog = document.createElement('dialog');
  dialog.id = 'court-availability-dialog';
  dialog.className = 'dialog dialog--page';
  dialog.setAttribute('aria-labelledby', 'court-availability-title');
  dialog.innerHTML = `<div class="dialog-card court-dialog-card">
    <button class="secondary-button modal-close-button" type="button" data-court-close aria-label="Freie Plätze schließen"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6 18 18M18 6 6 18"/></svg></button>
    <header><div class="eyebrow" data-court-context></div><h2 id="court-availability-title">Freie Plätze · Lucky Star Padel</h2></header>
    <div class="court-controls">
      <div class="court-date-controls"><button class="secondary-button detail-view-step" type="button" data-court-day="-1" aria-label="Vorheriger Tag"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m15 18-6-6 6-6"></path></svg></button>
        <label><span data-court-weekday aria-hidden="true">Wochentag</span><input type="date" data-court-date aria-label="Datum" required></label>
        <button class="secondary-button detail-view-step" type="button" data-court-day="1" aria-label="Nächster Tag"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9 18 6-6-6-6"></path></svg></button>
        <button class="secondary-button" type="button" data-court-booking-show hidden>Gebuchten Platz anzeigen</button></div>
      <div class="toggle" role="group" aria-label="Plätze filtern">
        <button type="button" data-court-filter="indoor">Indoor</button><button type="button" data-court-filter="outdoor">Outdoor</button>
      </div>
    </div>
    <div class="court-grid-stage">
      <div class="court-load-state hint" role="status" aria-live="polite" data-court-status></div>
      <div class="court-grid-wrap" data-court-grid tabindex="0" role="region" aria-label="Plätze und Uhrzeiten; freie Stunden auswählen"></div>
    </div>
    <footer class="court-footer">
      <p class="hint" data-court-racket-status role="status" aria-live="polite" hidden></p>
      <p class="hint">Markierte Felder kennzeichnen bereits offiziell gebuchte Plätze. Du kannst sie hier auswählen und einer Partie zuordnen. Neue Platzbuchungen sind in dieser Ansicht nicht möglich; sie erfolgen weiterhin über das Hanako Leben Squad oder Ludwig. Partien kannst du hier dennoch terminieren, ohne dadurch einen Platz zu buchen.</p>
      <div class="court-footer-actions"><div class="court-selection" data-court-selection role="status" aria-live="polite" aria-invalid="false"></div>
        <button type="button" class="primary-button" data-court-apply hidden>Uhrzeit übernehmen</button>
        <button type="button" class="text-link" data-court-account>Partie auswählen</button></div>
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
    selection.textContent = slot
      ? `${court?.name || slot.courtName || 'Platz'} · ${dateLabel(data.date)} · ${slot.time}–${clock(slot.end)}${slot.reserved ? ' · Platz bereits gebucht' : ''}` : '';
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
        matchLabel: booking.match_label || '',
        reserved: true
      }];
    });
  }

  function isSelectableBooking(slot) {
    const bounds = hourBounds(data, hoursFilter);
    return currentSlot(slot) && minute(slot.time) >= bounds.from
      && minute(slot.time) + slot.duration <= bounds.until
      && (!slot.matchId || slot.matchId === options.matchId);
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
        && (!booking.match_id || booking.match_id === options.matchId))
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
    ].find(slot => slot.id === slotId && currentSlot(slot));
  }

  function renderGridSkeleton(source = data) {
    const scroll = { top: grid.scrollTop, left: grid.scrollLeft };
    const currentHeight = grid.getBoundingClientRect().height;
    const skeletonData = source || { opening: { from: '07:00', until: '20:00' }, slots: [] };
    const times = buildTimes(skeletonData, hoursFilter);
    const courts = source?.courts.filter(court => court.location === filter) || Array(4).fill(null);
    if (currentHeight) grid.style.minHeight = `${currentHeight}px`;
    grid.innerHTML = `<table class="court-grid court-grid-skeleton loading-skeleton" aria-hidden="true">
      <thead><tr><th scope="col">Platz</th>${times.map(time => `<th scope="col">${time}</th>`).join('')}</tr></thead>
      <tbody>${courts.map(court => `<tr><th scope="row">${court ? escape(court.name) : '<span></span>'}</th>${times.map(() => '<td><span></span></td>').join('')}</tr>`).join('')}</tbody>
    </table>`;
    grid.scrollTop = scroll.top;
    grid.scrollLeft = scroll.left;
  }

  function renderGrid() {
    if (!data) { grid.replaceChildren(); grid.style.minHeight = ''; return; }
    const scroll = { top: grid.scrollTop, left: grid.scrollLeft };
    const focusId = grid.contains(document.activeElement) ? document.activeElement.dataset.courtSlot : null;
    const courts = data.courts.filter(court => court.location === filter);
    const booked = visibleBookedSlots(data, hoursFilter);
    const times = buildTimes(data, hoursFilter, booked);
    const visible = visibleSlots(data, hoursFilter, booked);
    const slots = new Map(visible.map(slot => [`${slot.courtId}:${slot.time}`, slot]));
    preview = null;
    grid.innerHTML = courts.length && times.length ? `<table class="court-grid"><caption class="sr-only">${escape(dateLabel(data.date))}, freie Startzeiten für 60 Minuten</caption>
      <thead><tr><th scope="col">Platz</th>${times.map(time => `<th scope="col">${time}</th>`).join('')}</tr></thead>
      <tbody>${courts.map(court => `<tr><th scope="row">${escape(court.name)}</th>${times.map(time => {
        const slot = slots.get(`${court.id}:${time}`);
        const bookedCover = booked.find(item => item.courtId === court.id && minute(time) >= minute(item.time) && minute(time) < minute(item.time) + item.duration);
        const freeCovered = visible.some(item => item.courtId === court.id && minute(time) >= minute(item.time) && minute(time) < minute(item.time) + 60);
        const choice = bookedCover && isSelectableBooking(bookedCover) ? bookedCover : bookedCover ? null : slot;
        const bookingLabel = bookedCover
          ? `Platz bereits gebucht, ${court.name}, ${bookedCover.time} bis ${clock(bookedCover.end)}${bookedCover.matchLabel ? `, ${bookedCover.matchLabel}` : ''}` : '';
        const bookingNumber = bookingMatchNumber(bookedCover);
        const bookingCellIndex = bookedCover ? (minute(time) - minute(bookedCover.time)) / 30 : -1;
        const bookingMarker = bookingNumber && bookingCellIndex < 2
          ? `<span class="court-booking-match-number ${bookingCellIndex === 0 ? 'is-prefix' : 'is-number'}" aria-hidden="true">${bookingCellIndex === 0 ? 'P#' : escape(bookingNumber)}</span>` : '';
        const className = bookedCover
          ? `is-booked${bookedCover.matchId ? ' is-assigned' : ''}${minute(time) === minute(bookedCover.time) ? ' is-booked-start' : ''}${minute(time) + 30 >= minute(bookedCover.time) + bookedCover.duration ? ' is-booked-end' : ''}`
          : freeCovered ? 'is-free' : 'is-unavailable';
        const label = choice?.reserved ? bookingLabel : choice ? `${court.name}, ${time} bis ${clock(choice.end)}, frei` : '';
        const racketBusy = choice && isRacketBusy(choice.time, data.racketBusyStarts);
        return `<td data-court-cell="${escape(court.id)}" data-court-time="${time}" class="${className}">${choice
          ? `<button type="button" class="court-slot" data-court-slot="${escape(choice.id)}" data-court-racket-start="${escape(choice.time)}" data-court-label="${escape(label)}" aria-pressed="false" aria-label="${escape(label + (racketBusy ? `. ${racketHint}` : ''))}">${racketBusy ? racketIcon : ''}</button>`
          : `<span class="sr-only">${escape(bookingLabel || 'Nicht als Stundenbeginn verfügbar')}</span>`}${bookingMarker}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table>` : '<p class="hint">Für diese Auswahl sind keine Plätze verfügbar.</p>';
    grid.style.minHeight = '';
    grid.scrollTop = scroll.top;
    grid.scrollLeft = scroll.left;
    if (focusId) [...grid.querySelectorAll('[data-court-slot]')].find(button => button.dataset.courtSlot === focusId)?.focus({ preventScroll: true });
    if (selected) {
      const updated = [...visible, ...booked.filter(isSelectableBooking)].find(slot => slot.id === selected.id && courts.some(court => court.id === slot.courtId));
      setSelection(updated || null);
      if (!updated) status.textContent = 'Die ausgewählte Zeit ist nicht mehr verfügbar. Bitte wähle eine andere Zeit.';
    }
  }

  function hideRacketTooltip() {
    racketTooltip.hidden = true;
    grid.querySelectorAll('[aria-describedby="court-racket-tooltip"]').forEach(button => button.removeAttribute('aria-describedby'));
  }

  function showRacketTooltip(event) {
    const button = event.target.closest('[data-court-racket-start]');
    if (event.type === 'focusin' && !button?.matches(':focus-visible')) return;
    hideRacketTooltip();
    if (!button?.querySelector('.court-racket-icon')
      || event.type === 'pointerover' && !event.target.closest('.court-racket-icon')) return;
    const anchor = button.getBoundingClientRect();
    const visible = grid.getBoundingClientRect();
    if (anchor.right <= visible.left || anchor.left >= visible.right
      || anchor.bottom <= visible.top || anchor.top >= visible.bottom) return;
    const bounds = dialog.getBoundingClientRect();
    racketTooltip.hidden = false;
    const width = racketTooltip.offsetWidth;
    const height = racketTooltip.offsetHeight;
    racketTooltip.style.left = `${Math.max(bounds.left + 8, Math.min(anchor.left + anchor.width / 2 - width / 2, bounds.right - width - 8))}px`;
    racketTooltip.style.top = `${anchor.bottom + height + 8 < bounds.bottom ? anchor.bottom + 6 : anchor.top - height - 6}px`;
    button.setAttribute('aria-describedby', 'court-racket-tooltip');
  }

  // Ein nachgeladener Schlägerstatus verändert weder die Platzwahl noch den Fokus.
  function applyRacketAvailability() {
    hideRacketTooltip();
    if (!data) return;
    data.racketBusyStarts = racketAvailability?.date === data.date ? racketAvailability.busyStarts : [];
    grid.querySelectorAll('[data-court-racket-start]').forEach(button => {
      const busy = isRacketBusy(button.dataset.courtRacketStart, data.racketBusyStarts);
      button.innerHTML = busy ? racketIcon : '';
      button.setAttribute('aria-label', button.dataset.courtLabel + (busy ? `. ${racketHint}` : ''));
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

  async function load(background = false) {
    if (!dialog.open || document.hidden) return;
    const version = ++generation;
    controller?.abort();
    const requestController = new AbortController();
    controller = requestController;
    const timeout = setTimeout(() => requestController.abort(), 15000);
    const date = dateInput.value;
    hideRacketTooltip();
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
      const response = await fetch(`${config.url}/functions/v1/court-availability`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: config.publishableKey },
        body: JSON.stringify({ date }), signal: requestController.signal, cache: 'no-store',
      });
      if (!response.ok) throw new Error('Nicht verfügbar');
      const result = await response.json();
      const bookings = await ownBookingsPromise;
      if (version !== generation || !dialog.open) return;
      if (result.date !== date || !Array.isArray(result.courts) || !Array.isArray(result.slots) || !result.opening) throw new Error('Ungültige Antwort');
      data = result;
      data.racketBusyStarts = racketAvailability?.date === date ? racketAvailability.busyStarts : [];
      ownBookings = Array.isArray(bookings) ? bookings : [];
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
      if (!status.textContent && !selected
        && !visibleSlots(result, hoursFilter, visibleBookedSlots(result, hoursFilter)).some(slot => result.courts.some(court => court.id === slot.courtId && court.location === filter))
        && !visibleBookedSlots(result, hoursFilter).some(slot => result.courts.some(court => court.id === slot.courtId && court.location === filter))) {
        status.textContent = 'Für diese Auswahl sind keine freien Stunden verfügbar.';
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
    generation++; controller?.abort(); clearInterval(interval); interval = null;
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
    trigger = next.trigger || document.activeElement;
    filter = defaultFilter(next.seasonId);
    hoursFilter = 'office'; preview = null; revealBookingId = null; availableBookings = [];
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
      status.textContent = ''; renderGrid(); return;
    }
    if (event.target.closest('[data-court-retry]')) { void load(); return; }
    if (event.target.closest('[data-court-account]')) { close(() => window.PadelKonto?.chooseCourtMatch(null)); return; }
    const slotButton = event.target.closest('[data-court-slot]');
    if (slotButton) {
      const slot = findSelectableSlot(slotButton.dataset.courtSlot);
      if (!slot) { void load(); return; }
      if (options.onSelect) setSelection(slot);
      else { const selection = { ...slot, date: data.date }; close(() => window.PadelKonto?.chooseCourtMatch(selection)); }
      return;
    }
    if (event.target.closest('[data-court-apply]')) {
      if (!selected || !currentSlot(selected)) {
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
    const button = event.target.closest('[data-court-slot]');
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
  });
  window.addEventListener('resize', hideRacketTooltip);
  dateInput.addEventListener('change', () => { if (dateInput.validity.valid) void load(); });
  window.addEventListener('popstate', () => { if (dialog.open && history.state?.courtAvailability !== historyId) finishClose(); });
  document.addEventListener('visibilitychange', () => { if (dialog.open && !document.hidden) void load(true); });
  document.addEventListener('click', event => {
    const link = event.target.closest('[data-court-info-open]');
    if (link) { event.preventDefault(); open({ seasonId: link.dataset.courtSeason, trigger: link }); }
  });
  window.PadelCourtAvailability = { open, close, defaultFilter, buildTimes, visibleSlots };
})();
