const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261106190000_court_booking_workflow.sql'), 'utf8');
const account = fs.readFileSync(path.join(root, 'js/account.js'), 'utf8');
const availability = fs.readFileSync(path.join(root, 'js/court-availability.js'), 'utf8');
const availabilityStyle = fs.readFileSync(path.join(root, 'court-availability.css'), 'utf8');
const pages = [
  fs.readFileSync(path.join(root, 'index.html'), 'utf8'),
  fs.readFileSync(path.join(root, 'tipp/index.html'), 'utf8')
];

test('mail events are service-only, ordered and idempotent by provider booking id', () => {
  assert.match(migration, /provider_booking_id text unique/);
  assert.match(migration, /auth\.jwt\(\) ->> 'role'\), ''\) <> 'service_role'/);
  assert.match(migration, /p_source_occurred_at <= existing_booking\.source_occurred_at/);
  assert.match(migration, /candidate_count > 1[\s\S]*'needs_review'/);
  assert.match(migration, /booking\.cancelled_at is null[\s\S]*lower\(trim\(booking\.court_name\)\)[\s\S]*lower\(trim\(booking\.organizer\)\)[\s\S]*booking\.starts_at = p_starts_at/);
  assert.match(migration, /grant execute on function public\.record_court_booking[\s\S]*to service_role/);
  assert.match(migration, /revoke all on private\.court_bookings from public, anon, authenticated/);
});

test('cancelled bookings disappear while exactly one shared participant action remains', () => {
  const visibleBookings = migration.match(/create function public\.get_my_court_bookings[\s\S]*?(?=\n-- Eine stornierte)/)?.[0] || '';
  const cancellationTasks = migration.match(/create function public\.get_my_court_booking_cancellation_tasks[\s\S]*?(?=\n-- Gemeinsame)/)?.[0] || '';
  const confirmation = migration.match(/create function public\.confirm_court_booking_cancellation[\s\S]*?(?=\n-- Auch die bestehende)/)?.[0] || '';
  assert.match(visibleBookings, /booking\.cancelled_at is null/);
  assert.match(cancellationTasks, /booking\.cancellation_resolved_at is null/);
  assert.match(cancellationTasks, /join public\.match_players as member[\s\S]*member\.player_id = me\.player_id/);
  assert.match(confirmation, /for update/);
  assert.match(confirmation, /'already_resolved'/);
  assert.match(confirmation, /update public\.matches set match_at = null/);
  assert.match(confirmation, /cancellation_resolution = 'unscheduled'/);
});

test('a confirmed booking is atomically matched to the same official start time', () => {
  assert.match(migration, /check \(ends_at - starts_at in \(interval '60 minutes', interval '90 minutes'\)\)/);
  assert.match(migration, /p_ends_at - p_starts_at not in \(interval '60 minutes', interval '90 minutes'\)/);
  assert.match(migration, /selected_booking\.starts_at <> scheduled_at/);
  assert.match(migration, /selected_booking\.match_id is not null and selected_booking\.match_id <> p_match_id/);
  assert.match(migration, /set match_id = p_match_id,[\s\S]*assigned_by = current_user_id/);
  assert.match(migration, /cancellation_resolution = 'replaced'/);
  assert.match(migration, /update public\.matches set match_at = scheduled_at/);
  assert.match(account, /p_court_booking_id: bookingId/);
});

