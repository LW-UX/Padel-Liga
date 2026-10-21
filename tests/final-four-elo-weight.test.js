const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(
  __dirname, '..', 'supabase', 'migrations',
  '20261016150000_final_four_half_elo.sql'
), 'utf8');

test('Final Four Elo uses a half-weighted result while other stages keep full weight', () => {
  assert.match(migration,
    /case when p_competition_stage = 'final_four' then 0\.5::numeric else 1::numeric end/);
  assert.equal((migration.match(/private\.calculate_elo_after_match\(/g) || []).length, 6);
  assert.match(migration,
    /create or replace function private\.recalculate_global_elo_from_point/);
  assert.match(migration,
    /create or replace function private\.recalculate_test_match_elo/);
  assert.match(migration,
    /perform private\.recalculate_global_elo_from_point\(replay_match\.match_at, replay_match\.id\)/);
});

test('the three completed Final Four matches are replayed with half Elo weight',
  { skip: !process.env.PGLITE_MODULE }, async t => {
    const { PGlite } = require(process.env.PGLITE_MODULE);
    const db = new PGlite();
    t.after(() => db.close());

    await db.exec(`
      create schema private;
      create role anon;
      create role authenticated;

      create table public.players(
        id text primary key,
        initial_elo integer
      );
      create table public.seasons(
        id text primary key,
        counts_for_profile boolean not null,
        completed_at timestamptz,
        elo_final_date date
      );
      create table public.season_players(
        season_id text,
        player_id text,
        start_elo integer,
        end_elo integer,
        primary key(season_id, player_id)
      );
      create table public.matches(
        id text primary key,
        season_id text,
        match_at timestamptz,
        competition_stage text,
        format text,
        result_details text,
        actual_sets text,
        winner integer,
        counts_for_elo boolean,
        cancelled_at timestamptz
      );
      create table public.match_players(
        match_id text,
        player_id text,
        team integer,
        position integer,
        primary key(match_id, player_id)
      );
      create table public.match_elo_changes(
        match_id text,
        player_id text,
        old_elo integer,
        new_elo integer,
        primary key(match_id, player_id)
      );

      insert into public.seasons values ('2026', true, null, null);
      insert into public.players values
        ('jonas_l', 1011),
        ('luca_w', 1051),
        ('ludwig_w', 1134),
        ('marcel_m', 1170);
      insert into public.season_players(season_id, player_id, start_elo)
      select '2026', id, initial_elo from public.players;

      insert into public.matches values
        ('season-2026-partie-28', '2026', '2026-10-15 16:15:21+00',
          'final_four', 'single-set', '5:7', '0:1', 2, true, null),
        ('season-2026-partie-29', '2026', '2026-10-15 16:39:09+00',
          'final_four', 'single-set', '6:4', '1:0', 1, true, null),
        ('season-2026-partie-30', '2026', '2026-10-15 17:04:05+00',
          'final_four', 'single-set', '6:3', '1:0', 1, true, null);

      insert into public.match_players values
        ('season-2026-partie-28', 'jonas_l', 1, 1),
        ('season-2026-partie-28', 'luca_w', 1, 2),
        ('season-2026-partie-28', 'marcel_m', 2, 1),
        ('season-2026-partie-28', 'ludwig_w', 2, 2),
        ('season-2026-partie-29', 'luca_w', 1, 1),
        ('season-2026-partie-29', 'ludwig_w', 1, 2),
        ('season-2026-partie-29', 'jonas_l', 2, 1),
        ('season-2026-partie-29', 'marcel_m', 2, 2),
        ('season-2026-partie-30', 'luca_w', 1, 1),
        ('season-2026-partie-30', 'marcel_m', 1, 2),
        ('season-2026-partie-30', 'jonas_l', 2, 1),
        ('season-2026-partie-30', 'ludwig_w', 2, 2);
    `);

    await db.exec(migration);

    const weights = await db.query(`
      select
        private.calculate_elo_after_match(1000, 1000, 1000, true, 2, 'league') as league,
        private.calculate_elo_after_match(1000, 1000, 1000, true, 2, 'final_four') as final_four
    `);
    assert.deepEqual(weights.rows, [{ league: 1050, final_four: 1025 }]);

    const changes = await db.query(`
      select match_id, player_id, old_elo, new_elo
      from public.match_elo_changes
      order by match_id, player_id
    `);
    assert.deepEqual(changes.rows, [
      { match_id: 'season-2026-partie-28', player_id: 'jonas_l', old_elo: 1011, new_elo: 993 },
      { match_id: 'season-2026-partie-28', player_id: 'luca_w', old_elo: 1051, new_elo: 1031 },
      { match_id: 'season-2026-partie-28', player_id: 'ludwig_w', old_elo: 1134, new_elo: 1154 },
      { match_id: 'season-2026-partie-28', player_id: 'marcel_m', old_elo: 1170, new_elo: 1188 },
      { match_id: 'season-2026-partie-29', player_id: 'jonas_l', old_elo: 993, new_elo: 972 },
      { match_id: 'season-2026-partie-29', player_id: 'luca_w', old_elo: 1031, new_elo: 1061 },
      { match_id: 'season-2026-partie-29', player_id: 'ludwig_w', old_elo: 1154, new_elo: 1177 },
      { match_id: 'season-2026-partie-29', player_id: 'marcel_m', old_elo: 1188, new_elo: 1156 },
      { match_id: 'season-2026-partie-30', player_id: 'jonas_l', old_elo: 972, new_elo: 953 },
      { match_id: 'season-2026-partie-30', player_id: 'luca_w', old_elo: 1061, new_elo: 1090 },
      { match_id: 'season-2026-partie-30', player_id: 'ludwig_w', old_elo: 1177, new_elo: 1145 },
      { match_id: 'season-2026-partie-30', player_id: 'marcel_m', old_elo: 1156, new_elo: 1179 }
    ]);
  });
