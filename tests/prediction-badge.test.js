const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { countOpenPredictions } = require('../js/prediction-badge');
const preview = require('../js/preview-window');
const now = Date.parse('2026-11-19T10:00:00Z');
const match = (id, extra = {}) => ({ id, type: 'season', stage: 'league', spieltag: 1,
  countsForElo: true, sieger: null, team1: { playerIds: ['a', 'b'] }, team2: { playerIds: ['c', 'd'] }, ...extra });
function input() {
  return { season: { matches: [match('open')], matchdays: [{ spieltag: 1, startDate: '2026-11-16', endDate: '2026-11-29' }] },
    matches: [{ id: 'open', betting_open: true, actual_sets: null, match_at: null }],
    predictionIds: new Set(), bonusQuestions: [], playerId: 'outsider', now, availability: preview.availability };
}

test('badge counts available, unanswered foreign matches and incomplete open bonus questions', () => {
  const data = input();
  data.bonusQuestions = [
    { is_open: true, lock_at: '2026-12-01', answers: [], max_selections: 1 },
    { is_open: true, lock_at: '2026-12-01', answers: ['a'], max_selections: 4 },
    { is_open: true, lock_at: '2026-12-01', answers: ['a'], max_selections: 1 },
    { is_open: true, lock_at: '2026-11-01', answers: [] },
    { is_open: false, lock_at: '2026-12-01', answers: [] }
  ];
  assert.equal(countOpenPredictions(data), 3);
  data.predictionIds.add('open');
  assert.equal(countOpenPredictions(data), 2);
});

test('badge excludes own, locked, cancelled, completed, empty and future-window matches', () => {
  for (const change of [
    data => { data.playerId = 'a'; },
    data => { data.matches[0].betting_open = false; },
    data => { data.matches[0].cancelled_at = '2026-11-18'; },
    data => { data.matches[0].actual_sets = '2:0'; },
    data => { data.season.matches[0].sieger = 1; },
    data => { data.season.matches[0].team1.playerIds = []; },
    data => { data.matches[0].match_at = new Date(now).toISOString(); },
    data => { data.season.matches[0].spieltag = 5; },
    data => { data.season.completedAt = '2026-11-18'; },
    data => { data.season.competition = { predictionsEnabled: false }; }
  ]) {
    const data = input(); change(data);
    assert.equal(countOpenPredictions(data), 0);
  }
  const scheduled = input();
  scheduled.season.matches[0].spieltag = 5;
  scheduled.matches[0].match_at = '2026-12-01T10:00:00Z';
  assert.equal(countOpenPredictions(scheduled), 1);
});

test('badge uses all season matches across league filters and removes counts on logout', async () => {
  const data = input();
  data.season.allMatches = data.season.matches;
  data.season.matches = [];
  assert.equal(countOpenPredictions(data), 1);
  const listeners = new Map();
  const badge = { hidden: true, textContent: '' };
  const link = { querySelector: () => badge, setAttribute() {} };
  let session = { user: { id: 'first' } };
  let resolveBonus;
  const context = vm.createContext({
    window: {
      PadelKonto: { getSession: () => session, getProfile: () => ({ player_id: 'outsider' }), getClient: () => ({
        from: table => { const request = { select: () => request, eq: () => request,
          then: resolve => Promise.resolve({ data: table === 'matches' ? data.matches : [] }).then(resolve) }; return request; },
        rpc: () => new Promise(resolve => { resolveBonus = resolve; })
      }) },
      PadelPreviewWindow: { availability: preview.availability },
      addEventListener: (event, handler) => listeners.set(event, handler)
    },
    document: { getElementById: () => link, addEventListener() {} },
    Date: class extends Date { static now() { return now; } }, setInterval() {}, console
  });
  vm.runInContext(fs.readFileSync(require.resolve('../js/prediction-badge'), 'utf8'), context);
  context.window.PadelPredictionBadge.setSeason(data.season, 'winter-2026');
  await new Promise(resolve => setImmediate(resolve));
  resolveBonus({ data: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, '1');
  listeners.get('focus')();
  session = null;
  listeners.get('padel:auth-state-changed')();
  resolveBonus({ data: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(badge.hidden, true);
  assert.equal(badge.textContent, '');
});
