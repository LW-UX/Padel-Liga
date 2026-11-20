const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const search = require('../js/site-search-core');

const { window: { PADEL_PLAYERS: players } } = vm.runInNewContext(
  fs.readFileSync(require.resolve('../data/players.js'), 'utf8') + '\n;({window})',
  { window: {} }
);

test('achievement keywords find awarded players, while champion keywords require a winner badge', () => {
  for (const term of ['Auszeichnung', 'Emblem', 'Medaille', 'Lorbeeren']) {
    assert.equal(search.parseQuery(term).achievementMode, 'all');
  }
  for (const term of ['Gewinner', 'Sieger', 'Champion']) {
    assert.equal(search.parseQuery(term).achievementMode, 'champion');
  }
  assert.equal(search.parseQuery('Champion Sommer 2026').achievementMode, undefined);

  const rows = [
    { player_id: 'a', season_id: '2026-sommer', kind: 'winner' },
    { player_id: 'a', season_id: '2027-cup', kind: 'winner' },
    { player_id: 'b', season_id: '2026-sommer', kind: 'final_four' },
    { player_id: 'c', season_id: null, kind: 'custom', title: 'Champion' },
    { player_id: 'd', season_id: '2026-test', kind: 'winner' },
    { player_id: 'test_net', season_id: '2026-sommer', kind: 'winner' }
  ];
  const playerIds = new Set(['a', 'b', 'c', 'd']);
  const seasonIds = new Set(['2026-sommer', '2027-cup']);
  assert.deepEqual([...search.groupPlayerAchievements(rows, 'all', playerIds, seasonIds).keys()], ['a', 'b', 'c']);
  const winners = search.groupPlayerAchievements(rows, 'champion', playerIds, seasonIds);
  assert.deepEqual([...winners.keys()], ['a']);
  assert.equal(winners.get('a').length, 2);
});

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

