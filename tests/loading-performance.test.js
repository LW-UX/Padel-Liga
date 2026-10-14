const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const account = fs.readFileSync(path.join(root, 'js/account.js'), 'utf8');
const tipping = fs.readFileSync(path.join(root, 'js/tippspiel.js'), 'utf8');

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

test('season file and database start together and hydrate only after both finish', async () => {
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
  assert.deepEqual(result.articles, ['editorial']);
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
    const playerProfileCache = new Map(), playerProfileSeasonPayloadCache = new Map();
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

test('disabled tipping clears old data without issuing public or private queries', async () => {
  const state = { client: {}, season: { competition: { predictionsEnabled: false } },
    databaseMatches: new Map([['old', {}]]), predictions: new Map([['old', '2:0']]), leaderboard: [{}] };
  let renders = 0;
  const context = vm.createContext({ state, window: {}, render: () => renders++,
    loadPublicData: () => { throw Error('unexpected query'); },
    loadPredictions: () => { throw Error('unexpected query'); } });
  vm.runInContext(fn(tipping, 'refresh', '  '), context);
  await context.refresh();
  assert.equal(state.ready, true);
  assert.equal(state.databaseMatches.size, 0);
  assert.equal(state.predictions.size, 0);
  assert.equal(state.leaderboard.length, 0);
  assert.equal(renders, 1);
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
