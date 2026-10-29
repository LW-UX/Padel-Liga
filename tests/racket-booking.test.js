const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const slotModule = import(path.join(root, 'supabase', 'functions', 'racket-booking', 'slot.ts'));
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261029160000_racket_bookings.sql'), 'utf8');
const edgeFunction = fs.readFileSync(path.join(root, 'supabase', 'functions', 'racket-booking', 'index.ts'), 'utf8');

const officeHours = Array.from({ length: 7 }, (_, index) => ({ weekday: index + 1, from: '07:00', to: '20:00', all_day: false }));
const desk = 'desk-1';
const booking = (id, from, until, extra = {}) => ({ id, desk_id: desk, date: `2026-11-04 ${from}:00`, end_date: `2026-11-04 ${until}:00`, ...extra });

test('Schläger werden eine Stunde ab Terminbeginn auf halbe Stunden gerundet gebucht', async () => {
  const { planSlot } = await slotModule;
  assert.deepEqual(planSlot('2026-11-04', '18:00', officeHours), {
    state: 'free', date: '2026-11-04', from: '18:00', until: '19:00', openFrom: '07:00', openUntil: '20:00'
  });
  const offGrid = planSlot('2026-11-04', '18:15', officeHours);
  assert.equal(offGrid.state, 'free');
  assert.equal(offGrid.from, '18:00');
  assert.equal(offGrid.until, '19:30');
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
  assert.match(edgeFunction, /`\$\{matchLabel\(match\)\} – PadelLiga`/);
  assert.match(edgeFunction, /"Training – PadelLiga"/);
});

test('Buchungsspiegel und Clearooms-Schlüssel bleiben serverseitig', () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.racket_bookings from public, anon, authenticated/);
  assert.match(edgeFunction, /Deno\.env\.get\("CLEAROOMS_API_TOKEN"\)/);
  assert.match(edgeFunction, /counts_for_profile === false/);
  assert.match(edgeFunction, /TEST_PLAYER_IDS/);
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
