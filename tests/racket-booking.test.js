const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const slotModule = import(path.join(root, 'supabase', 'functions', 'racket-booking', 'slot.ts'));
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261029160000_racket_bookings.sql'), 'utf8');
const edgeFunction = fs.readFileSync(path.join(root, 'supabase', 'functions', 'racket-booking', 'index.ts'), 'utf8');
const coveredMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261104120000_racket_booking_covered.sql'), 'utf8');
const subjectMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261029170000_racket_booking_subject.sql'), 'utf8');

const officeHours = Array.from({ length: 7 }, (_, index) => ({ weekday: index + 1, from: '07:00', to: '20:00', all_day: false }));
const desk = 'desk-1';
const booking = (id, from, until, extra = {}) => ({ id, desk_id: desk, date: `2026-11-04 ${from}:00`, end_date: `2026-11-04 ${until}:00`, ...extra });

test('Schläger werden genau eine Stunde ab der abgerundeten halben Stunde gebucht', async () => {
  const { planSlot } = await slotModule;
  assert.deepEqual(planSlot('2026-11-04', '18:00', officeHours), {
    state: 'free', date: '2026-11-04', from: '18:00', until: '19:00', openFrom: '07:00', openUntil: '20:00'
  });
  const quarterPast = planSlot('2026-11-04', '15:15', officeHours);
  assert.equal(quarterPast.state, 'free');
  assert.equal(quarterPast.from, '15:00');
  assert.equal(quarterPast.until, '16:00');
  const quarterTo = planSlot('2026-11-04', '15:45', officeHours);
  assert.equal(quarterTo.from, '15:30');
  assert.equal(quarterTo.until, '16:30');
});

test('Bürozeiten kürzen die Buchung oder verhindern sie', async () => {
  const { planSlot } = await slotModule;
  const late = planSlot('2026-11-04', '19:30', officeHours);
  assert.equal(late.state, 'partial');
  assert.equal(late.from, '19:30');
  assert.equal(late.until, '20:00');
  const early = planSlot('2026-11-04', '06:30', officeHours);
  assert.equal(early.state, 'partial');
  assert.equal(early.from, '07:00');
  assert.equal(early.until, '07:30');
  assert.equal(planSlot('2026-11-04', '20:00', officeHours).state, 'outside_hours');
  assert.equal(planSlot('2026-11-04', '05:30', officeHours).state, 'outside_hours');
  assert.equal(planSlot('2026-11-08', '18:00', officeHours.filter(day => day.weekday !== 7)).state, 'outside_hours');
});

test('Belegungen anderer zählen, die eigene und stornierte nicht', async () => {
  const { findBusyWindow } = await slotModule;
  const slot = { date: '2026-11-04', from: '18:00', until: '19:00' };
  assert.equal(findBusyWindow([booking('a', '17:00', '18:00'), booking('b', '19:00', '20:00')], desk, slot), null);
  assert.deepEqual(findBusyWindow([booking('a', '18:30', '19:30')], desk, slot), { from: '18:30', until: '19:30' });
  assert.deepEqual(findBusyWindow([booking('a', '17:30', '18:30'), booking('b', '18:30', '19:30')], desk, slot), { from: '17:30', until: '19:30' });
  assert.equal(findBusyWindow([booking('own', '18:00', '19:00')], desk, slot, 'own'), null);
  assert.equal(findBusyWindow([booking('a', '18:00', '19:00', { checkin_status: 'cancelled' })], desk, slot), null);
  assert.equal(findBusyWindow([booking('a', '18:00', '19:00', { desk_id: 'other' })], desk, slot), null);
});