test('90-minute reservations cover their full visible window, including a partially visible reservation', () => {
  const booking = { booking_id: 1, court_name: 'Halle', starts_at: '2099-11-04T17:00:00Z', ends_at: '2099-11-04T18:30:00Z' };
  const grid = { innerHTML: '', style: {}, scrollTop: 0, scrollLeft: 0, contains: () => false };
  const context = { window: {}, grid, document: { activeElement: null }, ownBookings: [booking],
    options: {},
    data: { date: '2099-11-04', opening: { from: '07:00', until: '24:00' }, slots: [],
      courts: [{ id: 'hall', name: 'Halle', location: 'indoor' }] },
    filter: 'indoor', hoursFilter: 'office', selected: null, preview: null };
  vm.createContext(context);
  const helpers = availability.slice(0, availability.indexOf('  const dialog ='));
  const functions = availability.slice(availability.indexOf('  function paintRange()'), availability.indexOf('  async function load('));
  vm.runInContext(helpers + functions + 'window.visibleBookedSlots = visibleBookedSlots; window.renderGrid = renderGrid; })();', context);
  const slots = context.window.visibleBookedSlots(context.data);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].duration, 90);
  context.window.renderGrid();
  const cellClass = time => grid.innerHTML.match(new RegExp(`data-court-time="${time}" class="([^"]*)"`))?.[1];
  assert.equal(cellClass('18:00'), 'is-booked is-booked-start');
  assert.equal(cellClass('18:30'), 'is-booked');
  assert.equal(cellClass('19:00'), 'is-booked is-booked-end');
  assert.equal(cellClass('19:30'), 'is-unavailable');
  context.ownBookings = [{ ...booking, starts_at: '2099-11-04T18:00:00Z', ends_at: '2099-11-04T19:30:00Z' }];
  assert.equal(context.window.visibleBookedSlots(context.data).length, 1, 'the occupied 19:00–20:00 section stays marked');
  assert.equal(context.window.visibleBookedSlots(context.data, 'all').length, 1);
});

test('selecting a 90-minute booking carries its full duration into the match picker and highlight', () => {
  const source = account.slice(account.indexOf('  function courtBookingSlot('), account.indexOf('  function renderCourtBookingInbox('));
  const context = { getBerlinMatchAtParts: () => ({ date: '2099-11-04', time: '18:00' }) };
  vm.createContext(context);
  vm.runInContext(source + ';globalThis.slot = courtBookingSlot({ booking_id: 1, starts_at: "2099-11-04T17:00:00Z", ends_at: "2099-11-04T18:30:00Z" });', context);
  assert.equal(context.slot.duration, 90);
  const cells = ['18:00', '18:30', '19:00', '19:30'].map(time => {
    const classes = new Set();
    return { dataset: { courtCell: 'hall', courtTime: time }, classes,
      classList: { toggle: (name, active) => active ? classes.add(name) : classes.delete(name) } };
  });
  const highlight = { selected: { ...context.slot, courtId: 'hall' }, preview: null,
    minute: time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3)),
    grid: { querySelectorAll: () => cells } };
  vm.createContext(highlight);
  const paint = availability.slice(availability.indexOf('  function paintRange()'), availability.indexOf('  function normalizeCourtName('));
  vm.runInContext(paint + 'paintRange();', highlight);
  assert.deepEqual(cells.filter(cell => cell.classes.has('is-selected')).map(cell => cell.dataset.courtTime), ['18:00', '18:30', '19:00']);
});