test('visitors and all account roles can open search and reveal filters by mouse or keyboard, with filters always available on touch', () => {
  const listeners = new Map();
  const on = target => (name, handler) => listeners.set(`${target}:${name}`, handler);
  const button = {
    hidden: false, disabled: false, loading: false, querySelector: () => ({}), setAttribute() {},
    removeAttribute() { this.loading = false; }, addEventListener: on('button')
  };
  const input = { value: '', focus() {}, select() {}, setAttribute() {}, addEventListener: on('input') };
  const searchField = { contains: target => target === input };
  const content = { replaceChildren() {}, contains: () => false, addEventListener() {} };
  const mobileClose = { addEventListener: on('mobile-close') };
  const mobile = { matches: false };
  let speedDialFocused = false;
  const speedDial = { matches: () => false, focus: () => { speedDialFocused = true; } };
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
      if (selector === '.site-search-close') return mobileClose;
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
    querySelector: selector => ({
      '[data-site-search-open]': button, '[data-global-actions-toggle]': speedDial, 'dialog:modal': otherModal
    })[selector] ?? null,
    getElementById: id => id === 'external-game-link' ? { after() {} } : null,
    createElement: () => dialog
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/site-search.js'), 'utf8'), {
    window, document, navigator: {},
    matchMedia: query => query.includes('any-pointer') ? stackedFilters : query === '(max-width: 768px)' ? mobile : { matches: false },
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
  assert.equal(button.loading, false);
  assert.equal(button.disabled, false);
  assert.equal(button.hidden, false);
  assert.equal(listeners.has('window:padel:account-initialized'), false);
  assert.equal(shortcut(), true);
  assert.equal(dialog.open, true);
  assert.equal(shortcut(), true);
  assert.equal(dialog.open, false);

  for (const role of ['tipper', 'player', 'admin']) {
    session = { user: { id: 'current', email_confirmed_at: 'confirmed' } };
    profile = { id: 'current', app_role: role };
    listeners.get('button:click')();
    assert.equal(dialog.open, true, role);
    assert.equal(shortcut(), true);
    assert.equal(dialog.open, false, role);
  }

  otherModal = { open: true };
  assert.equal(shortcut(), true);
  assert.equal(dialog.open, true);
  assert.equal(output.dataset.expanded, 'false');
  assert.equal(filterTray.inert, true);
  listeners.get('dialog:pointermove')({ pointerType: 'mouse', target: content });
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
  assert.equal(filterTray.inert, false);
  assert.equal(input.placeholder, 'Artikel durchsuchen');
  listeners.get('dialog:pointermove')({ pointerType: 'mouse', target: content });
  assert.equal(filterTray.inert, false);
  input.value = 'PadelPost neu';
  listeners.get('input:input')();
  runSearch();
  assert.equal(filterTray.inert, true);
  listeners.get('dialog:pointermove')({ pointerType: 'mouse', target: content });
  assert.equal(filterTray.inert, true);
  listeners.get('dialog:pointermove')({ pointerType: 'mouse', target: input });
  assert.equal(filterTray.inert, false);

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
  assert.equal(dialog.open, false);
  assert.equal(output.dataset.expanded, 'false');
  assert.equal(output.inert, true);
  listeners.get('button:click')();
  assert.equal(dialog.open, true);
  let escapePrevented = false;
  listeners.get('dialog:keydown')({
    key: 'Escape', preventDefault() { escapePrevented = true; }, stopPropagation() {}
  });
  assert.equal(escapePrevented, true);
  assert.equal(dialog.open, false);
  mobile.matches = true;
  listeners.get('button:click')();
  assert.equal(dialog.open, true);
  assert.equal(output.dataset.expanded, 'true');
  listeners.get('mobile-close:click')();
  assert.equal(dialog.open, false);
  assert.equal(speedDialFocused, true);
  listeners.get('button:click')();

  session = null;
  listeners.get('window:padel:auth-state-changed')?.();
  assert.equal(button.hidden, false);
  assert.equal(dialog.open, true);
  assert.equal(shortcut(), true);
  assert.equal(dialog.open, false);
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

test('player search uses weighted career matches and wins, with neutral missing values', () => {
  assert.deepEqual(search.playerSummaryStats({ currentElo: 1284, matches: 12.5, wins: 8 }), {
    elo: '1.284', matches: '12,5', winRate: '64 %'
  });
  assert.deepEqual(search.playerSummaryStats({ currentElo: 1000, matches: 0, wins: 0 }), {
    elo: '1.000', matches: '0', winRate: '—'
  });
  assert.deepEqual(search.playerSummaryStats({ currentElo: null }), {
    elo: '—', matches: '—', winRate: '—'
  });
});

test('player search shares pending profile requests and reloads after cache invalidation', async () => {
  const source = fs.readFileSync(require.resolve('../js/site-search.js'), 'utf8');
  const loader = source.match(/  function loadSearchPlayerProfile\(playerId\) \{[\s\S]*?\n  \}/)[0];
  let calls = 0;
  const cache = { profiles: new Map() };
  const context = vm.createContext({ cache, maxAge: 60000, getClient: () => ({
    rpc: async (name, params) => {
      calls++;
      assert.equal(name, 'get_player_profile');
      assert.equal(params.p_player_id, 'ludwig_w');
      return { data: { summary: { currentElo: 1284, matches: 12.5, wins: 8 } } };
    }
  }) });
  vm.runInContext(loader, context);
  const first = context.loadSearchPlayerProfile('ludwig_w');
  assert.equal(context.loadSearchPlayerProfile('ludwig_w'), first);
  await first;
  assert.equal(calls, 1);
  cache.profiles.clear();
  await context.loadSearchPlayerProfile('ludwig_w');
  assert.equal(calls, 2);
});

test('table searches include normal and all-time rankings with a direct all-time destination', () => {
  const source = fs.readFileSync(require.resolve('../js/site-search.js'), 'utf8');
  const pageLinks = source.match(/  function pageLinks\(active, players\) \{[\s\S]*?\n  \}/)[0];
  const infoData = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../data/info.js'), 'utf8'), { window: infoData });
  const league = { id: 'winter', label: 'Winter 2026', default: true };
  const cup = { id: 'cup', visualTheme: 'cup' };
  const summer = { id: 'summer', label: 'Sommer 2026', completedAt: '2026-10-01' };
  const previous = { id: 'previous', label: 'Winter 2025', completedAt: '2026-03-01' };
  const future = { id: 'future', label: 'Sommer 2027' };
  const hidden = { id: 'test', hidden: true, completedAt: '2026-10-02' };
  const context = vm.createContext({
    window: infoData, core: search, cache: { matches: new Map() }, seasons: () => [previous, league, cup, future, hidden, summer],
    titleLink: (title, url, description = '') => ({ title, url, description }),
    pickerLink: () => ({ title: 'Spieler suchen' }),
    routing: {
      getSeasonUrl: (id, kind) => new URL(`https://liga.test/${kind}/${id}/`),
      getSectionUrl: (id, section) => new URL(`https://liga.test/${id}/${section}/`)
    }
  });
  vm.runInContext(pageLinks, context);
  const links = context.pageLinks(league, []);
  const find = query => links.filter(item => [item.title, ...(item.aliases || [])]
    .some(term => search.normalize(term).includes(search.normalize(query)))).map(item => item.title);
  for (const query of ['Tabelle', 'Rangliste']) {
    assert.deepEqual(Array.from(find(query)), ['Rangliste', 'Ewige Rangliste', 'Tipprangliste', 'Rangliste', 'Rangliste']);
  }
  assert.equal(links.find(item => item.title === 'Rangliste' && item.description === 'Sommer 2026').url.href,
    'https://liga.test/summer/rangliste/');
  assert.equal(links.find(item => item.title === 'Rangliste').description, 'Winter 2026');
  assert.equal(links.find(item => item.title === 'Rangliste').descriptionCurrent, true);
  assert.equal(links.find(item => item.title === 'Ewige Rangliste').description, 'Statistik');
  assert.equal(links.find(item => item.description === 'Sommer 2026').descriptionCurrent, undefined);
  assert.deepEqual(Array.from(find('Ewige Tabelle')), ['Ewige Rangliste']);
  assert.deepEqual(Array.from(find('ewig')), ['Ewige Rangliste']);
  assert.deepEqual(Array.from(find('Ligatabelle')), ['Rangliste', 'Rangliste', 'Rangliste']);
  for (const query of ['Tipprangliste', 'Tipp Rangliste', 'Tipp-Rangliste', 'tipp tabelle', 'tipptabelle']) {
    assert.deepEqual(Array.from(find(query)), ['Tipprangliste']);
  }
  assert.equal(links.find(item => item.title === 'Tipprangliste').url.href,
    'https://liga.test/tipp/winter/#tippuebersicht');
  assert.equal(links.find(item => item.title === 'Tippübersicht').url.href,
    'https://liga.test/tipp/winter/#tipptabelle');
  for (const section of infoData.PADEL_INFO.sections) {
    for (const group of section.groups || []) {
      const target = links.find(item => item.title === group.title);
      assert.ok(target, group.title);
      assert.equal(target.url.hash, `#${search.infoGroupAnchor(section.title, group.title)}`);
    }
  }
  assert.deepEqual(Array.from(find('stornieren')), ['Stornierung']);
  assert.deepEqual(Array.from(find('Termin abstimmen')), ['Termin abstimmen']);
  for (const term of ['Tie-Break', 'Tie Break', 'Tiebreak']) assert.ok(find(term).includes('Tie-Break'), term);
  for (const term of ['Turnierbaum', 'Modus']) assert.deepEqual(Array.from(find(term)), ['Turnierbaum']);
  assert.equal(links.find(item => item.title === 'Turnierbaum').url.hash, '#turniermodus');
  assert.equal(links.find(item => item.title === 'Turnierbaum').inlineDiagram, true);
  assert.equal(context.pageLinks(cup, []).filter(item => item.title === 'Turnierbaum').length, 1);
  for (const [queries, title, anchor] of [
    [['Regeln', 'Spielregeln'], 'Spielregeln', 'spielregeln'],
    [['Kurzinfo'], 'Kurzinfo', 'kurzinfo'],
    [['Zählweise', 'Zaehlweise'], 'Zählweise', 'zaehlweise'],
    [['Ergebnis', 'Ergebnismeldung'], 'Ergebnismeldung', 'ergebnismeldung'],
    [['Punkte', 'Punktevergabe'], 'Punktevergabe', 'punktevergabe'],
    [['PadelPost', 'Archiv'], 'PadelPost', 'artikel']
  ]) {
    for (const query of queries) assert.deepEqual(Array.from(find(query)), [title], query);
    assert.equal(links.find(item => item.title === title).url.href, `https://liga.test/winter/infos/#${anchor}`);
  }
  for (const query of ['Früher Vogel', 'Fruher Vogel', 'Frueher Vogel']) {
    assert.deepEqual(Array.from(find(query)), ['Früher Vogel']);
  }
  for (const query of ['Langschläfer', 'Langschlafer', 'Langschlaefer']) {
    assert.deepEqual(Array.from(find(query)), ['Langschläfer']);
  }
  assert.equal(links.find(item => item.title === 'Früher Vogel').url.href,
    'https://liga.test/winter/verlauf/#stats-time-performance');
  assert.equal(links.find(item => item.title === 'Langschläfer').url.href,
    'https://liga.test/winter/verlauf/#stats-time-performance');
  assert.equal(links.find(item => item.title === 'Ewige Rangliste').url.href,
    'https://liga.test/winter/verlauf/#ewige-rangliste');
  assert.equal(context.pageLinks(cup, []).find(item => item.title === 'Ewige Rangliste').url.href,
    'https://liga.test/winter/verlauf/#ewige-rangliste');
});

test('all search loads article full text after other sources and ignores superseded queries', async () => {
  const source = fs.readFileSync(require.resolve('../js/site-search.js'), 'utf8');
  const loading = source.slice(source.indexOf('  function loadResults('), source.indexOf('  function titleLink('));
  let finishMatches;
  const calls = [];
  const context = {
    filter: 'all', query: { kind: 'text', query: 'endspurt' }, articlesReady: false,
    cache: {}, currentSeason: () => ({ id: 'winter' }), seasons: () => [{ id: 'winter' }],
    relevantKinds: () => ['matches', 'trainings', 'articles'], searchesAchievements: () => false,
    sharedSources: { trainings: [{ id: 'confirmed' }] }, dialog: { open: true }, timer: null,
    load: kind => { calls.push(kind); return kind === 'matches' ? new Promise(resolve => { finishMatches = resolve; }) : Promise.resolve(); },
    render() {}
  };
  vm.createContext(context);
  vm.runInContext(`${loading}\nloadResults();`, context);
  assert.deepEqual(calls, ['matches', 'trainings']);
  assert.equal(context.articlesReady, false);
  finishMatches();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['matches', 'trainings', 'articles']);
  assert.equal(context.articlesReady, true);

  calls.length = 0;
  vm.runInContext('loadResults();', context);
  context.query = { kind: 'text', query: 'andere suche' };
  finishMatches();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['matches', 'trainings']);

  const articles = source.slice(source.indexOf('  function getArticleLinks('), source.indexOf('  const trainingDateLabel'));
  Object.assign(context, {
    core: search, query: search.parseQuery('Endspurt'), articlesReady: true,
    cache: { articles: new Map([['winter', { data: [{ title: 'Die Liga ruft', spieltag: 1, body: [{ text: 'Endspurt' }] }] }]]) },
    routing: { getSectionUrl: () => new URL('https://example.test/infos/') },
    titleLink: (title, url) => ({ title, url })
  });
  vm.runInContext(articles, context);
  const hits = vm.runInContext("getArticleLinks([{ id: 'winter' }])", context);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].title, 'Die Liga ruft');
});

