const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const modulePromise = import(path.join(__dirname, '../supabase/functions/court-availability/data.ts'));

const hours = Object.fromEntries(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
  .map(day => [day, { opening_time: '07:00', closing_time: '00:00' }]));
const club = { courts: [{ id: 'hall', name: 'Halle', location: 'indoor' }, { id: 'outside', name: 'Außen', location: 'outdoor' }], openingHours: hours };
const row = (date, slots) => [{ resource_id: 'hall', start_date: date, slots }];
const slot = (time, duration = 60) => ({ start_time: time, duration, price: '32 EUR' });

test('nur echte Kalendertage werden akzeptiert', async () => {
  const { isDate } = await modulePromise;
  assert.equal(isDate('2026-02-29'), false);
  assert.equal(isDate('2028-02-29'), true);
  for (const invalid of [null, '2026-11-31', '2026-00-01', 'foo', '2026-11-06&sport_id=TENNIS']) assert.equal(isDate(invalid), false);
});

test('öffentliche Clubmetadaten werden ohne Ausführen von Seitencode gelesen', async () => {
  const { parseClub, CLUB_ID } = await modulePromise;
  const tenant = { tenant_id: CLUB_ID, address: { timezone: 'Europe/Berlin' }, opening_hours: hours,
    resources: [{ resourceId: 'hall', name: ' Halle 1 ', sport: 'PADEL', features: ['Indoor'] },
      { resourceId: 'outside', name: 'Außen', sport: 'PADEL', features: ['Outdoor'] },
      { resourceId: 'tennis', name: 'Tennis', sport: 'TENNIS', features: ['Outdoor'] }] };
  const stream = '0:' + JSON.stringify({ tenant });
  const html = `<script>self.__next_f.push([1,${JSON.stringify(stream.slice(0, 50))}])</script><script>self.__next_f.push([1,${JSON.stringify(stream.slice(50))}])</script>`;
  assert.deepEqual(parseClub(html), { ...club, courts: [{ id: 'hall', name: 'Halle 1', location: 'indoor' }, club.courts[1]] });
  assert.throws(() => parseClub('<html>Fehlerseite</html>'), /Platzinformationen/);
  const foreign = `<script>self.__next_f.push([1,${JSON.stringify(JSON.stringify({ tenant: { ...tenant, tenant_id: 'other-club' } }))}])</script>`;
  assert.throws(() => parseClub(foreign), /Platzinformationen/);
});

test('nur zukünftige volle Stundenfenster, eindeutige IDs und keine Buchungs-/Personendaten', async () => {
  const { normalizeAvailability } = await modulePromise;
  const raw = row('2026-11-06', [slot('06:00:00'), slot('06:00:00'), slot('07:00:00', 90), slot('08:00:00', 120), slot('21:30:00')]);
  const result = normalizeAvailability(raw, club, '2026-11-06', Date.parse('2026-11-06T06:00:00Z'));
  assert.equal(result.slots.length, 1);
  assert.equal(result.slots[0].time, '22:30');
  assert.equal(Date.parse(result.slots[0].end) - Date.parse(result.slots[0].start), 3600000);
  assert.equal(result.opening.until, '24:00');
  assert.equal('price' in result.slots[0], false);
  assert.equal(result.courts.length, 2, 'auch ausgebuchte Plätze bleiben erhalten');
});

test('Sommer- und Winterzeit sowie wiederholte Herbststunde bleiben eindeutige Zeitpunkte', async () => {
  const { normalizeAvailability, berlinParts } = await modulePromise;
  assert.deepEqual(berlinParts(new Date('2026-07-01T06:00:00Z')), { date: '2026-07-01', time: '08:00' });
  assert.deepEqual(berlinParts(new Date('2026-11-06T06:00:00Z')), { date: '2026-11-06', time: '07:00' });
  const result = normalizeAvailability(row('2026-10-25', [slot('00:30:00'), slot('01:30:00')]), club, '2026-10-25', 0);
  assert.equal(result.slots.length, 2);
  assert.equal(new Set(result.slots.map(value => value.id)).size, 2);
  assert.equal(result.slots[0].time, result.slots[1].time);
});

test('UTC-Slots eines anderen Berliner Tages werden nicht übernommen', async () => {
  const { normalizeAvailability } = await modulePromise;
  const result = normalizeAvailability(row('2026-11-06', [slot('22:00:00'), slot('23:00:00')]), club, '2026-11-06', 0);
  assert.deepEqual(result.slots.map(value => value.time), ['23:00']);
});

test('leere Antwort ist zulässig; geänderte oder beschädigte Daten werden nicht als freie Plätze ausgegeben', async () => {
  const { normalizeAvailability } = await modulePromise;
  assert.deepEqual(normalizeAvailability([], club, '2026-11-06', 0).slots, []);
  for (const raw of [{ error: 'blocked' }, [null], row('2026-11-06', [slot('99:00:00')]), row('2026-02-31', [])]) {
    assert.throws(() => normalizeAvailability(raw, club, '2026-11-06', 0));
  }
  assert.throws(() => normalizeAvailability([], { ...club, openingHours: {} }, '2026-11-06', 0));
});

