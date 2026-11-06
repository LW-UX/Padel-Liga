const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const calendar = fs.readFileSync(path.join(root, 'js/court-availability.js'), 'utf8');
const account = fs.readFileSync(path.join(root, 'js/account.js'), 'utf8');

function helpers() {
  const context = { window: {} };
  vm.runInNewContext(calendar.slice(0, calendar.indexOf('  const dialog ='))
    + 'window.helpers = { renderAppointmentRow, buildTimes }; })();', context);
  return context.window.helpers;
}

test('the passive appointment row stays present even when empty and never offers court selection', () => {
  const { renderAppointmentRow, buildTimes } = helpers();
  const times = buildTimes({ opening: { from: '07:00', until: '20:00' }, slots: [] });
  const entry = (id, time, label = 'Training', shortLabel = 'TR') => ({ id, time, duration: 60, label, shortLabel, participants: 'A, B, C, D' });
  const html = renderAppointmentRow(times, [entry('a', '12:00', 'Partie 7', 'P.7'), entry('b', '12:00'), entry('c', '12:30')]);
  assert.equal((html.match(/class="court-unassigned-row"/g) || []).length, 1);
  assert.match(html, />P\.7<\/span>/);
  assert.match(html, />TR<\/span>/);
  assert.match(html, /Ohne zugeordnete Platzbuchung · A, B, C, D/);
  assert.match(html, /top:0px/);
  assert.match(html, /top:16px/);
  assert.match(html, /top:32px/);
  assert.doesNotMatch(html, /<button|data-court-slot|data-court-cell|is-free|is-preview/);
  assert.match(renderAppointmentRow(times), /class="court-unassigned-row"/);
  assert.doesNotMatch(renderAppointmentRow(times, [], true), /court-appointment-placeholder|court-appointment"/);
  assert.doesNotMatch(renderAppointmentRow(times, [entry('a', '06:00'), entry('b', '20:00')]), /data-court-appointment-info/);
});

test('indoor and outdoor skeletons both reserve the same additional passive row', () => {
  for (const filter of ['indoor', 'outdoor']) {
    const grid = { scrollTop: 0, scrollLeft: 0, style: {}, getBoundingClientRect: () => ({ height: 250 }) };
    const count = filter === 'indoor' ? 4 : 10;
    const source = { opening: { from: '07:00', until: '20:00' }, slots: [],
      courts: Array.from({ length: count }, (_, index) => ({ id: `${filter}-${index + 1}`,
        name: filter === 'indoor' ? `CUPRA Indoor H${index + 1}` : `Sponsor Court ${index + 1}`, location: filter })) };
    const context = vm.createContext({ window: {}, grid, data: null, filter, hoursFilter: 'office', source });
    const skeleton = calendar.slice(calendar.indexOf('  function renderGridSkeleton('), calendar.indexOf('  function renderGrid()'));
    vm.runInContext(calendar.slice(0, calendar.indexOf('  const dialog =')) + skeleton
      + 'renderGridSkeleton(source); })();', context);
    assert.equal((grid.innerHTML.match(/class="court-unassigned-row"/g) || []).length, 1);
    assert.doesNotMatch(grid.innerHTML, /court-appointment-placeholder|court-name-full|court-name-short|CUPRA|Sponsor/);
    assert.equal(grid.style.minHeight, '250px');
    assert.equal((grid.innerHTML.match(/<tr>/g) || []).length, count + 1);
  }
});

test('calendar appointments include only visible open schedules and disappear after a court booking is linked', async () => {
  const tasks = [
    { match_id: 'm1', match_at: '2099-11-06T11:00:00Z', task_type: 'enter', match_players: [{ player_id: 'a' }] },
    { match_id: 'm2', match_at: '2099-11-06T12:00:00Z', task_type: 'enter' },
    { match_id: 'm3', match_at: '2099-11-06T13:00:00Z', task_type: 'waiting' },
    { match_id: 'm4', match_at: '2099-11-07T12:00:00Z', task_type: 'enter' },
    { match_id: 'm5', match_at: null, task_type: 'enter' },
  ];
  const state = { session: { user: { id: 'user' } }, client: {}, playerToolsVersion: 1,
    courtBookings: [{ match_id: 'm2' }], trainingTasks: [
      { session_id: 1, status: 'scheduled', played_on: '2099-11-06', display_time: '12:00', player_ids: ['a', 'guest'], guest_names: { guest: 'Gast' } },
      { session_id: 2, status: 'pending', played_on: '2099-11-06', display_time: '13:00' }
    ] };
  const context = vm.createContext({ state, init: async () => {}, isPlayerAccount: () => true,
    refreshPlayerMatchData: async () => {}, getVisibleResultTasks: () => tasks,
    getMatchAtTimestamp: (value, fallback) => value ? Date.parse(value) : fallback,
    getTaskNumber: task => task.match_id.slice(1), getTaskLeagueLabel: () => 'Winter 2099', getTaskMatchLabel: () => 'Partie 1',
    getPlayerName: (id, guests = {}) => guests[id] || 'Anna',
    getTrainingTaskTimestamp: task => Date.parse(`${task.played_on}T${task.display_time}:00Z`),
    getBerlinMatchAtParts: value => ({ date: value.slice(0, 10), time: value.slice(11, 16) }) });
  vm.runInContext(account.slice(account.indexOf('  async function getCourtAppointments('), account.indexOf('  function chooseReplacementCourtBooking(')), context);
  let result = await context.getCourtAppointments('2099-11-06');
  assert.deepEqual(Array.from(result, entry => entry.id), ['match:m1', 'training:1']);
  assert.equal(result[0].shortLabel, 'P.1');
  assert.equal(result[1].shortLabel, 'TR');
  assert.equal(result[1].participants, 'Anna, Gast');
  assert.equal(result[0].duration, 60);
  state.courtBookings.push({ match_id: 'm1' });
  result = await context.getCourtAppointments('2099-11-06');
  assert.deepEqual(Array.from(result, entry => entry.id), ['training:1']);
  state.session = null;
  assert.equal((await context.getCourtAppointments('2099-11-06')).length, 0);
});