test('search help appears only after a successful search with no results', () => {
  const source = fs.readFileSync(require.resolve('../js/site-search.js'), 'utf8');
  const renderer = source.slice(source.indexOf('  function setOutputVisible('), source.indexOf('  function schedule('));
  const results = { innerHTML: '', contains: () => false, replaceChildren() { this.innerHTML = ''; } };
  const status = {};
  const output = { dataset: {} };
  const entry = {};
  const context = vm.createContext({
    document: {}, results, status, output, retry: {}, articlesReady: false,
    query: { kind: 'text' }, relevantKinds: () => ['articles'], sharedSources: {},
    seasons: () => [{ id: 'winter' }], cache: { articles: new Map([['winter', entry]]) },
    getGroups: () => ({ groups: [['articles', 'Artikel', []]] }), renderGroup() {}
  });
  vm.runInContext(renderer, context);
  context.render();
  assert.equal(status.textContent, 'Suche läuft …');
  assert.equal(results.innerHTML, '');

  context.articlesReady = true;
  context.render();
  assert.equal(status.textContent, 'Keine Treffer gefunden');
  assert.match(results.innerHTML, /Mit „Alles“ kannst du nach allen Beispielen suchen/);
  assert.match(results.innerHTML, /<dt>Artikel und Zitate<\/dt>[\s\S]*Zitat \+ Luca W\./);

  entry.error = true;
  context.render();
  assert.match(status.textContent, /nicht verfügbar/);
  assert.equal(results.innerHTML, '');

  entry.error = false;
  context.getGroups = () => ({ groups: [['articles', 'Artikel', [{ title: 'Ein Artikel' }]]] });
  context.render();
  assert.equal(status.textContent, '');
  assert.equal(results.innerHTML, '');
});

