const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const slotModule = import(path.join(root, 'supabase', 'functions', 'racket-booking', 'slot.ts'));
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261029160000_racket_bookings.sql'), 'utf8');
const edgeFunction = fs.readFileSync(path.join(root, 'supabase', 'functions', 'racket-booking', 'index.ts'), 'utf8');
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
  assert.match(subjectMigration, /security definer/);
  assert.match(subjectMigration, /revoke execute on function public\.get_racket_booking_subject\(text, text, uuid\) from public, anon, authenticated/);
  assert.match(subjectMigration, /grant execute on function public\.get_racket_booking_subject\(text, text, uuid\) to service_role/);
  assert.match(subjectMigration, /counts_for_profile is false/);
  assert.match(subjectMigration, /array\['ludi_gmail', 'ludi_gmx', 'ludi_ionos', 'test_net'\]/);
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
  const context = vm.createContext({
    window: {
      setTimeout: (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
      clearTimeout: id => timers.delete(id)
    },
    Promise, Date,
    racketCheckTimers: new Map(),
    RACKET_CHECK_DELAY_MS: 450,
    RACKET_CHECK_TIMEOUT_MS: 12000,
    getRacketFormContext: () => ({ subjectType: 'match', subjectId: 'm1', date: '2099-11-04', time: '18:00' }),
    getMatchAtTimestamp: value => new Date(value).getTime(),
    buildMatchAtValue: (date, time) => `${date}T${time}:00`,
    describeRacketCheck: result => ({ text: result.state }),
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
    describeRacketBooking: result => result ? { text: result.state } : null,
    renderRacketNote: (target, description) => { target.note = description; }
  });
  vm.runInContext(source, context);
  context.applyRacketStatuses();
  assert.equal(past.note, null);
  assert.deepEqual(upcoming.note, { text: 'booked' });
  assert.equal(timers.length, 1);
  assert.ok(timers[0] > 59 * 60_000 && timers[0] <= 61 * 60_000);
});
