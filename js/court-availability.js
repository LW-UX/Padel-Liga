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

  function hourBounds(data, hoursFilter = 'office') {
    return { from: Math.max(minute(data.opening.from), hoursFilter === 'office' ? 7 * 60 : 0),
      until: Math.min(minute(data.opening.until), hoursFilter === 'office' ? 20 * 60 : 24 * 60) };
  }

  function visibleSlots(data, hoursFilter = 'office') {
    if (!data) return [];
    const bounds = hourBounds(data, hoursFilter);
    return data.slots.filter(slot => currentSlot(slot) && minute(slot.time) >= bounds.from && minute(slot.time) + 60 <= bounds.until);
  }

  function buildTimes(data, hoursFilter = 'office', extraSlots = []) {
    const bounds = hourBounds(data, hoursFilter);
    const times = new Set();
    for (let time = bounds.from; time < bounds.until; time += 30) times.add(timeLabel(time));
    for (const slot of [...data.slots, ...extraSlots]) {
      const start = minute(slot.time);
      const duration = slot.duration || 60;
      if (start >= bounds.from && start + duration <= bounds.until) {
        for (let offset = 0; offset < duration; offset += 30) times.add(timeLabel(start + offset));
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
        <div class="toggle court-hours-filter" role="group" aria-label="Stunden filtern">
          <button type="button" data-court-hours="all">Alle Stunden</button><button type="button" data-court-hours="office">Bürozeiten</button>
        </div></div>
      <div class="toggle" role="group" aria-label="Plätze filtern">
        <button type="button" data-court-filter="indoor">Indoor</button><button type="button" data-court-filter="outdoor">Outdoor</button>
      </div>
    </div>
    <div class="court-grid-stage">
      <div class="court-load-state hint" role="status" aria-live="polite" data-court-status></div>
      <div class="court-grid-wrap" data-court-grid tabindex="0" role="region" aria-label="Plätze und Uhrzeiten; freie Stunden auswählen"></div>
    </div>
    <footer class="court-footer">
      <p class="hint">Freie Flächen: 60 Minuten auswählen. Hover oder Tastaturfokus markiert die ganze Stunde.</p>
      <p class="hint">Die Auswahl reserviert keinen Platz. Die Platzbuchung erfolgt weiterhin über das Hanako Leben Squad oder Ludwig.</p>
      <div class="court-footer-actions"><div class="court-selection" data-court-selection role="status" aria-live="polite" aria-invalid="false"></div>
        <button type="button" class="primary-button" data-court-apply hidden>Uhrzeit übernehmen</button>
        <button type="button" class="text-link" data-court-account>Partie auswählen</button></div>
    </footer>
  </div>`;
  document.body.append(dialog);
  const dateInput = dialog.querySelector('[data-court-date]');
  const grid = dialog.querySelector('[data-court-grid]');
  const status = dialog.querySelector('[data-court-status]');
  let options = {}, data = null, selected = null, filter = 'outdoor', ownBookings = [];
  let hoursFilter = 'office', preview = null;
  let generation = 0, controller = null, interval = null, historyId = null, afterClose = null, trigger = null;

  function updateDateControls() {
    const valid = dateInput.value && dateInput.validity.valid;
    dialog.querySelector('[data-court-weekday]').textContent = valid ? dateLabel(dateInput.value).split(',')[0] : 'Wochentag';
    dialog.querySelector('[data-court-day="-1"]').disabled = !valid || dateInput.value <= today();
  }

  function setSelection(slot) {
    selected = slot;
    const court = data?.courts.find(item => item.id === slot?.courtId);
    const selection = dialog.querySelector('[data-court-selection]');
    selection.textContent = slot
      ? `${court?.name || slot.courtName || 'Platz'} · ${dateLabel(data.date)} · ${slot.time}–${clock(slot.end)}${slot.reserved ? ' · bereits gebucht' : ''}` : '';
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

  function visibleBookedSlots(data, hoursFilter = 'office') {
    const bounds = hourBounds(data, hoursFilter);
    return ownBookings.flatMap(booking => {
      const court = data.courts.find(item => item.id === booking.court_resource_id)
        || data.courts.find(item => normalizeCourtName(item.name) === normalizeCourtName(booking.court_name));
      if (!court) return [];
      const time = clock(booking.starts_at);
      const start = minute(time);
      const duration = (Date.parse(booking.ends_at) - Date.parse(booking.starts_at)) / 60000;
      if (![60, 90].includes(duration) || Date.parse(booking.starts_at) <= Date.now()
        || start < bounds.from || start + duration > bounds.until) return [];
      return [{
        id: `booking-${booking.booking_id}`,
        bookingId: Number(booking.booking_id),
        courtId: court.id,
        courtName: court.name,
        start: booking.starts_at,
        end: booking.ends_at,
        duration,
        time,
        reserved: true
      }];
    });
  }

  function findSelectableSlot(slotId) {
    return [
      ...(data?.slots || []),
      ...(data ? visibleBookedSlots(data, hoursFilter) : [])
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
    const visible = visibleSlots(data, hoursFilter);
    const slots = new Map(visible.map(slot => [`${slot.courtId}:${slot.time}`, slot]));
    const bookedStarts = new Map(booked.map(slot => [`${slot.courtId}:${slot.time}`, slot]));
    preview = null;
    grid.innerHTML = courts.length && times.length ? `<table class="court-grid"><caption class="sr-only">${escape(dateLabel(data.date))}, freie Startzeiten für 60 Minuten</caption>
      <thead><tr><th scope="col">Platz</th>${times.map(time => `<th scope="col">${time}</th>`).join('')}</tr></thead>
      <tbody>${courts.map(court => `<tr><th scope="row">${escape(court.name)}</th>${times.map(time => {
        const slot = slots.get(`${court.id}:${time}`);
        const bookedSlot = bookedStarts.get(`${court.id}:${time}`);
        const bookedCover = booked.find(item => item.courtId === court.id && minute(time) >= minute(item.time) && minute(time) < minute(item.time) + item.duration);
        const freeCovered = visible.some(item => item.courtId === court.id && minute(time) >= minute(item.time) && minute(time) < minute(item.time) + 60);
        const choice = bookedSlot || slot;
        const className = bookedCover
          ? `is-booked${minute(time) === minute(bookedCover.time) ? ' is-booked-start' : ''}${minute(time) + 30 >= minute(bookedCover.time) + bookedCover.duration ? ' is-booked-end' : ''}`
          : freeCovered ? 'is-free' : 'is-unavailable';
        return `<td data-court-cell="${escape(court.id)}" data-court-time="${time}" class="${className}">${choice
          ? `<button type="button" class="court-slot" data-court-slot="${escape(choice.id)}" aria-pressed="false" aria-label="${escape(`${court.name}, ${time} bis ${clock(choice.end)}, ${choice.reserved ? 'bereits gebucht' : 'frei'}`)}"></button>`
          : '<span class="sr-only">Nicht als Stundenbeginn verfügbar</span>'}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table>` : '<p class="hint">Für diese Auswahl sind keine Plätze verfügbar.</p>';
    grid.style.minHeight = '';
    grid.scrollTop = scroll.top;
    grid.scrollLeft = scroll.left;
    if (focusId) [...grid.querySelectorAll('[data-court-slot]')].find(button => button.dataset.courtSlot === focusId)?.focus({ preventScroll: true });
    if (selected) {
      const updated = [...visible, ...booked].find(slot => slot.id === selected.id && courts.some(court => court.id === slot.courtId));
      setSelection(updated || null);
      if (!updated) status.textContent = 'Die ausgewählte Zeit ist nicht mehr verfügbar. Bitte wähle eine andere Zeit.';
    }
  }

  async function load(background = false) {
    if (!dialog.open || document.hidden) return;
    const version = ++generation;
    controller?.abort();
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 15000);
    const date = dateInput.value;
    updateDateControls();
    if (!date || !dateInput.validity.valid) {
      clearTimeout(timeout); data = null; setSelection(null); renderGrid();
      status.textContent = 'Bitte ein gültiges zukünftiges Datum wählen.';
      return;
    }
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
        body: JSON.stringify({ date }), signal: controller.signal, cache: 'no-store',
      });
      if (!response.ok) throw new Error('Nicht verfügbar');
      const result = await response.json();
      const bookings = await ownBookingsPromise;
      if (version !== generation || !dialog.open) return;
      if (result.date !== date || !Array.isArray(result.courts) || !Array.isArray(result.slots) || !result.opening) throw new Error('Ungültige Antwort');
      data = result;
      ownBookings = Array.isArray(bookings) ? bookings : [];
      status.textContent = '';
      renderGrid();
      if (!selected
        && !visibleSlots(result, hoursFilter).some(slot => result.courts.some(court => court.id === slot.courtId && court.location === filter))
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
    if (dialog.open) dialog.close();
    historyId = null;
    const callback = afterClose;
    afterClose = null;
    const focus = trigger;
    options = {}; data = null; ownBookings = []; selected = null;
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
    hoursFilter = 'office'; preview = null;
    dialog.querySelectorAll('[data-court-hours]').forEach(button => {
      const active = button.dataset.courtHours === hoursFilter;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
    dateInput.min = today();
    dateInput.value = next.date && next.date >= today() ? next.date : today();
    updateDateControls();
    dialog.querySelector('[data-court-context]').textContent = next.label || 'Platzverfügbarkeit';
    dialog.querySelector('[data-court-apply]').hidden = !next.onSelect;
    dialog.querySelector('[data-court-account]').hidden = Boolean(next.onSelect);
    dialog.querySelectorAll('[data-court-filter]').forEach(button => {
      const active = button.dataset.courtFilter === filter;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
    data = null; ownBookings = []; setSelection(null); renderGrid();
    // Ein bereits geöffnetes mobiles Konto muss seinen Verlaufsschritt vor
    // dem darüberliegenden Modal erhalten, auch bei unmittelbar folgendem Öffnen.
    window.PadelMobileDialogPages?.sync();
    dialog.showModal();
    historyId = `court-${Date.now()}`;
    history.pushState({ ...history.state, courtAvailability: historyId }, '', location.href);
    void load();
    interval = setInterval(() => { if (!document.hidden) void load(true); }, 60000);
  }

  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('click', event => {
    if (event.target === dialog || event.target.closest('[data-court-close]')) { close(); return; }
    const day = event.target.closest('[data-court-day]');
    if (day) {
      const date = new Date(`${dateInput.value}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + Number(day.dataset.courtDay));
      dateInput.value = date.toISOString().slice(0, 10) < today() ? today() : date.toISOString().slice(0, 10);
      void load(); return;
    }
    const hoursButton = event.target.closest('[data-court-hours]');
    if (hoursButton) {
      hoursFilter = hoursButton.dataset.courtHours;
      dialog.querySelectorAll('[data-court-hours]').forEach(button => {
        const active = button === hoursButton;
        button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
      });
      if (selected && !visibleSlots(data, hoursFilter).some(slot => slot.id === selected.id)) setSelection(null);
      status.textContent = ''; renderGrid(); return;
    }
    const filterButton = event.target.closest('[data-court-filter]');
    if (filterButton) {
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
  };
  grid.addEventListener('pointerover', previewSlot);
  grid.addEventListener('focusin', previewSlot);
  grid.addEventListener('pointerleave', () => { preview = null; paintRange(); });
  grid.addEventListener('focusout', () => { preview = null; paintRange(); });
  dateInput.addEventListener('change', () => { if (dateInput.validity.valid) void load(); });
  window.addEventListener('popstate', () => { if (dialog.open && history.state?.courtAvailability !== historyId) finishClose(); });
  document.addEventListener('visibilitychange', () => { if (dialog.open && !document.hidden) void load(true); });
  document.addEventListener('click', event => {
    const link = event.target.closest('[data-court-info-open]');
    if (link) { event.preventDefault(); open({ seasonId: link.dataset.courtSeason, trigger: link }); }
  });
  window.PadelCourtAvailability = { open, close, defaultFilter, buildTimes, visibleSlots };
})();
