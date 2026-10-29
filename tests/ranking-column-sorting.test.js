const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const tipping = fs.readFileSync(path.join(root, 'js', 'tippspiel.js'), 'utf8');

function appFunction(name, nextName) {
  const match = app.match(new RegExp(`function ${name}\\([^]*?(?=\\nfunction ${nextName}\\()`));
  assert.ok(match, `${name} source not found`);
  return match[0];
}

function tippingFunction(name) {
  const match = tipping.match(new RegExp(`  function ${name}\\([^]*?\\n  }`));
  assert.ok(match, `${name} source not found`);
  return match[0];
}

test('recent form prefers more wins and then the newest result', () => {
  const context = vm.createContext({
    getPlayerRecentForm: player => player.form
  });
  vm.runInContext(appFunction('comparePlayerRecentForm', 'getPlayerForm'), context);

  const threeWins = { form: [{ won: true }, { won: true }, { won: true }] };
  const recentWin = { form: [{ won: true }, { won: true }, { won: false }] };
  const olderWins = { form: [{ won: false }, { won: true }, { won: true }] };

  assert.ok(context.comparePlayerRecentForm(threeWins, recentWin, []) < 0);
  assert.ok(context.comparePlayerRecentForm(recentWin, olderWins, []) < 0);
});

test('all-time columns use fixed descending values and the points order for ties', () => {
  const context = vm.createContext({});
  vm.runInContext([
    appFunction('compareDescendingNullable', 'compareRankingByPoints'),
    appFunction('getAllTimeAveragePoints', 'formatAllTimeAveragePoints'),
    appFunction('compareAllTimeRankingByPoints', 'compareAllTimeRankingByAveragePoints'),
    appFunction('compareAllTimeRanking', 'renderAllTimePointsRankReference')
  ].join('\n'), context);

  const players = [
    { id: 'few', stats: { partien: 2, siege: 2, punkte: 6, spielDiff: 8, gewonneneSpiele: 24 } },
    { id: 'many', stats: { partien: 5, siege: 2, punkte: 6, spielDiff: 3, gewonneneSpiele: 40 } },
    { id: 'none', stats: { partien: 0, siege: 0, punkte: 0, spielDiff: 0, gewonneneSpiele: 0 } }
  ];

  assert.deepEqual(
    [...players].sort((left, right) => context.compareAllTimeRanking(left, right, 'games')).map(player => player.id),
    ['many', 'few', 'none']
  );
  assert.deepEqual(
    [...players].sort((left, right) => context.compareAllTimeRanking(left, right, 'average')).map(player => player.id),
    ['few', 'many', 'none']
  );
});

test('prediction sorting keeps the official leaderboard untouched', () => {
  const state = {
    leaderboardSortMode: 'exact',
    leaderboard: [
      { user_id: 'missing', points: 20, exact_count: null, predictions_count: 5, bonus_points: 0 },
      { user_id: 'leader', points: 12, exact_count: 1, predictions_count: 4, bonus_points: 0 },
      { user_id: 'exact', points: 8, exact_count: 2, predictions_count: 3, bonus_points: 0 },
      { user_id: 'bonus', points: 8, exact_count: 0, predictions_count: 2, bonus_points: 8 }
    ]
  };
  const context = vm.createContext({ state });
  vm.runInContext([
    tippingFunction('getLeaderboardPassivePoints'),
    tippingFunction('getPredictionLeaderboardSortValue'),
    tippingFunction('getSortedPredictionLeaderboard')
  ].join('\n'), context);

  const sorted = context.getSortedPredictionLeaderboard();
  assert.deepEqual(Array.from(sorted, item => item.entry.user_id), ['exact', 'leader', 'bonus', 'missing']);
  assert.deepEqual(Array.from(state.leaderboard, item => item.user_id), ['missing', 'leader', 'exact', 'bonus']);
  assert.deepEqual(Array.from(sorted, item => item.canonicalRank), [3, 2, 4, 1]);
});
