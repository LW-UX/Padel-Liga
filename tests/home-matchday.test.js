const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/home-matchday.js'), 'utf8');
const now = new Date('2026-11-06T10:00:00Z');

function setup() {
  const target = { hidden: true, innerHTML: '' };
  const timers = [];
  const listeners = {};
  const window = { clearTimeout() {}, setTimeout(callback) { timers.push(callback); return timers.length; } };
  const document = {
    getElementById: () => target,
    addEventListener: (name, callback) => { listeners[name] = callback; }
  };
  vm.runInNewContext(source, { window, document, Intl, Date });
  return { ...window.PadelHomeMatchday, target, timers, listeners, document };
}

function match(changes = {}) {
  return {
    match_id: 'winter-1', season_label: 'Winter 2026', match_at: '2026-11-06T17:00:00Z',
    task_type: 'enter', my_team: 2, display_label: 'Partie 1',
    match_players: [
      { player_id: 'a', team: 1 }, { player_id: 'b', team: 1 },
      { player_id: 'me', team: 2 }, { player_id: 'partner', team: 2 }
    ], ...changes
  };
}

function data(changes = {}) {
  return {
    ready: true, session: { user: { id: 'account' } },
    profile: { id: 'account', player_id: 'me', app_role: 'player' },
    resultTasks: [match()], trainingTasks: [], courtBookings: [],
    getMatchLabel: task => task.display_label,
    getPlayerName: (id, guests = {}) => guests[id] || ({ me: 'Ich', a: 'Anna', b: 'Ben', partner: 'Paula' })[id] || id,
    ...changes
  };
}

test('only the signed-in linked player sees their own appointments, including for admins', () => {
  const { getEntries } = setup();
  assert.equal(getEntries(data(), now).length, 1);
  for (const changes of [
    { session: null }, { ready: false },
    { profile: { id: 'other-account', player_id: 'me', app_role: 'player' } },
    { profile: { id: 'account', app_role: 'admin' } },
    { profile: { id: 'account', player_id: 'me', app_role: 'tipper' } },
    { profile: { id: 'account', player_id: 'someone-else', app_role: 'admin' } }
  ]) assert.equal(getEntries(data(changes), now).length, 0);
});

test('Berlin calendar day is used across midnight and daylight saving time', () => {
  const { getEntries } = setup();
  const appointments = data({ resultTasks: [
    match({ match_id: 'today', match_at: '2026-11-05T23:30:00Z' }),
    match({ match_id: 'tomorrow', match_at: '2026-11-06T23:30:00Z' })
  ] });
  assert.deepEqual(Array.from(getEntries(appointments, now), entry => entry.id), ['today']);
  const summer = getEntries(data({ resultTasks: [match({ match_at: '2026-07-01T22:30:00Z' })] }), new Date('2026-07-02T08:00:00Z'));
  assert.equal(summer[0].time, '00:30');
});

test('untimed, other-day, completed and already proposed matches are omitted', () => {
  const { getEntries } = setup();
  for (const changes of [
    { match_at: null }, { match_at: 'invalid' }, { match_at: '2026-11-07T17:00:00Z' },
    { task_type: 'completed' }, { task_type: 'waiting' }, { task_type: 'review' }
  ]) assert.equal(getEntries(data({ resultTasks: [match(changes)] }), now).length, 0);
});

test('partner and opponents follow the actual team, and the court must match the official start', () => {
  const { getEntries } = setup();
  const appointment = data({ courtBookings: [{ match_id: 'winter-1', starts_at: '2026-11-06T18:00:00+01:00', court_name: 'Indoor 2' }] });
  const [entry] = getEntries(appointment, now);
  assert.equal(entry.partner, 'Paula');
  assert.deepEqual(Array.from(entry.opponents), ['Anna', 'Ben']);
  assert.equal(entry.court, 'Indoor 2');
  appointment.courtBookings[0].starts_at = '2026-11-06T18:00:00Z';
  assert.equal(getEntries(appointment, now)[0].court, '');
});