test('Winterfilter und Zeitspalten bleiben unabhängig vom vorhandenen freien Angebot', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/court-availability.js'), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source.slice(0, source.indexOf('  const dialog ='))
    + 'window.helpers = { defaultFilter, buildTimes, visibleSlots }; })();', context);
  const { defaultFilter, buildTimes, visibleSlots } = context.window.helpers;
  for (const season of ['2026-winter', 'winter-2026', '2027-winter']) assert.equal(defaultFilter(season), 'indoor');
  for (const season of ['2026-sommer', '2027-cup', '2026-test', null]) assert.equal(defaultFilter(season), 'outdoor');
  const times = Array.from(buildTimes({ opening: { from: '07:00', until: '24:00' }, slots: [{ time: '07:15' }] }));
  assert.equal(times[0], '07:00');
  assert.equal(times.at(-1), '19:30');
  assert.ok(times.includes('07:15'));
  assert.equal(times.includes('20:00'), false, 'Bürozeiten enden um 20 Uhr');
  const allTimes = Array.from(buildTimes({ opening: { from: '07:00', until: '24:00' }, slots: [] }, 'all'));
  assert.equal(allTimes.at(-1), '23:30', 'letzte halbe Stunde bleibt als Fortsetzung sichtbar');
  const sample = { opening: { from: '07:00', until: '24:00' }, slots: ['06:30', '07:00', '19:00', '19:30', '22:30'].map(time => ({ time, start: `2099-01-01T${time}:00Z` })) };
  assert.deepEqual(Array.from(visibleSlots(sample), slot => slot.time), ['07:00', '19:00'], 'nur vollständige Stunden innerhalb der Bürozeiten');
  assert.deepEqual(Array.from(visibleSlots(sample, 'all'), slot => slot.time), ['07:00', '19:00', '19:30', '22:30']);
});

test('Hover markiert eine volle Stunde desselben Platzes, ohne eine Auswahl zu speichern', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/court-availability.js'), 'utf8');
  const definition = source.slice(source.indexOf('  function paintRange()'), source.indexOf('  function renderGrid()'));
  const cells = ['hall', 'outside'].flatMap(id => ['18:30', '19:00', '19:30', '20:00'].map(time => {
    const classes = new Set();
    return { dataset: { courtCell: id, courtTime: time }, classes,
      classList: { toggle: (name, active) => active ? classes.add(name) : classes.delete(name) } };
  }));
  const context = { grid: { querySelectorAll: () => cells }, selected: null,
    preview: { courtId: 'hall', time: '19:00' }, minute: time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) };
  vm.createContext(context);
  vm.runInContext(definition + 'paintRange();', context);
  assert.deepEqual(cells.filter(cell => cell.classes.has('is-preview')).map(cell => cell.dataset.courtTime), ['19:00', '19:30']);
  assert.equal(context.selected, null);
  context.preview = null;
  context.selected = { courtId: 'outside', time: '18:30' };
  vm.runInContext('paintRange();', context);
  assert.equal(cells.some(cell => cell.classes.has('is-preview')), false);
  assert.deepEqual(cells.filter(cell => cell.classes.has('is-selected')).map(cell => cell.dataset.courtCell), ['outside', 'outside']);
});

test('Partieauswahl schließt fremde, abgeschlossene, wartende und vergangene Partien aus', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/account.js'), 'utf8');
  const definition = source.slice(source.indexOf('  function courtSelectableTasks()'), source.indexOf('  function renderCourtMatchSelection()'));
  const tasks = [
    { match_id: 'own', task_type: 'enter', my_team: 1 },
    { match_id: 'future', task_type: 'enter', my_team: 2, match_at: '2099-01-01T10:00:00Z' },
    { match_id: 'foreign', task_type: 'enter', my_team: null },
    { match_id: 'waiting', task_type: 'waiting', my_team: 1 },
    { match_id: 'completed', task_type: 'completed', my_team: 1 },
    { match_id: 'past', task_type: 'enter', my_team: 1, match_at: '2000-01-01T10:00:00Z' },
  ];
  const context = { state: { profile: { app_role: 'player' } }, getVisibleResultTasks: () => tasks,
    getMatchAtTimestamp: value => Date.parse(value) };
  vm.createContext(context);
  vm.runInContext(definition, context);
  assert.deepEqual(Array.from(vm.runInContext('courtSelectableTasks().map(task => task.match_id)', context)), ['own', 'future']);
  context.state.profile.app_role = 'admin';
  assert.deepEqual(Array.from(vm.runInContext('courtSelectableTasks().map(task => task.match_id)', context)), ['own', 'future', 'foreign']);
});
