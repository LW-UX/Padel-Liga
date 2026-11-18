const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const search = require('../js/site-search-core');

const { window: { PADEL_PLAYERS: players } } = vm.runInNewContext(
  fs.readFileSync(require.resolve('../data/players.js'), 'utf8') + '\n;({window})',
  { window: {} }
);

test('search starts at three characters except numbered shorthand', () => {
  for (const query of ['Fl', 'Le', '12', 'P', 'A', 'F', 'Aß']) assert.equal(search.parseQuery(query).kind, 'idle', query);
  assert.deepEqual(search.parseQuery('Flo'), { kind: 'text', query: 'flo' });
  assert.deepEqual(search.parseQuery(' P12 '), { kind: 'partie', number: 12 });
  assert.deepEqual(search.parseQuery('p1'), { kind: 'partie', number: 1 });
  assert.deepEqual(search.parseQuery('a7'), { kind: 'artikel', number: 7 });
  assert.deepEqual(search.parseQuery('F2'), { kind: 'final-four', number: 2 });
});

test('player initials are searchable regardless of case, including two-letter initials', () => {
  for (const player of players.filter(player => player.firma !== 'Test')) {
    const input = player.initials.toLowerCase();
    const query = search.parseQuery(input, new Date(), players);
    assert.equal(query.kind, 'text', input);
    assert.ok(search.resolveNames(players, query.query).flat().some(hit => hit.id === player.id), input);
  }
  assert.equal(search.parseQuery('Fl', new Date(), players).kind, 'idle');
  const query = search.parseQuery('AK', new Date(), players);
  assert.ok(search.matchesQuery({ team1: { playerIds: ['agnes_k'] } }, query, search.resolveNames(players, query.query)));
});

test('short names, approved aliases and multi-player assignment stay distinct', () => {
  const resolve = query => search.resolveNames(players, query).map(group => group.map(player => player.id));
  assert.deepEqual(Array.from(resolve('Flo')[0]), ['florian_z']);
  assert.deepEqual(Array.from(resolve('Leo')[0]), ['leonie_r']);
  assert.deepEqual(Array.from(resolve('Mayr')[0]).sort(), ['chris_m', 'marcel_m', 'marco_m']);
  assert.deepEqual(Array.from(resolve('Luca W.')[0]), ['luca_w']);
  assert.deepEqual(Array.from(resolve('Christoph')[0]).sort(), ['chris_m', 'christoph_l']);
  assert.deepEqual(Array.from(resolve('Chris')[0]).sort(), ['chris_m', 'christian_h', 'christoph_l']);
  const match = { team1: { playerIds: ['luca_w', 'marcel_m'] }, team2: { playerIds: ['ludwig_w', 'leonie_r'] } };
  for (const query of ['Matze Luca', 'Luca Matze Ludi', 'Leo Ludi Luca Matze']) {
    assert.ok(search.matchesQuery(match, search.parseQuery(query), search.resolveNames(players, query)), query);
  }
  assert.equal(search.matchesQuery(match, search.parseQuery('Chris Luca'), search.resolveNames(players, 'Chris Luca')), false);
  assert.equal(search.matchesQuery(match, search.parseQuery('Chris Mayr'), search.resolveNames(players, 'Chris Mayr')), false);
});

test('comparison separates team results from direct duels and skips ambiguous pairs', () => {
  const pair = search.resolveNames(players, 'Matze Ludi');
  const team = { team1: { playerIds: ['marcel_m', 'ludwig_w'] }, team2: { playerIds: [] }, winner: 1 };
  const duel = { team1: { playerIds: ['ludwig_w'] }, team2: { playerIds: ['marcel_m'] }, winner: 1 };
  const matches = [team, duel, { ...duel, winner: null }, { ...team, winner: 2, isCancelled: true }];
  const summary = search.summarizePair(matches, pair);
  assert.deepEqual(summary.team, [1, 0]);
  assert.deepEqual(summary.duel, [0, 1]);
  assert.deepEqual(search.summarizePair(matches, pair.toReversed()).duel, [1, 0]);
  assert.equal(search.summarizePair(matches, search.resolveNames(players, 'Chris Ludi')), null);
});

