const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const account = fs.readFileSync(path.join(root, 'js/account.js'), 'utf8');
const tipping = fs.readFileSync(path.join(root, 'js/tippspiel.js'), 'utf8');
const tippingPage = fs.readFileSync(path.join(root, 'js/tipp-page.js'), 'utf8');

function fn(source, name, indent = '') {
  const match = source.match(new RegExp(`${indent}(?:async )?function ${name}\\([^]*?\\n${indent}}`));
  assert.ok(match, name);
  return match[0];
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('season file and database start together and hydrate before Padeltipp forecasts', async () => {
  const script = deferred(), database = deferred(), calls = [];
  const context = vm.createContext({
    window: {},
    loadScript: () => { calls.push('script'); return script.promise; },
    loadDatabaseSeasonPayload: () => { calls.push('database'); return database.promise; },
    normalizeLegacySeason: value => value,
    hydrateSeasonData: value => { calls.push('hydrate'); return value; },
    mergeDatabaseResults: value => value
  });
  vm.runInContext(fn(app, 'loadSeasonData'), context);
  const request = context.loadSeasonData({ id: 'summer', file: 'summer.js' });
  assert.deepEqual(calls, ['script', 'database']);
  database.resolve({ participants: [], matches: [{ id: 'db' }] });
  await Promise.resolve();
  assert.equal(calls.includes('hydrate'), false);
  context.window.PADEL_SEASON = { participants: [], matches: [], articles: ['editorial'] };
  script.resolve();
  const result = await request;
  assert.equal(result.matches[0].id, 'db');
  assert.equal(result.matches[0].forecast, undefined);
  assert.deepEqual(result.articles, ['editorial']);
});

test('season-wide Padeltipp forecasts load only after account startup', () => {
  const initApp = app.match(/async function initApp\(\) \{[\s\S]*?(?=\n\}\n\nconst mobileViewportQuery)/)?.[0] || '';
  const seasonLoad = initApp.indexOf('await loadActiveSeason()');
  const accountLoad = initApp.indexOf('await window.PadelKonto?.init()');
  const forecastLoad = initApp.lastIndexOf('await loadActiveSeasonForecasts()');
  assert.ok(seasonLoad >= 0 && seasonLoad < accountLoad);
  assert.ok(accountLoad < forecastLoad);
});

test('sections render on demand and hidden sections stay invalid until opened', () => {
  const calls = [], context = vm.createContext({ calls });
  vm.runInContext(`
    let appReady = true, PADEL_DATA = {};
    const renderedSections = new Set();
    ${['Home','Ranking','Partien','Calculator','Statistik','Infos'].map(name => `function render${name}() { calls.push('${name}'); }`).join('\n')}
    ${fn(app, 'invalidateSections')}
    ${fn(app, 'ensureSectionRendered')}
  `, context);
  context.ensureSectionRendered('start');
  context.ensureSectionRendered('start');
  assert.deepEqual(calls, ['Home']);
  context.ensureSectionRendered('rangliste');
  context.invalidateSections();
  context.ensureSectionRendered('start');
  assert.deepEqual(calls, ['Home', 'Ranking', 'Home']);
  context.ensureSectionRendered('rangliste');
  assert.deepEqual(calls, ['Home', 'Ranking', 'Home', 'Ranking']);
});

test('profile cache coalesces requests, expires, invalidates, and retries failures', async () => {
  let now = 0, calls = 0, pending = deferred();
  const context = vm.createContext({
    Date: { now: () => now },
    loadPlayerProfile: () => { calls++; return pending.promise; }
  });
  vm.runInContext(`
    const PLAYER_PROFILE_CACHE_TTL = 30000;
    const playerProfileCache = new Map(), playerProfileSeasonPayloadCache = new Map(), playerProfileCompareElos = new Map();
    ${fn(app, 'fetchPlayerProfile')}
    ${fn(app, 'invalidatePlayerProfileCache')}
  `, context);
  const first = context.fetchPlayerProfile('a');
  assert.equal(first, context.fetchPlayerProfile('a'));
  pending.resolve({ identity: { id: 'a' } });
  await first;
  assert.equal(context.fetchPlayerProfile('a'), first);
  assert.equal(calls, 1);
  now = 30001;
  pending = deferred();
  const expired = context.fetchPlayerProfile('a');
  assert.equal(calls, 2);
  context.invalidatePlayerProfileCache();
  const afterInvalidation = context.fetchPlayerProfile('a');
  assert.notEqual(expired, afterInvalidation);
  pending.reject(new Error('offline'));
  await assert.rejects(expired, /offline/);
  await assert.rejects(afterInvalidation, /offline/);
  pending = deferred();
  const retry = context.fetchPlayerProfile('a');
  pending.resolve({ identity: { id: 'a' } });
  await retry;
  assert.equal(calls, 4);
});

test('chart library loads once on demand and allows a retry after a failed download', async () => {
  let calls = 0, pending = deferred();
  const context = vm.createContext({ window: {}, loadScript: () => { calls++; return pending.promise; } });
  vm.runInContext(`let chartLibraryPromise = null; ${fn(app, 'ensureChartLibrary')}`, context);
  const first = context.ensureChartLibrary();
  assert.equal(context.ensureChartLibrary(), first);
  pending.reject(new Error('offline'));
  await assert.rejects(first, /offline/);
  pending = deferred();
  const retry = context.ensureChartLibrary();
  context.window.Chart = function () {};
  pending.resolve();
  await retry;
  await context.ensureChartLibrary();
  assert.equal(calls, 2);
  for (const filename of ['index.html', 'tipp/index.html']) {
    const html = fs.readFileSync(path.join(root, filename), 'utf8');
    assert.doesNotMatch(html, /<script[^>]+src="[^"]*chart\.js/);
    assert.ok([...html.matchAll(/<script([^>]+)src=/g)].every(match => match[1].includes('defer')));
  }
});