test('eine eigene Clearooms-Buchung eines Spielers gilt als bereits gebuchte Schläger', async () => {
  const { findCoveringBooking } = await slotModule;
  const slot = { date: '2026-11-04', from: '12:00', until: '13:00' };
  const participants = [{ name: 'Jonas L.', email: 'jonas.loehr@envidual.com' }, { name: 'Agnes K.', email: 'agnes.koehler@headsquare.group' }];
  assert.deepEqual(
    findCoveringBooking([booking('a', '12:00', '13:00', { user: { email: 'Jonas.Loehr@envidual.com' } })], desk, slot, participants),
    { from: '12:00', until: '13:00', name: 'Jonas L.' }
  );
  assert.equal(findCoveringBooking([booking('a', '12:00', '13:00', { user_email: 'agnes.koehler@headsquare.group' })], desk, slot, participants).name, 'Agnes K.');
  assert.equal(findCoveringBooking([booking('a', '12:00', '13:00', { user: { email: 'fremd@envidual.com' } })], desk, slot, participants), null);
  assert.equal(findCoveringBooking([booking('a', '12:00', '13:00', { user: { email: 'jonas.loehr@envidual.com' }, checkin_status: 'cancelled' })], desk, slot, participants), null);
  assert.equal(findCoveringBooking([booking('a', '14:00', '15:00', { user: { email: 'jonas.loehr@envidual.com' } })], desk, slot, participants), null);
});

test('Gastname und Partiebezeichnung folgen der Liga-Benennung', async () => {
  const { matchLabel } = await slotModule;
  assert.equal(matchLabel({ id: 'winter-2026-partie-7', competition_stage: 'league' }), 'Partie 7');
  assert.equal(matchLabel({ id: 'winter-2026-final-1', display_label: 'Final Four 1', competition_stage: 'final_four' }), 'Final Four 1');
  assert.match(edgeFunction, /`\$\{matchLabel\(resolved\.match\)\} – PadelLiga`/);
  assert.match(edgeFunction, /"Training – PadelLiga"/);
});

test('Buchungsspiegel und Clearooms-Schlüssel bleiben serverseitig', () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.racket_bookings from public, anon, authenticated/);
  assert.match(edgeFunction, /Deno\.env\.get\("CLEAROOMS_API_TOKEN"\)/);
});

