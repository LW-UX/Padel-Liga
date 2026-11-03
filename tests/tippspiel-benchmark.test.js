const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js', 'tippspiel.js'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261103140000_benchmark_prediction_account.sql'),
  'utf8'
);

function fn(name) {
  const match = source.match(new RegExp(`  function ${name}\\([^]*?\\n  }`));
  assert.ok(match, name);
  return match[0];
}

test('benchmark rows sit behind ties at their points position without taking a rank', () => {
  const benchmark = { user_id: 'b', points: 10, is_benchmark: true };
  const state = { benchmarkLeaderboard: [benchmark] };
  const context = vm.createContext({ state });
  vm.runInContext(fn('insertBenchmarkRows'), context);

  const rows = [{ entry: { user_id: 'x', points: 12 } }, { entry: { user_id: 'y', points: 10 } }, { entry: { user_id: 'z', points: 4 } }];
  const result = context.insertBenchmarkRows(rows, entry => entry.points);
  assert.deepEqual(Array.from(result, row => row.entry.user_id), ['x', 'y', 'b', 'z']);
  assert.deepEqual(Array.from(context.insertBenchmarkRows([], entry => entry.points), row => row.entry.user_id), ['b']);
});

test('the official leaderboard excludes benchmark accounts', () => {
  assert.match(source, /state\.leaderboard = leaderboard\.filter\(entry => !entry\.is_benchmark\)/);
  assert.match(source, /const rank = entry\.is_benchmark \? null : \+\+officialRank/);
});

test('benchmark tips follow the auto-tip rule and never influence other accounts', () => {
  assert.match(migration, /add column if not exists is_benchmark boolean not null default false/);
  assert.match(migration, /when favorite >= 54 and winner = 1 then '2:0'/);
  assert.match(migration, /least\(team_one_elos\[1\], team_one_elos\[2\]\) \* 0\.7/);
  assert.match(migration, /cron\.schedule\(\s*'sync-benchmark-predictions'/);
  // Passive Gutschrift, Tippübersicht, Floor-Werte, Verteilung und Vorjahres-Podium.
  assert.equal(migration.match(/not private\.is_benchmark_account\(/g).length, 7);
});

test('benchmark tips wait until a match is tippable on the prediction page', () => {
  const windowMigration = fs.readFileSync(
    path.join(root, 'supabase', 'migrations', '20261103150000_benchmark_predictions_preview_window.sql'),
    'utf8'
  );
  assert.match(windowMigration, /match\.match_at is not null or private\.match_forecast_mode\(match\.id\) is distinct from 'basic'/);
});