test('closed tipping still loads existing rankings and personal tips', async () => {
  const state = { client: {}, season: { competition: { predictionsEnabled: false } },
    databaseMatches: new Map([['old', {}]]), predictions: new Map([['old', '2:0']]), leaderboard: [{}] };
  const calls = [];
  let renders = 0;
  const context = vm.createContext({ state, window: {}, render: () => renders++,
    loadPublicData: async () => { calls.push('public'); state.leaderboard = [{ user_id: 'one' }]; },
    loadPredictions: async () => { calls.push('private'); state.predictions = new Map([['past', '2:0']]); } });
  vm.runInContext(fn(tipping, 'refresh', '  '), context);
  await context.refresh();
  assert.equal(state.ready, true);
  assert.deepEqual(calls, ['public', 'private']);
  assert.equal(state.predictions.get('past'), '2:0');
  assert.equal(state.leaderboard.length, 1);
  assert.equal(renders, 1);
});

test('a closed season keeps historical matches visible without reopening submissions', () => {
  const match = { id: 'past', sieger: null, team1: { playerIds: ['a', 'b'] }, team2: { playerIds: ['c', 'd'] } };
  const state = {
    season: { competition: { predictionsEnabled: false }, matches: [match] },
    databaseMatches: new Map([['past', { betting_open: true, actual_sets: null, cancelled_at: null, match_at: null }]])
  };
  const context = vm.createContext({ state, window: { PadelPreviewWindow: { availability: () => 'preview' } } });
  vm.runInContext([
    fn(tipping, 'getPredictionLocalMatches', '  '),
    fn(tipping, 'getActualSets', '  '),
    fn(tipping, 'isCancelledMatch', '  '),
    fn(tipping, 'isOwnMatch', '  '),
    fn(tipping, 'getPreviewWindowMatch', '  '),
    fn(tipping, 'isOutsidePreviewWindow', '  '),
    fn(tipping, 'isPredictionOpen', '  ')
  ].join('\n'), context);
  assert.equal(context.getPredictionLocalMatches().length, 1);
  assert.equal(context.isPredictionOpen(match), false);
  state.season.competition.predictionsEnabled = true;
  assert.equal(context.isPredictionOpen(match), true);
});

test('Padeltipp starts season, module and account together without blocking on account startup', async () => {
  const calls = [];
  const accountReady = deferred(), seasonReady = deferred(), moduleReady = deferred();
  const season = { id: '2026-sommer', label: 'Sommer 2026' };
  const window = {
    PADEL_SEASON: null,
    PadelKonto: { init() { calls.push('account'); return accountReady.promise; } }
  };
  const context = vm.createContext({
    window,
    document: {
      querySelectorAll() { return []; },
      querySelector() { return { innerHTML: '' }; }
    },
    console,
    normalizeLegacySeasonUrl() {},
    getSelectedSeason: () => ({ file: 'data/season.js' }),
    renderSeasonPicker() {},
    bindNavigation() {},
    hydrateSeason: value => value,
    async loadScript(pathname) {
      if (pathname.includes('data/season.js')) {
        calls.push('season');
        await seasonReady.promise;
        window.PADEL_SEASON = season;
      } else {
        calls.push('tippspiel-module');
        await moduleReady.promise;
        window.PadelTippspiel = { async init(value, options) {
          assert.equal(options.accountReady, accountReady.promise);
          calls.push(`tippspiel:${value.id}`);
        } };
      }
    }
  });
  vm.runInContext(fn(tippingPage, 'init', '  '), context);
  const request = context.init();
  assert.deepEqual(calls, ['account', 'season', 'tippspiel-module']);
  moduleReady.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 3);
  seasonReady.resolve();
  await request;
  assert.deepEqual(calls, ['account', 'season', 'tippspiel-module', 'tippspiel:2026-sommer']);
  accountReady.resolve();
});