test('dates prefer the current and next Berlin month and otherwise look back', () => {
  const november = new Date('2026-11-18T17:00:00Z');
  const december = new Date('2026-11-30T23:30:00Z');
  assert.equal(search.parseQuery('21.11.', november).key, '2026-11-21');
  assert.equal(search.parseQuery('21 dez', november).key, '2026-12-21');
  assert.equal(search.parseQuery('Januar', november).key, '2026-01');
  assert.equal(search.parseQuery('Januar', december).key, '2027-01');
  assert.equal(search.parseQuery('21. Dezember 25', november).key, '2025-12-21');
  assert.equal(search.parseQuery('21.11.2025', november).key, '2025-11-21');
  assert.equal(search.parseQuery('31. Februar', november).kind, 'invalid-date');
  assert.ok(search.matchesQuery({ matchAt: '2026-11-20T23:30:00Z' }, search.parseQuery('21.11.', november), []));
});

test('part number, final four number and article number search different kinds', () => {
  const league = { id: 'season-partie-2', stage: 'league' };
  const finalFour = { id: 'season-final-2', stage: 'final-four', displayLabel: 'Final Four 2' };
  assert.ok(search.matchesQuery(league, search.parseQuery('P2'), []));
  assert.equal(search.matchesQuery(finalFour, search.parseQuery('P2'), []), false);
  assert.ok(search.matchesQuery(finalFour, search.parseQuery('f2'), []));
  assert.equal(search.matchesQuery(league, search.parseQuery('F2'), []), false);

  const article = { spieltag: 7, title: 'Die Liga ruft', body: [{ text: 'Endspurt' }] };
  assert.ok(search.articleMatches(article, search.parseQuery('A7')));
  assert.ok(search.articleMatches(article, search.parseQuery('Artikel 7')));
  assert.ok(search.articleMatches(article, search.parseQuery('Liga')));
  assert.equal(search.articleMatches(article, search.parseQuery('Endspurt')), false);
  assert.ok(search.articleMatches(article, search.parseQuery('Endspurt'), { includeText: true }));
  assert.ok(search.articleMatches(article, search.parseQuery('A7'), { includeText: true }));
});

test('search reads editorial seasons without replacing the currently rendered season', () => {
  const current = { id: 'current' };
  const window = { PADEL_SEASON: current };
  const file = fs.readFileSync(require.resolve('../data/data-2026-sommer.js'), 'utf8');
  let captured;
  vm.runInNewContext(file, { window, document: { currentScript: { padelSearchReceive: season => { captured = season; } } } });
  assert.equal(window.PADEL_SEASON, current);
  assert.equal(captured.id, '2026-sommer');
  assert.ok(captured.articles.some(article => search.articleMatches(article, search.parseQuery('A7'))));
});

test('training search supports names, dates and guests without matching private test or pending sessions', () => {
  const playersById = new Map(players.map(player => [player.id, player]));
  const row = {
    session_id: 24, played_on: '2026-11-21', display_time: '18:30:00', status: 'scheduled',
    player_ids: ['luca_w', 'ludwig_w', 'marcel_m', 'guest_4'], guest_names: { guest_4: 'Sam Beispiel' }
  };
  const scheduled = search.normalizeTraining(row, 'scheduled', playersById);
  assert.equal(scheduled.time, '18:30');
  assert.equal(scheduled.confirmed, false);
  assert.ok(search.trainingMatches(scheduled, search.parseQuery('Training')));
  assert.ok(search.trainingMatches(scheduled, search.parseQuery('Luca Ludi Sam')));
  assert.ok(search.trainingMatches(scheduled, search.parseQuery('November 26')));
  assert.equal(search.trainingMatches(scheduled, search.parseQuery('P24')), false);
  assert.equal(search.trainingMatches(scheduled, search.parseQuery('Sam Beispiel Sam')), false);
  assert.equal(search.normalizeTraining({ ...row, status: 'pending' }, 'scheduled', playersById), null);
  assert.equal(search.normalizeTraining({ ...row, player_ids: ['ludi_gmx', 'luca_w'] }, 'scheduled', playersById), null);

  const confirmed = search.normalizeTraining({ ...row, players: [
    { id: 'ludwig_w', display_name: 'Ludwig W.' },
    { id: null, display_name: 'Sam Beispiel', is_guest: true }
  ] }, 'confirmed', playersById);
  assert.equal(confirmed.confirmed, true);
  assert.ok(search.trainingMatches(confirmed, search.parseQuery('Ludi Sam Beispiel')));
  assert.equal(search.normalizeTraining({ ...row, players: [{ id: 'test_net', display_name: 'Test Net' }] }, 'confirmed', playersById), null);
});