test('die Edge Function liest Partien und Trainings nur über die abgesicherte Datenbankfunktion', () => {
  const tables = [...edgeFunction.matchAll(/\.from\("([a-z_]+)"\)/g)].map(match => match[1]);
  assert.deepEqual([...new Set(tables)], ['racket_bookings']);
  assert.match(edgeFunction, /admin\.rpc\("get_racket_booking_subject"/);
  assert.match(edgeFunction, /admin\.rpc\("get_racket_booking_participants"/);
  assert.match(coveredMigration, /security definer/);
  assert.match(coveredMigration, /revoke execute on function public\.get_racket_booking_participants\(text, text, uuid\) from public, anon, authenticated/);
  assert.match(subjectMigration, /security definer/);
  assert.match(subjectMigration, /revoke execute on function public\.get_racket_booking_subject\(text, text, uuid\) from public, anon, authenticated/);
  assert.match(subjectMigration, /grant execute on function public\.get_racket_booking_subject\(text, text, uuid\) to service_role/);
  assert.match(subjectMigration, /counts_for_profile is false/);
  assert.match(subjectMigration, /array\['ludi_gmail', 'ludi_gmx', 'ludi_ionos', 'test_net'\]/);
});

test('nur der interne Mail-Empfänger darf eine automatisch zugeordnete Partie synchronisieren', () => {
  assert.match(edgeFunction, /bearer === serviceRoleKey/);
  assert.match(edgeFunction, /body\.action !== "sync-internal"/);
  assert.match(edgeFunction, /subject\.type !== "match"/);
  assert.match(edgeFunction, /resolveSubject\(admin, subject, actorUserId\)/);
  assert.match(edgeFunction, /desired === "forbidden"/);
});

test('doppelt gemeldete Datums- und Uhrzeitänderungen beenden die Live-Prüfung', async () => {
  const vm = require('node:vm');
  const account = fs.readFileSync(path.join(root, 'js', 'account.js'), 'utf8');
  const source = account.match(/ {2}function scheduleRacketCheck\(form\) \{[\s\S]*?\n {2}\}\n/)?.[0];
  assert.ok(source);
  const timers = new Map();
  let nextTimer = 0;
  const target = { dataset: {}, notes: [] };
  const form = {
    querySelector: selector => selector === '[data-racket-check]' ? target : null,
    closest: () => null
  };
  const selection = { subjectType: 'training', subjectId: null, playerIds: ['p1', 'p2', 'p3', 'p4'], date: '2099-11-04', time: '18:00' };
  const context = vm.createContext({
    window: {
      setTimeout: (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
      clearTimeout: id => timers.delete(id)
    },
    Promise, Date,
    racketCheckTimers: new Map(),
    RACKET_CHECK_DELAY_MS: 450,
    RACKET_CHECK_TIMEOUT_MS: 12000,
    getRacketFormContext: () => selection,
    syncCourtBookingWindow: () => {},
    getMatchAtTimestamp: value => new Date(value).getTime(),
    buildMatchAtValue: (date, time) => `${date}T${time}:00`,
    describeCourtAndRacket: result => ({ text: result.state }),
    renderRacketNote: (_target, description) => target.notes.push(description?.text ?? null),
    invokeRacketBooking: async () => ({ state: 'free' })
  });
  vm.runInContext(source, context);
  context.scheduleRacketCheck(form);
  context.scheduleRacketCheck(form);
  const pending = [...timers.values()].filter(timer => timer.delay === 450);
  assert.equal(pending.length, 1);
  await pending[0].callback();
  assert.deepEqual(target.notes, ['checking', 'free']);
  selection.playerIds[3] = 'guest:4';
  context.scheduleRacketCheck(form);
  assert.equal(target.notes.at(-1), 'checking', 'a participant change starts a new check at the same time');
  context.getRacketFormContext = () => null;
  context.scheduleRacketCheck(form);
  assert.equal([...timers.values()].filter(timer => timer.delay === 450).length, 0, 'incomplete selection cancels the pending check');
  assert.equal(target.notes.at(-1), null, 'incomplete selection hides the loading indicator');
  assert.equal(target.dataset.racketRequest, undefined);
});

test('der Schläger-Hinweis verschwindet ab Spielbeginn', () => {
  const vm = require('node:vm');
  const account = fs.readFileSync(path.join(root, 'js', 'account.js'), 'utf8');
  const source = ['isRacketStatusUpcoming', 'applyRacketStatuses']
    .map(name => account.match(new RegExp(` {2}function ${name}\\([\\s\\S]*?\\n {2}\\}\\n`))?.[0])
    .join('\n');
  const now = Date.now();
  const card = (key, startsAt) => ({ dataset: { racketStatus: key, racketStartsAt: String(startsAt) }, note: undefined });
  const past = card('match:past', now - 60_000);
  const upcoming = card('match:next', now + 60 * 60_000);
  const timers = [];
  const context = vm.createContext({
    Date, Math, Number,
    document: { querySelectorAll: () => [past, upcoming] },
    window: { setTimeout: (callback, delay) => timers.push(delay), clearTimeout() {} },
    racketStatusExpiryTimer: null,
    racketStatusCache: new Map([['match:past', { state: 'booked' }], ['match:next', { state: 'booked' }]]),
    describeCourtAndRacket: result => result ? { text: result.state } : null,
    renderRacketNote: (target, description) => { target.note = description; }
  });
  vm.runInContext(source, context);
  context.applyRacketStatuses();
  assert.equal(past.note, null);
  assert.deepEqual(upcoming.note, { text: 'booked' });
  assert.equal(timers.length, 1);
  assert.ok(timers[0] > 59 * 60_000 && timers[0] <= 61 * 60_000);
});

test('Live-Prüfung erkennt den Bucher aus der aktuellen Trainingsauswahl ohne gespeicherte Sitzung', async () => {
  const vm = require('node:vm');
  const { findBusyWindow, findCoveringBooking, planSlot } = await slotModule;
  const source = edgeFunction.slice(edgeFunction.indexOf('async function check('), edgeFunction.indexOf('\nasync function status('))
    .replace('admin: SupabaseClient, body: Record<string, unknown>, userId: string', 'admin, body, userId')
    .replace('let participants: Participant[];', 'let participants;')
    .replace(' as Participant[]', '');
  const calls = [];
  const context = vm.createContext({
    readSubject: () => null,
    isDateValue: () => true, isTimeValue: () => true,
    getWorkingHours: async () => officeHours,
    listDayBookings: async () => [booking('manual', '18:00', '19:00', { user: { email: 'player@example.com' } })],
    RACKET_DESK_ID: desk, planSlot, findBusyWindow, findCoveringBooking,
    jsonResponse: value => value,
    readParticipants: () => { throw new Error('Must use current selection'); }
  });
  vm.runInContext(source, context);
  const admin = { rpc: async (name, args) => {
    calls.push({ name, args });
    return { data: args.p_player_ids.includes('p4') ? [{ name: 'Spieler 4', email: 'player@example.com' }] : [] };
  } };
  const body = { subjectType: 'training', subjectId: null, playerIds: ['p1', 'p2', 'p3', 'p4'], date: '2026-11-04', time: '18:00' };
  const covered = await context.check(admin, body, 'user-1');
  assert.equal(covered.state, 'covered');
  assert.equal(covered.coveredBy, 'Spieler 4');
  assert.equal(JSON.stringify(covered).includes('player@example.com'), false);
  assert.equal(calls[0].name, 'get_racket_training_check_participants');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].args)), { p_player_ids: body.playerIds, p_user_id: 'user-1' });
  const changed = await context.check(admin, { ...body, playerIds: ['p1', 'p2', 'p3', 'guest:4'] }, 'user-1');
  assert.equal(changed.state, 'busy');
});