test('quote search shows full quotes and filters by author in either order, including aliases', () => {
  const article = { title: 'Spieltag', body: [
    { type: 'quote', text: 'Luca ist heute mein Gegner.', author: 'Marco M' },
    { type: 'quote', text: 'Ein langes Zitat im vollständigen Wortlaut.', author: 'Luca W' },
    { type: 'p', text: 'Ein Zitat von Luca im Fließtext.' }
  ] };
  assert.equal(search.articleQuotes(article, search.parseQuery('Zitat'), players).length, 2);
  for (const text of ['Zitat Luca W.', 'Luca W. Zitat', 'Zitat + Luca W.', 'Luca W. + Zitat', 'Zitate LW']) {
    const hits = search.articleQuotes(article, search.parseQuery(text), players);
    assert.equal(hits.length, 1, text);
    assert.equal(hits[0].author, 'Luca W', text);
    assert.equal(hits[0].text, article.body[1].text);
  }
  assert.equal(search.articleQuotes(article, search.parseQuery('Zitat Unbekannt'), players).length, 0);
  assert.equal(search.articleQuotes(article, search.parseQuery('Luca'), players).length, 0);
});

test('mode search displays the shared qualification graphic inside the result', () => {
  const source = fs.readFileSync(require.resolve('../js/site-search.js'), 'utf8');
  const renderer = source.slice(source.indexOf('  function renderGroup('), source.indexOf('  function loadSearchPlayerProfile('));
  const createElement = tag => ({ tag, children: [], append(...children) { this.children.push(...children); } });
  const results = createElement('div');
  const context = vm.createContext({
    document: { createElement }, results, core: search, limits: new Map(), pageSize: 16
  });
  vm.runInContext(renderer, context);
  context.renderGroup('pages', 'Seiten', [{ title: 'Turnierbaum', url: 'https://liga.test/infos/#turniermodus', inlineDiagram: true }]);
  const result = results.children[1];
  const diagram = result.children.find(child => child.className === 'site-search-inline-diagram');
  assert.ok(diagram, 'the search result must contain the graphic before opening a link');
  assert.match(diagram.innerHTML, /Ligaphase/);
  assert.match(diagram.innerHTML, /Halbfinale/);
  assert.match(diagram.innerHTML, /Final Four/);
  assert.doesNotMatch(diagram.innerHTML, /id="turniermodus"/);
  assert.equal(diagram.innerHTML, search.renderQualificationFlow());
});