test('public Padeltipp rankings render while account, matches and Elo are still loading', async () => {
  const accountReady = deferred(), matches = deferred(), participants = deferred(), leaderboard = deferred();
  const calls = [], events = new Map();
  const nodes = new Map(['prediction-ranking-body', 'prediction-ranking-empty', 'prediction-matches']
    .map(id => [id, { innerHTML: '', textContent: '' }]));
  let session = null;
  const client = {
    from(table) {
      calls.push(table);
      return { select() {
        if (table === 'matches') return { in() { return matches.promise; } };
        return Promise.resolve({ data: [{ match_id: 'one', prediction: '2:0' }] });
      } };
    },
    rpc(name) {
      calls.push(name);
      return name === 'get_public_season' ? participants.promise : leaderboard.promise;
    }
  };
  const window = {
    PadelKonto: {
      init: () => accountReady.promise,
      getClient: () => client,
      getSession: () => session
    },
    addEventListener(name, handler) { events.set(name, handler); }
  };
  const context = vm.createContext({
    window, console,
    document: {
      getElementById: id => nodes.get(id),
      addEventListener() {}
    }
  });
  vm.runInContext(tipping, context);
  const request = window.PadelTippspiel.init({ id: '2026-winter', matches: [] });
  assert.deepEqual(calls, ['get_public_season', 'matches', 'get_prediction_leaderboard', 'get_prediction_match_floors']);
  assert.equal(events.has('padel:auth-state-changed'), false);
  leaderboard.resolve({ data: [{ user_id: 'viewer', display_name: 'Tipper', points: 4 }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(nodes.get('prediction-ranking-body').innerHTML, /Tipper/);
  assert.equal(nodes.get('prediction-ranking-empty').textContent, '');
  assert.match(nodes.get('prediction-matches').innerHTML, /werden geladen/);
  assert.equal(calls.includes('predictions'), false);

  session = { user: { id: 'viewer' } };
  accountReady.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.filter(name => name === 'predictions').length, 1);
  assert.equal(calls.filter(name => name === 'get_prediction_leaderboard').length, 1);
  assert.equal(events.has('padel:auth-state-changed'), true);
  matches.resolve({ data: [] });
  participants.resolve({ data: { participants: [] } });
  await request;
  assert.match(nodes.get('prediction-ranking-body').innerHTML, /authenticated-player-highlight/);
});

test('Padeltipp legacy rankings fall back independently and recover from a request failure', async () => {
  const calls = [], state = { leaderboard: [] };
  let failure = false;
  state.client = { async rpc(name, { p_season_id }) {
    calls.push(p_season_id);
    if (failure) return { error: { message: 'offline' } };
    return { data: p_season_id === '2026' ? [{ user_id: 'legacy' }] : [] };
  } };
  let renders = 0;
  const context = vm.createContext({ state, renderLeaderboard: () => renders++ });
  vm.runInContext(fn(tipping, 'loadLeaderboard', '  '), context);
  await context.loadLeaderboard('2026-sommer', '2026');
  assert.deepEqual(calls, ['2026-sommer', '2026']);
  assert.equal(state.leaderboard[0].user_id, 'legacy');
  assert.equal(state.leaderboardReady, true);
  failure = true;
  await assert.rejects(context.loadLeaderboard('2026-sommer', '2026'), { message: 'offline' });
  assert.equal(state.leaderboardError, 'offline');
  failure = false;
  await context.loadLeaderboard('2026-sommer', '2026');
  assert.equal(state.leaderboardError, null);
  assert.equal(renders, 3);
});

test('personal Padeltipp responses cannot restore tips after logout', async () => {
  const pending = deferred();
  let session = { user: { id: 'viewer' } };
  const state = {
    session, predictions: new Map(),
    client: { from: () => ({ select: () => pending.promise }) }
  };
  const context = vm.createContext({ state, window: { PadelKonto: { getSession: () => session } } });
  vm.runInContext(fn(tipping, 'loadPredictions', '  '), context);
  const request = context.loadPredictions();
  session = null;
  pending.resolve({ data: [{ match_id: 'one', prediction: '2:0' }] });
  await request;
  assert.equal(state.predictions.size, 0);
});

test('the Padeltipp page reuses the legacy season match prefix', () => {
  const window = {
    PADEL_PLAYERS: [
      { id: 'a', name: 'A' }, { id: 'b', name: 'B' },
      { id: 'c', name: 'C' }, { id: 'd', name: 'D' }
    ]
  };
  const context = vm.createContext({ window });
  vm.runInContext(fn(tippingPage, 'hydrateSeason', '  '), context);
  const season = context.hydrateSeason({
    id: '2026-sommer',
    matchIdPrefix: 'season-2026',
    players: window.PADEL_PLAYERS,
    matches: [{
      id: 'partie1', spieltag: 1, datum: null, uhrzeit: null, ergebnis: null, saetze: null, sieger: null,
      team1: { spieler: ['A', 'B'] }, team2: { spieler: ['C', 'D'] }
    }]
  });
  assert.equal(season.matches[0].id, 'season-2026-partie-1');
  assert.deepEqual(JSON.parse(JSON.stringify(season.matches[0].team1.playerIds)), ['a', 'b']);
});

test('account startup publishes identity without waiting for private game tasks', async () => {
  const events = [];
  const context = vm.createContext({ state: { client: {} }, document: { getElementById: () => ({ open: false }) },
    loadProfile: async () => events.push('profile'), publishAuthState: () => events.push('identity'),
    refreshPlayerTools: async () => events.push('tasks'), schedulePlayerTools: () => events.push('background'), render() {}, console });
  vm.runInContext(fn(account, 'refresh', '  '), context);
  await context.refresh();
  assert.deepEqual(events, ['profile', 'identity', 'background']);
  events.length = 0;
  await context.refresh({ includeTasks: true });
  assert.deepEqual(events, ['profile', 'identity', 'tasks']);
});

test('opening account prioritizes the same pending task load and a later refresh fetches again', async () => {
  let calls = 0, pending = deferred();
  const state = { extendedPlayerFeatures: true, playerToolsVersion: 0, playerToolsReady: false };
  const context = vm.createContext({ state, window: { clearTimeout() {} }, console,
    isPlayerAccount: () => true, renderResultTasks() {}, render() {},
    loadPlayerTools: () => { calls++; return pending.promise; } });
  vm.runInContext(`let playerToolsPromise = null, playerToolsTimer = 1; ${fn(account, 'refreshPlayerTools', '  ')}`, context);
  const first = context.refreshPlayerTools();
  assert.equal(context.refreshPlayerTools({ force: true }), first);
  pending.resolve();
  await first;
  assert.equal(state.playerToolsReady, true);
  await context.refreshPlayerTools();
  assert.equal(calls, 1);
  pending = deferred();
  const refreshed = context.refreshPlayerTools({ force: true });
  pending.resolve();
  await refreshed;
  assert.equal(calls, 2);
});

test('an old account response cannot fill the next account game overview', async () => {
  const response = deferred();
  const state = { extendedPlayerFeatures: true, playerToolsVersion: 0,
    client: { from: () => ({ select: () => ({ order: () => response.promise }) }),
      rpc: async () => ({ data: [] }) } };
  const context = vm.createContext({ state, isPlayerAccount: () => true, renderTrainingForm() {} });
  vm.runInContext(fn(account, 'loadPlayerTools', '  '), context);
  const request = context.loadPlayerTools();
  state.playerToolsVersion++;
  response.resolve({ data: [{ id: 'previous-account-player' }] });
  await request;
  assert.equal(state.players.length, 0);
  assert.equal(state.resultTasks.length, 0);
});

test('a profile response from before logout cannot restore the previous account identity', async () => {
  const response = deferred();
  const state = { session: { user: { id: 'previous-user' } }, client: {
    from: () => ({ select: () => ({ eq: () => ({ single: () => response.promise }) }) })
  } };
  let published = 0;
  const context = vm.createContext({ state, publishAuthenticatedPlayer: () => published++ });
  vm.runInContext(fn(account, 'loadProfile', '  '), context);
  const request = context.loadProfile();
  state.session = null;
  response.resolve({ data: { id: 'previous-user', app_role: 'player' } });
  await request;
  assert.equal(state.profile, null);
  assert.equal(published, 0);
});

test('profile season enrichment reuses the loaded season for legacy and current IDs', async () => {
  let calls = 0;
  const current = { id: '2026-sommer' };
  const context = vm.createContext({ PADEL_DATA: current, PLAYER_PROFILE_CACHE_TTL: 30000,
    playerProfileSeasonPayloadCache: new Map(),
    normalizeSeasonId: id => ({ '2026': '2026-sommer', 'winter-2026': '2026-winter' })[id] || id,
    loadDatabaseSeasonPayload: async () => { calls++; return { id: '2026-winter' }; } });
  vm.runInContext(fn(app, 'getPlayerProfileSeasonPayload'), context);
  assert.equal(await context.getPlayerProfileSeasonPayload('2026'), current);
  assert.equal(await context.getPlayerProfileSeasonPayload('2026-sommer'), current);
  assert.equal(calls, 0);
  const legacy = context.getPlayerProfileSeasonPayload('winter-2026');
  assert.equal(context.getPlayerProfileSeasonPayload('2026-winter'), legacy);
  await legacy;
  assert.equal(calls, 1);
});