test('own scheduled training with guests joins matches from multiple seasons in time order', () => {
  const { getEntries } = setup();
  const appointments = data({
    resultTasks: [match(), match({ match_id: 'cup-1', season_label: 'Cup 2027', match_at: '2026-11-06T12:00:00Z' })],
    trainingTasks: [
      { session_id: 1, status: 'scheduled', played_on: '2026-11-06', display_time: '16:30:00', player_ids: ['me', 'a', 'b', 'guest:4'], guest_names: { 'guest:4': 'Alex' } },
      { session_id: 2, status: 'pending', played_on: '2026-11-06', display_time: '11:00:00', player_ids: ['me'] },
      { session_id: 3, status: 'scheduled', played_on: '2026-11-06', display_time: '11:00:00', player_ids: ['other'] }
    ]
  });
  const entries = getEntries(appointments, now);
  assert.deepEqual(Array.from(entries, entry => entry.id), ['cup-1', 1, 'winter-1']);
  assert.deepEqual(Array.from(entries[1].participants), ['Anna', 'Ben', 'Alex']);
});

test('render clears personal content immediately on logout and updates after a day change', () => {
  const app = setup();
  app.render(data(), now);
  assert.equal(app.target.hidden, false);
  assert.match(app.target.innerHTML, /Heute ist Spieltag/);
  assert.match(app.target.innerHTML, /18:00/);
  assert.match(app.target.innerHTML, /Du &amp; Paula/);
  assert.match(app.target.innerHTML, /Platz noch offen/);
  app.render(data(), new Date('2026-11-07T00:00:00Z'));
  assert.equal(app.target.hidden, true);
  app.render(data(), now);
  app.render(data({ session: null }), now);
  assert.equal(app.target.hidden, true);
  assert.equal(app.target.innerHTML, '');
  assert.ok(app.timers.length);
});

test('names, match labels and court names are escaped before rendering', () => {
  const app = setup();
  app.render(data({ getPlayerName: () => '<img src=x onerror=alert(1)>', getMatchLabel: () => '<script>bad</script>' }), now);
  assert.doesNotMatch(app.target.innerHTML, /<img|<script>/);
  assert.match(app.target.innerHTML, /&lt;img/);
});

test('Hallencodes erscheinen am Spieltag nur für passende aktive H1–H4-Buchungen', () => {
  const app = setup();
  const booking = { booking_id: 1, match_id: 'winter-1', starts_at: '2026-11-06T17:00:00Z', ends_at: '2026-11-06T18:00:00Z', court_name: 'CUPRA Indoor H1' };
  app.render(data({ courtBookings: [booking] }), now);
  assert.match(app.target.innerHTML, /data-hall-code-surface="home"/);
  app.render(data({ courtBookings: [{ ...booking, court_name: 'Court 1' }] }), now);
  assert.doesNotMatch(app.target.innerHTML, /data-hall-code-match/);
  app.render(data({ courtBookings: [booking], resultTasks: [match({ task_type: 'waiting' })] }), now);
  assert.doesNotMatch(app.target.innerHTML, /data-hall-code-match/);
});

test('Trainings mit passender Hallenbuchung zeigen Platz und Trainingscode', () => {
  const app = setup();
  const training = { session_id: 5, status: 'scheduled', played_on: '2026-11-06', display_time: '16:30:00', player_ids: ['me', 'a', 'b', 'partner'] };
  const booking = { booking_id: 2, training_session_id: 5, starts_at: '2026-11-06T15:30:00Z', ends_at: '2026-11-06T16:30:00Z', court_name: 'CUPRA Indoor H3' };
  app.render(data({ resultTasks: [], trainingTasks: [training], courtBookings: [booking] }), now);
  assert.match(app.target.innerHTML, /data-hall-code-training="5"/);
  assert.match(app.target.innerHTML, /Lucky Star Padel · CUPRA Indoor H3/);
  app.render(data({ resultTasks: [], trainingTasks: [{ ...training, display_time: '17:00:00' }], courtBookings: [booking] }), now);
  assert.doesNotMatch(app.target.innerHTML, /data-hall-code-training/);
  assert.match(app.target.innerHTML, /Ort wie vereinbart/);
});