test('anonymous training search skips private scheduled trainings and keeps confirmed trainings public', async () => {
  const source = fs.readFileSync(require.resolve('../js/site-search.js'), 'utf8');
  const loader = source.match(/  async function loadTrainings\(source\) \{[\s\S]*?\n  \}/)[0];
  let session = null;
  let response = { data: [] };
  const calls = [];
  const context = vm.createContext({
    window: { PadelKonto: { getSession: () => session }, PADEL_PLAYERS: [] }, core: search,
    getClient: () => ({ rpc: name => {
      calls.push(name);
      const request = { select: () => request, eq: () => request, then: resolve => Promise.resolve(response).then(resolve) };
      return request;
    } })
  });
  vm.runInContext(loader, context);
  assert.equal((await context.loadTrainings({ id: 'scheduled' })).length, 0);
  assert.deepEqual(calls, []);
  await context.loadTrainings({ id: 'confirmed' });
  assert.deepEqual(calls, ['get_training_sessions']);
  session = { user: { id: 'player' } };
  await context.loadTrainings({ id: 'scheduled' });
  assert.equal(calls.at(-1), 'get_my_training_tasks');
  response = { error: { code: '42501', message: 'Permission denied' } };
  assert.equal((await context.loadTrainings({ id: 'scheduled' })).length, 0);
  await assert.rejects(context.loadTrainings({ id: 'confirmed' }), error => error.code === '42501');
  response = { error: { code: 'NETWORK_ERROR' } };
  await assert.rejects(context.loadTrainings({ id: 'scheduled' }), error => error.code === 'NETWORK_ERROR');
});
