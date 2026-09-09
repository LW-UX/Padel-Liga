const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260909170000_global_elo_match_time.sql'),
  'utf8'
);
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const tippspiel = fs.readFileSync(path.join(root, 'js', 'tippspiel.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

test('migration expands and consolidates the global Elo and match-time schema', () => {
  assert.match(migration, /alter table public\.players[\s\S]*add column if not exists initial_elo integer/);
  assert.match(migration, /alter table public\.season_players[\s\S]*add column if not exists end_elo integer/);
  assert.match(migration, /alter table public\.seasons[\s\S]*add column if not exists completed_at timestamptz/);
  assert.equal((migration.match(/add column if not exists match_at timestamptz/g) || []).length, 2);
  assert.match(migration, /scheduled_date[\s\S]*replace\(match\.display_time, '\.', ':'\)::time[\s\S]*at time zone 'Europe\/Berlin'/);
  assert.match(migration, /proposal\.played_on \+ proposal\.played_time[\s\S]*at time zone 'Europe\/Berlin'/);
  assert.match(migration, /alter column match_at set not null/);
  assert.match(migration, /check \(actual_sets is null or match_at is not null\)/);
  assert.match(migration, /Ein offener Datumshinweis lässt sich nicht verlustfrei über den Spieltag erhalten\./);
  assert.match(migration, /drop column played_on,[\s\S]*drop column played_time/);
  assert.match(migration, /drop column scheduled_date,[\s\S]*drop column display_time,[\s\S]*drop column lock_at/);
});

test('existing official matches and Elo rows are snapshotted and compared exactly', () => {
  assert.match(migration, /create temporary table elo_changes_before_migration/);
  assert.match(migration, /select match_id, player_id, old_elo, new_elo, delta/);
  assert.match(migration, /create temporary table official_match_players_before_migration/);
  assert.match(migration, /select match\.id as match_id, member\.player_id, member\.team, member\.position/);
  assert.match(migration, /create temporary table season_start_elos_before_migration/);
  assert.match(migration, /elo_changes_before_migration[\s\S]*except[\s\S]*public\.match_elo_changes/);
  assert.match(migration, /official_match_players_before_migration[\s\S]*except[\s\S]*public\.match_players/);
  assert.match(migration, /season_start_elos_before_migration[\s\S]*except[\s\S]*public\.season_players/);
  assert.match(migration, /Die vorhandenen Elo-Änderungen wurden während der Migration verändert\./);
  assert.match(migration, /Offizielle Partien oder ihre Spielerzuordnungen wurden während der Migration verändert\./);
  assert.match(migration, /Die vorhandenen Saison-Start-Elo-Werte wurden während der Migration verändert\./);
});

test('initial Elo comes from the earliest official participation and stays absent for test-only players', () => {
  assert.match(migration, /select distinct on \(participant\.player_id\)[\s\S]*participant\.start_elo/);
  assert.match(migration, /season\.counts_for_profile[\s\S]*order by participant\.player_id, season\.starts_on nulls last, season\.id/);
  assert.match(migration, /player\.initial_elo is distinct from seed\.start_elo/);
  assert.match(migration, /player\.initial_elo is not null[\s\S]*not exists[\s\S]*season\.counts_for_profile/);
  assert.match(migration, /create trigger season_players_initialize_player_elo[\s\S]*private\.initialize_player_elo_from_participation/);
});

test('global Elo replay is chronological, serialized, and correction-safe', () => {
  const replayFunction = migration.match(
    /create or replace function private\.recalculate_global_elo_from_point\([\s\S]*?(?=\n\$\$;)/
  )?.[0] || '';
  assert.match(replayFunction, /pg_advisory_xact_lock\(70317, 20270909\)/);
  assert.match(replayFunction, /jsonb_object_agg\(player\.id, player\.initial_elo\)/);
  assert.match(replayFunction, /\(match\.match_at, match\.id\) < \(p_replay_at, p_replay_id\)/);
  assert.match(replayFunction, /\(match\.match_at, match\.id\) >= \(p_replay_at, p_replay_id\)/);
  assert.match(replayFunction, /order by match\.match_at, match\.id/);
  assert.match(replayFunction, /season\.counts_for_profile/);
  assert.match(replayFunction, /match\.counts_for_elo/);
  assert.match(replayFunction, /Für Spieler % fehlt der globale Initial-Elo\./);
  assert.match(replayFunction, /Ein Spieler kann nicht zwei offizielle Elo-Partien zum gleichen Zeitpunkt bestreiten\./);

  const replayTrigger = migration.match(
    /create or replace function private\.recalculate_global_elo_after_match_result\(\)[\s\S]*?(?=\n\$\$;)/
  )?.[0] || '';
  assert.match(replayTrigger, /least\(old\.match_at, new\.match_at\)/);
  assert.match(replayTrigger, /private\.recalculate_global_elo_from_point\(replay_at, new\.id\)/);
  assert.match(migration, /after update of match_at, result_details, actual_sets, winner, counts_for_elo/);
  assert.match(migration, /perform pg_advisory_xact_lock\(70317, 20270909\)[\s\S]*update public\.matches/);
});

test('completed competitions freeze and later corrections refresh season-end snapshots', () => {
  const completionFunction = migration.match(
    /create or replace function private\.try_complete_season\(p_season_id text\)[\s\S]*?(?=\n\$\$;)/
  )?.[0] || '';
  assert.match(completionFunction, /selected_season\.regular_schedule_locked/);
  assert.match(completionFunction, /not selected_season\.counts_for_profile/);
  assert.match(completionFunction, /open_match_count > 0 or incomplete_team_count > 0/);
  assert.match(completionFunction, /quarterfinal_count <> 4 or semifinal_count <> 2 or final_count <> 1/);
  assert.match(completionFunction, /set end_elo = coalesce/);
  assert.match(completionFunction, /completed_at = now\(\)/);
  assert.match(completionFunction, /elo_final_date = \(season_end_at at time zone 'Europe\/Berlin'\)::date/);
  assert.match(completionFunction, /results_entry_enabled = false/);
  assert.match(migration, /create trigger seasons_try_complete_after_schedule_lock[\s\S]*after update of regular_schedule_locked/);
  assert.match(migration, /where season\.completed_at is not null[\s\S]*having max\(match\.match_at\) >= p_replay_at/);
});

test('season statistics expose boundaries and intermediate external Elo events', () => {
  const seasonApi = migration.match(
    /create or replace function public\.get_public_season\(p_season_id text\)[\s\S]*?(?=\n\$\$;)/
  )?.[0] || '';
  assert.match(seasonApi, /'eventType', 'season-start'/);
  assert.match(seasonApi, /'eventType', 'match'/);
  assert.match(seasonApi, /'eventType', 'season-end'/);
  assert.match(seasonApi, /'oldElo', change\.old_elo, 'elo', change\.new_elo, 'delta', change\.delta/);
  assert.match(seasonApi, /'currentElo', coalesce[\s\S]*order by current_match\.match_at desc, current_match\.id desc/);
  assert.match(seasonApi, /'interveningEvents'/);
  assert.match(seasonApi, /external_match\.season_id <> season\.id/);
  assert.match(seasonApi, /'matchAt', match\.match_at/);
  assert.doesNotMatch(seasonApi, /'time', match\.display_time|'date', match\.scheduled_date/);
  assert.match(app, /Zwischenzeitlich/);
  assert.match(app, /event\.seasonLabel \|\| event\.seasonId/);
  assert.match(style, /\.elo-tooltip-intervening/);
});

test('player profiles contain one global start plus real matches but no season boundaries', () => {
  const profileApi = migration.match(
    /create or replace function public\.get_player_profile\(p_player_id text\)[\s\S]*?(?=\n\$\$;)/
  )?.[0] || '';
  assert.match(profileApi, /player\.initial_elo/);
  assert.match(profileApi, /'initial'::text as event_type/);
  assert.match(profileApi, /change\.old_elo, change\.delta, 'match', match\.id/);
  assert.doesNotMatch(profileApi, /season-start|season-end/);
  assert.match(app, /\['initial', 'match', undefined\]\.includes\(item\.eventType\)/);
  assert.match(app, /player\.currentElo !== null[\s\S]*Number\.isFinite\(Number\(player\.currentElo\)\)/);
  assert.match(app, /historyEntry\.matchId === match\?\.id[\s\S]*historyEntry\.oldElo/);
});

test('clients use match_at as the only database match time and render Berlin local time', () => {
  assert.match(app, /\.select\('id, match_at, result_details, actual_sets, winner'\)/);
  assert.match(tippspiel, /\.select\('id, format, competition_stage, betting_open, actual_sets, result_details, match_at'\)/);
  assert.doesNotMatch(tippspiel, /databaseMatch\.lock_at|databaseMatch\.scheduled_date|databaseMatch\.display_time/);
  assert.match(tippspiel, /p_match_at: buildMatchAtValue\(/);

  const formatterSource = app.match(
    /function getBerlinDateTimeParts\(value\) \{[\s\S]*?\n\}/
  )?.[0] || '';
  const formatBerlin = vm.runInNewContext(`(() => { ${formatterSource}\nreturn getBerlinDateTimeParts; })()`, { Intl, Date, Object, Number });
  assert.deepEqual(JSON.parse(JSON.stringify(formatBerlin('2026-07-01T16:30:00Z'))), {
    date: '2026-07-01',
    time: '18.30'
  });
  assert.deepEqual(JSON.parse(JSON.stringify(formatBerlin('2026-12-01T17:30:00Z'))), {
    date: '2026-12-01',
    time: '18.30'
  });
});