test('Trainings-Teilnehmerabgleich bleibt für Browser gesperrt und prüft Rolle und eigene Teilnahme', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261111110000_racket_training_check_participants.sql'), 'utf8');
  assert.match(sql, /security definer/);
  assert.match(sql, /private\.user_email_is_confirmed\(p_user_id\)/);
  assert.match(sql, /app_role not in \('player', 'admin'\)/);
  assert.match(sql, /current_profile\.player_id = any\(p_player_ids\)/);
  assert.match(sql, /cardinality\(p_player_ids\)/);
  assert.match(sql, /revoke execute[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute[\s\S]*to service_role/);
});

test('Training prüft Schläger erst bei vier verschiedenen vollständig benannten Teilnehmern', () => {
  const vm = require('node:vm');
  const account = fs.readFileSync(path.join(root, 'js/account.js'), 'utf8');
  const source = account.match(/ {2}function getRacketFormContext\(form\) \{[\s\S]*?\n {2}\}\n/)[0];
  let playerIds = ['p1', '', '', ''];
  let guestNames = {};
  const form = {
    dataset: {}, matches: selector => selector === '.training-form',
    querySelector: selector => ({ value: selector.includes('playedOn') ? '2099-11-04' : '18:00' })
  };
  const context = vm.createContext({
    getTrainingParticipantIds: () => playerIds,
    getTrainingGuestNames: () => guestNames,
    isTrainingGuestKey: id => /^guest:[1-4]$/.test(id)
  });
  vm.runInContext(source, context);
  assert.equal(context.getRacketFormContext(form), null);
  playerIds = ['p1', 'p2', 'p3', ''];
  assert.equal(context.getRacketFormContext(form), null);
  playerIds = ['p1', 'p2', 'p3', 'p3'];
  assert.equal(context.getRacketFormContext(form), null);
  playerIds = ['p1', 'p2', 'p3', 'p4'];
  assert.deepEqual(Array.from(context.getRacketFormContext(form).playerIds), playerIds);
  playerIds[3] = 'guest:4';
  assert.equal(context.getRacketFormContext(form), null);
  guestNames = { 'guest:4': 'A' };
  assert.equal(context.getRacketFormContext(form), null);
  guestNames['guest:4'] = 'Alex';
  assert.ok(context.getRacketFormContext(form));
});