test('confirmed admins can open search and reveal filters by mouse or keyboard, with filters always available on touch', () => {
  const listeners = new Map();
  const on = target => (name, handler) => listeners.set(`${target}:${name}`, handler);
  const button = {
    hidden: false, disabled: true, loading: true, querySelector: () => ({}), setAttribute() {},
    removeAttribute() { this.loading = false; }, addEventListener: on('button')
  };
  const input = { value: '', focus() {}, select() {}, setAttribute() {}, addEventListener: on('input') };
  const searchField = { contains: target => target === input };
  const content = { replaceChildren() {}, contains: () => false, addEventListener() {} };
  const output = { dataset: {}, contains: () => false, addEventListener: on('output') };
  let runSearch;
  let filterWidth = '';
  let chipFocused = false;
  const filterTray = { contains: () => false, style: { setProperty: (_, value) => { filterWidth = value; } } };
  const filterChips = {
    offsetWidth: 265,
    querySelector: () => ({ focus: () => { chipFocused = true; } })
  };
  const filterButtons = ['all', 'articles'].map(value => ({
    dataset: { searchFilter: value },
    textContent: value === 'all' ? 'Alles' : 'Artikel',
    pressed: value === 'all' ? 'true' : 'false',
    setAttribute(_, pressed) { this.pressed = pressed; }
  }));
  const stackedFilters = { matches: false };
  const dialog = {
    open: false,
    setAttribute() {},
    showModal() { this.open = true; },
    close() { this.open = false; listeners.get('dialog:close')(); },
    addEventListener: on('dialog'),
    querySelectorAll: () => filterButtons,
    querySelector(selector) {
      if (selector === 'input') return input;
      if (selector === '.site-search-field') return searchField;
      if (selector === '.site-search-filter-tray') return filterTray;
      if (selector === '.site-search-filters') return filterChips;
      if (selector === '.site-search-output') return output;
      return content;
    }
  };
  let otherModal = null;
  let session = null;
  let profile = null;
  const window = {
    PadelSearchCore: search,
    PadelKonto: { getSession: () => session, getProfile: () => profile },
    addEventListener: on('window')
  };
  const document = {
    body: { classList: { contains: () => false }, append() {} },
    documentElement: { classList: { contains: () => false } },
    querySelector: selector => selector === '[data-site-search-open]' ? button : selector === 'dialog:modal' ? otherModal : null,
    getElementById: id => id === 'external-game-link' ? { after() {} } : null,
    createElement: () => dialog
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/site-search.js'), 'utf8'), {
    window, document, navigator: {},
    matchMedia: query => query.includes('any-pointer') ? stackedFilters : { matches: false },
    setTimeout: callback => { runSearch = callback; return 1; },
    clearTimeout: () => { runSearch = undefined; }
  });

  const shortcut = ({ metaKey = false, repeat = false } = {}) => {
    let intercepted = false;
    listeners.get('window:keydown')({
      key: 'k', ctrlKey: !metaKey, metaKey, repeat, stopPropagation() {}, preventDefault: () => { intercepted = true; }
    });
    return intercepted;
  };
  const authChanged = () => listeners.get('window:padel:auth-state-changed')();
  assert.equal(button.loading, true);
  assert.equal(button.disabled, true);
  assert.equal(shortcut(), false);
  listeners.get('button:click')();
  assert.equal(dialog.open, false);
  listeners.get('window:padel:account-initialized')();
  assert.equal(button.loading, false);
  assert.equal(button.hidden, true);

  session = { user: { id: 'current', email_confirmed_at: 'confirmed' } };
  for (profile of [{ id: 'current', app_role: 'player' }, { id: 'other', app_role: 'admin' }]) {
    authChanged();
    assert.equal(button.hidden, true);
    assert.equal(shortcut(), false);
  }

  profile = { id: 'current', app_role: 'admin' };
  session = { user: { id: 'current' } };
  authChanged();
  assert.equal(button.hidden, true);
  assert.equal(shortcut(), false);

  otherModal = { open: true };
  session.user.email_confirmed_at = 'confirmed';
  authChanged();
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, false);
  assert.equal(shortcut(), true);
  assert.equal(dialog.open, true);
  assert.equal(output.dataset.expanded, 'false');
  assert.equal(filterTray.inert, true);
  listeners.get('dialog:pointermove')({ pointerType: 'mouse', target: input });
  assert.equal(filterTray.inert, false);
  assert.equal(filterWidth, '265px');

  assert.equal(shortcut({ metaKey: true, repeat: true }), true);
  assert.equal(dialog.open, true);
  assert.equal(shortcut({ metaKey: true }), true);
  assert.equal(dialog.open, false);
  listeners.get('button:click')();
  assert.equal(filterTray.inert, true);
  let interceptedTab = false;
  listeners.get('dialog:keydown')({
    key: 'Tab', target: input, preventDefault: () => { interceptedTab = true; }
  });
  assert.equal(filterTray.inert, false);
  assert.ok(interceptedTab && chipFocused);
  input.value = 'PadelPost';
  listeners.get('input:input')();
  assert.equal(filterTray.inert, false);
  runSearch();
  assert.equal(filterTray.inert, true);
  assert.equal(output.dataset.expanded, 'true');
  assert.equal(output.inert, false);
  listeners.get('dialog:pointermove')({ pointerType: 'mouse', target: content });
  assert.equal(filterTray.inert, true);
  listeners.get('dialog:pointermove')({ pointerType: 'mouse', target: input });
  assert.equal(filterTray.inert, false);
  listeners.get('dialog:click')({ target: { closest: () => filterButtons[1] } });
  assert.equal(input.value, 'PadelPost');
  assert.deepEqual(filterButtons.map(chip => chip.pressed), ['false', 'true']);
  assert.equal(filterTray.inert, true);
  assert.equal(input.placeholder, 'Artikel durchsuchen');

  input.value = '';
  listeners.get('input:input')();
  assert.equal(output.dataset.expanded, 'false');
  assert.equal(output.inert, true);
  assert.equal(dialog.open, true);

  dialog.close();
  stackedFilters.matches = true;
  input.value = 'PadelPost';
  listeners.get('button:click')();
  assert.equal(filterTray.inert, false);
  listeners.get('dialog:click')({ target: dialog });
  assert.equal(dialog.open, true);
  assert.equal(output.dataset.expanded, 'false');
  assert.equal(output.inert, true);
  listeners.get('output:transitionend')({ target: output, propertyName: 'grid-template-rows' });
  assert.equal(dialog.open, false);
  listeners.get('button:click')();

  session = null;
  authChanged();
  assert.equal(button.hidden, true);
  assert.equal(dialog.open, false);
  assert.equal(shortcut(), false);
});


test('embedded detail views forward the search shortcut to their parent in capture phase', () => {
  let handler;
  let capture;
  const messages = [];
  const window = { parent: { postMessage: (...args) => messages.push(args) }, addEventListener(type, callback, options) { assert.equal(type, 'keydown'); handler = callback; capture = options; } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/site-search.js'), 'utf8'), {
    window, document: { documentElement: { classList: { contains: () => true } } }, location: { origin: 'https://liga.example' }
  });
  assert.equal(capture, true);
  let prevented = 0;
  const event = { key: 'k', metaKey: true, ctrlKey: false, preventDefault() { prevented++; }, stopPropagation() {} };
  handler(event);
  assert.equal(prevented, 1);
  assert.equal(messages[0][0].type, 'padel:toggle-search');
  assert.equal(messages[0][1], 'https://liga.example');
  handler({ ...event, repeat: true });
  handler({ ...event, key: 'f' });
  assert.equal(messages.length, 1);
});
