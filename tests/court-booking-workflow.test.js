const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261106190000_court_booking_workflow.sql'), 'utf8');
const assignmentMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261107120000_booking_mail_match_assignment.sql'), 'utf8');
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

test('an explicit repeated forward assigns only one authorized open match', () => {
  assert.match(assignmentMigration, /record_court_booking_with_match/);
  assert.match(assignmentMigration, /account\.email_confirmed_at is not null/);
  assert.match(assignmentMigration, /forwarder\.app_role = 'admin'[\s\S]*public\.match_players/);
  assert.match(assignmentMigration, /candidate_count > 1[\s\S]*'ambiguous_match'/);
  assert.match(assignmentMigration, /set match_id = selected_match\.id,[\s\S]*assigned_by = forwarder\.id/);
  assert.match(assignmentMigration, /set match_at = selected_booking\.starts_at/);
  assert.match(assignmentMigration, /grant execute on function public\.record_court_booking_with_match[\s\S]*to service_role/);
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
  assert.match(grid.innerHTML, /court-booking-match-number[^>]*>P\.1<\/span>/);
  assert.equal([...grid.innerHTML.matchAll(/court-booking-match-number/g)].length, 1,
    'the compact match number stays entirely in the first booking cell');
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
  const source = ['describeRacketCheck', 'describeRacketBooking', 'getBookedCourtNumber', 'getCourtBookingWindow', 'describeCourtAndRacket']
    .map(name => account.match(new RegExp(` {2}function ${name}\\([\\s\\S]*?\\n {2}\\}\\n`))?.[0])
    .join('\n');
  const context = vm.createContext({});
  vm.runInContext(source, context);
  const target = { dataset: { courtBookingFrom: '18:00', courtBookingUntil: '19:00' } };
  assert.equal(
    context.describeCourtAndRacket({ state: 'booked', from: '18:00', until: '19:00' }, target, true).text,
    '✓ Platz und Schläger gebucht: 18:00–19:00 Uhr'
  );
  assert.equal(
    context.describeCourtAndRacket({ state: 'partial', from: '18:00', until: '18:30' }, target, true).text,
    '✓ Platz gebucht von 18:00–19:00 Uhr · Schläger reserviert · 18:00–18:30 (Bürozeiten)'
  );
  for (const number of ['H1', 'H2', 'H3', 'H4', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']) {
    target.dataset.courtBookingNumber = number;
    assert.equal(context.describeCourtAndRacket({ state: 'booked', from: '18:00', until: '19:00' }, target, true).text,
      `✓ Platz ${number} und Schläger gebucht: 18:00–19:00 Uhr`);
    assert.equal(context.describeCourtAndRacket(null, target, true).text, `✓ Platz ${number} gebucht von 18:00–19:00 Uhr`);
  }
  assert.equal(context.getBookedCourtNumber('CUPRA Indoor H1'), 'H1');
  assert.equal(context.getBookedCourtNumber('DAS ANDERS Court 4'), '4');
  assert.equal(context.getBookedCourtNumber('Court 10'), '10');
  for (const name of ['Indoor H5', 'Court 11', 'H10', 'Indoor 1', null]) assert.equal(context.getBookedCourtNumber(name), '');
  assert.match(account, /data-court-booking-from=/);
  assert.match(account, /data-court-booking-until=/);
  assert.match(account, /syncCourtBookingWindow\(form, context\)/);
  assert.match(account, /bookingInput\.value = ''[\s\S]*delete target\.dataset\.courtBookingFrom/);
});

test('Hallencode-Platzhalter erscheinen ausschließlich bei zugeordneten H1–H4-Buchungen', () => {
  const helper = account.match(/ {2}function getBookedCourtNumber\([\s\S]*?\n {2}\}\n/)[0];
  const renderer = account.slice(account.indexOf('  function renderResultTaskCard('), account.indexOf('  function renderResultTaskGroups('));
  const context = vm.createContext({ state: { courtBookings: [] }, escapeHtml: String,
    getTaskLeagueLabel: () => 'Liga', getTaskMatchLabel: () => 'Partie', renderResultTaskStatus: () => '',
    renderTaskMatchup: () => '', renderResultTaskBody: () => '', formatMatchAt: () => '', courtBookingWindowAttributes: () => '' });
  vm.runInContext(helper + renderer, context);
  const task = { match_id: 'm1', match_at: '2099-11-13T11:00:00Z', my_team: 1, task_type: 'enter' };
  for (const name of ['Indoor H1', 'CUPRA Indoor H2', 'Indoor H3', 'Indoor H4',
    ...Array.from({ length: 10 }, (_, i) => `Court ${i + 1}`), 'Indoor H5', 'H10', 'Unbekannt']) {
    context.state.courtBookings = [{ match_id: 'm1', court_name: name, ends_at: '2099-11-13T12:00:00Z' }];
    const html = context.renderResultTaskCard(task, 'future');
    assert.equal(html.includes('data-hall-code-match='), /\bH[1-4]$/.test(name), name);
    assert.match(html, /data-racket-status=/, 'Platz-/Schlägerhinweis bleibt auch draußen erhalten');
  }
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
