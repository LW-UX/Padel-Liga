const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260922130000_reset_test_season_roster.sql'),
  'utf8'
);
const openMatchMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261008140000_add_open_test_matchday_three.sql'),
  'utf8'
);
const openMatchSixMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261012230000_add_open_test_match_six.sql'),
  'utf8'
);
const additionalMatchesMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261019120000_add_test_matches_seven_to_nine.sql'),
  'utf8'
);
const matchdayWindowsMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261019130000_set_test_matchday_windows.sql'),
  'utf8'
);
const matchStatisticsMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261014110000_test_season_match_statistics.sql'),
  'utf8'
);
const matchStatisticsShowcaseMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261014120000_test_match_statistics_showcase.sql'),
  'utf8'
);

test('test season migrations keep the interactive matches and the separate statistics history fixture', () => {
  assert.match(migration, /delete from public\.matches[\s\S]*id not in/);
  assert.match(migration, /delete from public\.result_proposals/);
  assert.match(migration, /delete from public\.match_elo_changes/);
  assert.match(openMatchMigration, /values \('test-2026', 3, null, null, null\)/);
  assert.match(openMatchMigration, /'test-2026-partie-5'[\s\S]*'league'[\s\S]*'best-of-three'[\s\S]*null/);
  assert.match(openMatchMigration, /public\.profiles[\s\S]*profile\.player_id = any\(expected_players\)/);
  assert.match(openMatchSixMigration, /target_season_id[\s\S]*'test-2026-partie-6'[\s\S]*'league'[\s\S]*'best-of-three'/);
  assert.match(openMatchSixMigration, /match\.cancelled_at is null[\s\S]*match\.betting_open/);
  assert.match(additionalMatchesMigration, /'test-2026-partie-7'[\s\S]*'test-2026-partie-8'[\s\S]*'test-2026-partie-9'/);
  assert.match(additionalMatchesMigration, /target_season_id, 4, null, null, null[\s\S]*target_season_id, 5, null, null, null/);
  assert.match(additionalMatchesMigration, /match\.counts_for_ranking[\s\S]*match\.counts_for_elo[\s\S]*match\.betting_open/);
  assert.match(matchdayWindowsMigration, /target_season_id, 3, '2026-10-05', '2026-11-12'/);
  assert.match(matchdayWindowsMigration, /target_season_id, 4, '2026-11-15', '2026-12-15'/);
  assert.match(matchdayWindowsMigration, /target_season_id, 5, '2027-01-01', '2027-01-21'/);
  assert.match(matchdayWindowsMigration, /on conflict \(season_id, matchday\) do update set/);
  assert.match(matchStatisticsMigration, /recalculate_test_match_elo/);
  assert.match(matchStatisticsMigration, /set qualification_places = 3/);
  assert.match(matchStatisticsMigration, /not season\.counts_for_profile/);
  assert.match(matchStatisticsShowcaseMigration, /test-2026-statistics-history/);
  assert.match(matchStatisticsShowcaseMigration, /Testbetrieb Nord/);
});