test('our bookings block every overlapping free start and cannot be assigned to a different match', () => {
  const booking = { booking_id: 12, court_resource_id: 'hall', court_name: 'Halle',
    starts_at: '2099-11-04T17:00:00Z', ends_at: '2099-11-04T18:30:00Z',
    match_id: 'match-one', match_label: 'Partie 1' };
  const grid = { innerHTML: '', style: {}, scrollTop: 0, scrollLeft: 0, contains: () => false };
  const context = { window: {}, grid, document: { activeElement: null },
    ownBookings: [booking], options: { matchId: 'match-two' },
    data: { date: '2099-11-04', opening: { from: '07:00', until: '24:00' },
      courts: [{ id: 'hall', name: 'Halle', location: 'indoor' }, { id: 'other', name: 'Nebenplatz', location: 'indoor' }],
      slots: ['16:00', '16:30', '17:00', '17:30', '18:00', '18:30'].flatMap(time => ['hall', 'other'].map(courtId => ({
        id: `${courtId}-${time}`, courtId, start: `2099-11-04T${time}:00Z`,
        end: new Date(Date.parse(`2099-11-04T${time}:00Z`) + 3600000).toISOString(),
        time: `${Number(time.slice(0, 2)) + 1}:${time.slice(3)}`
      }))) }, filter: 'indoor', hoursFilter: 'all', selected: null, preview: null };
  vm.createContext(context);
  const helpers = availability.slice(0, availability.indexOf('  const dialog ='));
  const functions = availability.slice(availability.indexOf('  function paintRange()'), availability.indexOf('  async function load('));
  vm.runInContext(helpers + functions + 'window.helpers = { visibleBookedSlots, visibleSlots, findSelectableSlot, renderGrid }; })();', context);
  const api = context.window.helpers;
  api.renderGrid();
  assert.doesNotMatch(grid.innerHTML, /Von uns gebucht|court-booking-label/);
  assert.match(grid.innerHTML, /class="is-booked is-assigned is-booked-start"/, 'linked bookings receive the grey assigned state');
  assert.match(grid.innerHTML, /Platz bereits gebucht, Halle, 18:00 bis 19:30, Partie 1/);
  assert.match(grid.innerHTML, /court-booking-match-number[^>]*>P#<\/span>/);
  assert.match(grid.innerHTML, /court-booking-match-number[^>]*>1<\/span>/);
  assert.doesNotMatch(grid.innerHTML, /data-court-slot="booking-12"/, 'a booking linked elsewhere is visible but cannot be reassigned');
  assert.equal(api.findSelectableSlot('hall-16:00')?.id, 'hall-16:00', 'an hour ending exactly at the reservation stays free');
  assert.equal(api.findSelectableSlot('hall-18:30')?.id, 'hall-18:30', 'an hour starting exactly after the reservation stays free');
  for (const time of ['16:30', '17:00', '17:30', '18:00']) {
    assert.equal(api.findSelectableSlot(`hall-${time}`), undefined, `overlapping ${time} UTC is blocked`);
    assert.equal(api.findSelectableSlot(`other-${time}`)?.courtId, 'other', 'other courts stay available');
  }
  context.options.matchId = 'match-one';
  assert.equal(api.findSelectableSlot('booking-12')?.bookingId, 12, 'the linked match can select its own reservation');
  vm.runInContext('Date.now = () => Date.parse("2099-11-04T17:15:00Z");', context);
  assert.equal(api.visibleBookedSlots(context.data, 'all').length, 1, 'an ongoing reservation remains occupied');
  assert.equal(api.findSelectableSlot('booking-12'), undefined, 'an ongoing reservation cannot be selected as a new start');
  vm.runInContext('Date.now = () => Date.parse("2099-11-04T00:00:00Z");', context);
  context.options = {};
  context.ownBookings = [{ ...booking, match_id: null }];
  api.renderGrid();
  assert.doesNotMatch(grid.innerHTML, /is-assigned/, 'an unassigned booking keeps only its accent outline');
  assert.doesNotMatch(grid.innerHTML, /court-booking-match-number/, 'an unassigned booking does not guess a match number');
  assert.match(grid.innerHTML, /class="is-booked is-booked-start"/);
  assert.equal([...grid.innerHTML.matchAll(/data-court-slot="booking-12"/g)].length, 3, 'the complete marked booking range stays clickable');
  assert.equal(api.findSelectableSlot('booking-12')?.bookingId, 12, 'an unassigned booking remains available for explicit assignment');
  context.ownBookings = [];
  api.renderGrid();
  assert.equal(api.findSelectableSlot('hall-17:00')?.id, 'hall-17:00', 'a removed or cancelled reservation no longer blocks the returned availability');
  context.selected = api.findSelectableSlot('hall-17:00');
  context.setSelection = slot => { context.selected = slot; };
  context.status = { textContent: '' };
  context.ownBookings = [booking];
  api.renderGrid();
  assert.equal(context.selected, null, 'a stale free selection is cleared when its reservation arrives');
  assert.match(context.status.textContent, /nicht mehr verfügbar/);
  context.ownBookings = [{ ...booking, starts_at: '2099-11-05T17:00:00Z', ends_at: '2099-11-05T18:30:00Z' }];
  assert.equal(api.visibleBookedSlots(context.data, 'all').length, 0, 'a different date cannot occupy this grid');
});

test('booked slots use an accent outline and show structured match choices inside the booking inbox', () => {
  assert.match(availability, /getCourtBookings\?\.\(date\)/);
  assert.match(availability, /className = bookedCover[\s\S]*is-booked-start[\s\S]*is-booked-end/);
  assert.match(availability, /Platz bereits gebucht/);
  assert.match(availabilityStyle, /td\.is-booked[^\n]*var\(--accent\)/);
  assert.match(availabilityStyle, /td\.is-selected \{ background: var\(--accent\); box-shadow: none; \}/);
  assert.match(availabilityStyle, /td\.is-booked:not\(\.is-assigned\)\.is-preview \{ background: color-mix\(in srgb, var\(--accent\) 55%, var\(--surface\)\); \}/);
  assert.match(availabilityStyle, /td\.is-booked:not\(\.is-assigned\)\.is-selected \{ background: var\(--accent\); box-shadow: none; \}/);
  assert.match(account, /data-court-booking-select/);
  assert.match(account, /pendingCourtSlot\?\.reserved[\s\S]*renderCourtBookingInbox\(\)/);
  assert.match(account, /court-booking-match-selection/);
  assert.match(account, /secondary-button match-card[\s\S]*data-court-match-select/);
  assert.match(account, /match-meta[\s\S]*account-task-status[\s\S]*account-task-matchup/);
  assert.match(account, /getTaskMatchLabel\(first\)\.localeCompare\(getTaskMatchLabel\(second\), 'de', \{ numeric: true \}\)/);
});

test('court and racket confirmation share one exact booking message', () => {
  const source = ['describeRacketCheck', 'describeRacketBooking', 'getCourtBookingWindow', 'describeCourtAndRacket']
    .map(name => account.match(new RegExp(` {2}function ${name}\\([\\s\\S]*?\\n {2}\\}\\n`))?.[0])
    .join('\n');
  const context = vm.createContext({});
  vm.runInContext(source, context);
  const target = { dataset: { courtBookingFrom: '18:00', courtBookingUntil: '19:00' } };
  assert.equal(
    context.describeCourtAndRacket({ state: 'booked', from: '18:00', until: '19:00' }, target, true).text,
    '✓ Platz und Schläger sind gebucht von 18:00–19:00 Uhr'
  );
  assert.equal(
    context.describeCourtAndRacket({ state: 'partial', from: '18:00', until: '18:30' }, target, true).text,
    '✓ Platz gebucht von 18:00–19:00 Uhr · Schläger reserviert · 18:00–18:30 (Bürozeiten)'
  );
  assert.match(account, /data-court-booking-from=/);
  assert.match(account, /data-court-booking-until=/);
  assert.match(account, /syncCourtBookingWindow\(form, context\)/);
  assert.match(account, /bookingInput\.value = ''[\s\S]*delete target\.dataset\.courtBookingFrom/);
});

test('all affected players receive the same two-action cancellation modal', () => {
  pages.forEach(page => {
    assert.match(page, /data-account-task-prompt-alternative hidden>Neue Buchung zuordnen<\/button>/);
    assert.match(page, /data-account-task-prompt-open>Zum Konto<\/button>/);
  });
  assert.match(account, /type: 'court-cancellation'/);
  assert.match(account, /title\.textContent = 'Platzbuchung aufgehoben'/);
  assert.match(account, /action\.textContent = 'Termin aufheben'/);
  assert.match(account, /confirm_court_booking_cancellation/);
  assert.match(account, /Der Termin wurde für alle Beteiligten aufgehoben\./);
});
