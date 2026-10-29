const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migrationName = '20261014160000_final_four_prematch_facts.sql';
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', migrationName), 'utf8');
const testFixtureMigration = fs.readFileSync(path.join(
  root, 'supabase', 'migrations', '20261014200000_test_final_four_prematch_fixture.sql'
), 'utf8');
const pairingCorrectionMigration = fs.readFileSync(path.join(
  root, 'supabase', 'migrations', '20261014210000_correct_test_final_four_pairing.sql'
), 'utf8');
const leagueHistoryMigration = fs.readFileSync(path.join(
  root, 'supabase', 'migrations', '20261014220000_final_four_prematch_league_history.sql'
), 'utf8');
const matchTiebreakHistoryMigration = fs.readFileSync(path.join(
  root, 'supabase', 'migrations', '20261029130000_final_four_prematch_match_tiebreak_colors.sql'
), 'utf8');
const replacementMatchTiebreakMigration = fs.readFileSync(path.join(
  root, 'supabase', 'migrations', '20261029140000_final_four_replacement_match_tiebreak_colors.sql'
), 'utf8');
const titleForecastDivisorMigration = fs.readFileSync(path.join(
  root, 'supabase', 'migrations', '20261014234000_final_four_title_forecast_divisor.sql'
), 'utf8');
const longestStreakMigration = fs.readFileSync(path.join(
  root, 'supabase', 'migrations', '20261016130000_final_four_longest_official_streak.sql'
), 'utf8');
const longestWinStreakMigration = fs.readFileSync(path.join(
  root, 'supabase', 'migrations', '20261016140000_final_four_longest_win_streak.sql'
), 'utf8');
const earlierMigrations = fs.readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter(file => file.endsWith('.sql') && file < migrationName)
  .sort();

function existingFunction(name) {
  let found;
  for (const file of earlierMigrations) {
    const source = fs.readFileSync(path.join(root, 'supabase', 'migrations', file), 'utf8');
    const regex = new RegExp(`create or replace function private\\.${name}\\([\\s\\S]*?\\$\\$;`, 'g');
    for (const match of source.matchAll(regex)) found = match[0];
  }
  assert.ok(found, `missing private.${name}`);
  return found;
}

const schema = `
create schema private;
create role anon;
create role authenticated;
create table public.players(
  id text primary key,
  display_name text not null,
  initial_elo integer not null
);
create table public.seasons(
  id text primary key,
  label text not null,
  counts_for_profile boolean not null default true
);
create table public.matches(
  id text primary key,
  season_id text not null references public.seasons(id),
  match_at timestamptz,
  matchday integer not null default 1,
  display_label text,
  match_type text not null default 'season',
  competition_stage text not null default 'league',
  cancelled_at timestamptz,
  counts_for_ranking boolean not null default true,
  counts_for_elo boolean not null default true,
  winner integer,
  actual_sets text,
  result_details text,
  team_one_label text,
  team_two_label text
);
create table public.match_players(
  match_id text not null references public.matches(id),
  player_id text not null references public.players(id),
  team integer not null,
  position integer not null,
  primary key(match_id,player_id),
  unique(match_id,team,position)
);
create table public.season_players(
  season_id text not null references public.seasons(id),
  player_id text not null references public.players(id),
  start_elo integer not null
);
create table public.season_tournament_players(
  season_id text not null references public.seasons(id),
  stage text not null,
  seed integer not null,
  player_id text not null references public.players(id),
  league_rank integer not null,
  primary key(season_id, stage, seed)
);
create table public.match_elo_changes(
  match_id text not null references public.matches(id),
  player_id text not null references public.players(id),
  old_elo integer not null,
  new_elo integer not null
);
create table public.training_sessions(
  id bigint primary key,
  played_on date not null,
  display_time time,
  player_ids text[] not null,
  status text not null
);
create table public.training_rounds(
  session_id bigint not null references public.training_sessions(id),
  round_number integer not null,
  team_one_ids text[] not null,
  team_two_ids text[] not null,
  result_details text,
  is_complete boolean not null
);
create table public.live_match_sessions(
  id bigint generated always as identity primary key,
  match_id text not null references public.matches(id),
  started_at timestamptz not null default now()
);
create table public.result_proposals(
  match_id text not null references public.matches(id)
);
create table public.final_four_replacements(
  season_id text primary key references public.seasons(id),
  original_player_id text not null references public.players(id),
  replacement_player_id text not null references public.players(id),
  original_prematch_facts jsonb not null,
  replaced_at timestamptz not null default now()
);
`;

async function addMatch(db, id, {
  at,
  stage = 'league',
  winner = null,
  season = 'season',
  teams = [['a', 'b'], ['c', 'd']]
} = {}) {
  await db.query(
    `insert into public.matches(id,season_id,match_at,competition_stage,winner,actual_sets,result_details)
     values($1,$2,$3,$4,$5,$6,$7)`,
    [id, season, at, stage, winner, winner ? (winner === 1 ? '2:0' : '0:2') : null,
      winner ? (winner === 1 ? '6:2, 6:3' : '2:6, 3:6') : null]
  );
  for (const [teamIndex, players] of teams.entries()) {
    for (const [position, playerId] of players.entries()) {
      await db.query(
        'insert into public.match_players(match_id,player_id,team,position) values($1,$2,$3,$4)',
        [id, playerId, teamIndex + 1, position + 1]
      );
    }
  }
}

test('Final Four Prematch SQL validates participants, composes facts and freezes both entry paths',
  { skip: !process.env.PGLITE_MODULE }, async t => {
    const { PGlite } = require(process.env.PGLITE_MODULE);
    const db = new PGlite();
    t.after(() => db.close());
    await db.exec(schema);
    for (const name of [
      'training_regular_set_state',
      'training_tiebreak_state',
      'profile_training_metrics',
      'match_detail_history',
      'match_detail_streak',
      'match_detail_elo'
    ]) await db.exec(existingFunction(name));
    await db.exec(migration);
    await db.exec(leagueHistoryMigration);
    await db.exec(matchTiebreakHistoryMigration);
    await db.exec(titleForecastDivisorMigration);

    await db.exec(`
      insert into public.players values
        ('a','Anna',1000),('b','Ben',1000),('c','Chris',1000),('d','Dana',1000),('e','Emil',1000);
      insert into public.seasons values('old-season','Alte Saison',true),('season','Saison',true);
      insert into public.season_players
        select season.id,player.id,1000
        from public.seasons as season cross join public.players as player;
      insert into public.season_tournament_players values
        ('season','final_four',1,'a',1),
        ('season','final_four',2,'b',2),
        ('season','final_four',3,'c',3),
        ('season','final_four',4,'d',4);
    `);
    for (let index = 1; index <= 4; index += 1) {
      await addMatch(db, `old-history-${index}`, {
        season: 'old-season', at: `2026-08-0${index}T12:00:00Z`, winner: 1
      });
    }
    const currentSeasonWinners = [2, 1, 1, 2, 1, 1];
    for (let index = 1; index <= 6; index += 1) {
      await addMatch(db, `history-${index}`, {
        at: `2026-09-0${index}T12:00:00Z`, winner: currentSeasonWinners[index - 1]
      });
    }
    await db.exec("update public.matches set actual_sets='1:2',result_details='6:4, 4:6 – 8:10' where id='history-2'");
    await db.exec(`
      insert into public.training_sessions values
        (1,'2026-09-10','10:00',array['a','b','c','d'],'confirmed');
      insert into public.training_rounds values
        (1,1,array['a','c'],array['b','d'],'6:2',true);
    `);
    await addMatch(db, 'ff-1', {
      at: '2026-11-01T12:00:00Z', stage: 'final_four', teams: [['a', 'b'], ['c', 'd']]
    });
    await addMatch(db, 'ff-2', {
      at: '2026-11-01T13:00:00Z', stage: 'final_four', teams: [['a', 'c'], ['b', 'd']]
    });
    await addMatch(db, 'ff-3', {
      at: '2026-11-01T14:00:00Z', stage: 'final_four', teams: [['a', 'd'], ['b', 'c']]
    });

    const facts = async () => (await db.query(
      "select public.get_public_final_four_overview('ff-1') as value"
    )).rows[0].value;
    let value = await facts();
    assert.deepEqual(value.players.map(player => player.playerId), ['a', 'b', 'c', 'd']);
    assert.deepEqual(value.players.map(player => player.titleForecast), [25, 25, 25, 25]);
    assert.equal(value.players.reduce((sum, player) => sum + player.titleForecast, 0), 100);
    assert.equal(Object.hasOwn(value.players[0], 'form'), false);
    assert.deepEqual(value.players[0].leagueHistory.map(match => match.id), [
      'history-1', 'history-2', 'history-3', 'history-4', 'history-5', 'history-6'
    ]);
    assert.deepEqual(value.players[0].leagueHistory.map(match => match.decidedByMatchTiebreak), [
      false, true, false, false, false, false
    ]);
    assert.equal(value.players[0].streak, null,
      'the former calculation sees only the current two-win run');
    assert.ok(value.players[0].relationships.some(relation =>
      relation.kind === 'successPartner' && relation.playerId === 'b'
    ));
    assert.ok(value.players.flatMap(player => player.relationships)
      .every(relation => ['a', 'b', 'c', 'd'].includes(relation.playerId)));

    await db.exec("delete from public.match_players where match_id='ff-3' and player_id='c'");
    assert.equal(await facts(), null, 'an incomplete pairing hides the whole block');
    await db.exec("insert into public.match_players values('ff-3','c',2,2)");

    await db.exec(`
      insert into public.match_elo_changes values
        ('history-3','a',1000,1300),('history-3','b',1000,1100),
        ('history-3','c',1000,900),('history-3','d',1000,700);
    `);
    value = await facts();
    assert.equal(value.players.reduce((sum, player) => sum + player.titleForecast, 0), 100);
    assert.deepEqual(value.players.map(player => player.titleForecast), [35, 30, 25, 10]);

    await db.exec("insert into public.live_match_sessions(match_id,started_at) values('ff-1','2026-10-14T12:00:00Z')");
    await db.exec(longestStreakMigration);
    await db.exec(longestWinStreakMigration);
    const frozen = await facts();
    assert.equal(frozen.isFrozen, true);
    assert.equal(new Date(frozen.snapshotAt).toISOString(), '2026-10-14T12:00:00.000Z');
    assert.deepEqual(frozen.players[0].streak, { outcome: 'win', length: 4 },
      'the migration backfills the frozen, cross-season longest streak and ignores training');
    assert.equal(frozen.players[2].streak, null,
      'a historical four-loss run is not presented as a winning streak');
    await db.exec("update public.match_elo_changes set new_elo=500 where match_id='history-3'");
    assert.deepEqual((await facts()).players, frozen.players, 'later Elo changes cannot rewrite the snapshot');

    await db.exec("delete from public.final_four_prematch_snapshots where season_id='season'");
    await db.exec("update public.matches set winner=1,actual_sets='1:0',result_details='6:3' where id='ff-1'");
    assert.equal((await db.query(
      "select count(*)::integer as count from public.final_four_prematch_snapshots where season_id='season'"
    )).rows[0].count, 1, 'direct result entry creates the fallback snapshot');

    await db.exec('set role anon');
    assert.equal((await facts()).players.length, 4);
    await assert.rejects(
      db.query('select * from public.final_four_prematch_snapshots'),
      /permission denied/
    );
  });

test('hidden test season fixture adds ranked finalists and backfills the historical first-start snapshot',
  { skip: !process.env.PGLITE_MODULE }, async t => {
    const { PGlite } = require(process.env.PGLITE_MODULE);
    const db = new PGlite();
    t.after(() => db.close());
    await db.exec(schema);
    for (const name of [
      'training_regular_set_state',
      'training_tiebreak_state',
      'profile_training_metrics',
      'match_detail_history',
      'match_detail_streak',
      'match_detail_elo'
    ]) await db.exec(existingFunction(name));
    await db.exec(migration);
    await db.exec(leagueHistoryMigration);
    await db.exec(matchTiebreakHistoryMigration);
    await db.exec(titleForecastDivisorMigration);
    await db.exec(longestStreakMigration);
    await db.exec(longestWinStreakMigration);
    await db.exec(`
      insert into public.players values
        ('ludi_gmx','Test GMX',995),
        ('ludwig_w','Ludwig W.',1045),
        ('ludi_ionos','Test Ionos',776),
        ('ludi_gmail','Test Gmail',683);
      insert into public.seasons values('test-2026','Test-Saison',false);
      insert into public.season_players select 'test-2026',id,initial_elo from public.players;
    `);
    const teams = [
      [['ludi_gmx', 'ludi_ionos'], ['ludi_gmail', 'ludwig_w']],
      [['ludi_gmx', 'ludwig_w'], ['ludi_gmail', 'ludi_ionos']],
      [['ludi_gmail', 'ludwig_w'], ['ludi_gmx', 'ludi_ionos']]
    ];
    for (let index = 0; index < teams.length; index += 1) {
      await addMatch(db, `test-2026-live-${index + 1}`, {
        season: 'test-2026',
        at: `2026-10-07T1${index + 6}:00:00Z`,
        stage: 'final_four',
        teams: teams[index]
      });
    }
    await db.exec(`
      insert into public.live_match_sessions(match_id,started_at)
      values('test-2026-live-1','2026-09-28T14:13:07.666714Z');
    `);
    assert.equal((await db.query(
      "select count(*)::integer as count from public.final_four_prematch_snapshots"
    )).rows[0].count, 0, 'the old live start happened before finalists existed');

    await db.exec(testFixtureMigration);
    const finalists = (await db.query(`
      select seed,player_id,league_rank
      from public.season_tournament_players
      where season_id='test-2026' and stage='final_four'
      order by seed
    `)).rows;
    assert.deepEqual(finalists.map(row => [row.seed, row.player_id, row.league_rank]), [
      [1, 'ludi_gmx', 1],
      [2, 'ludwig_w', 2],
      [3, 'ludi_ionos', 3],
      [4, 'ludi_gmail', 4]
    ]);
    const overview = (await db.query(
      "select public.get_public_final_four_overview('test-2026-live-1') as value"
    )).rows[0].value;
    assert.equal(overview.isFrozen, true);
    assert.equal(new Date(overview.snapshotAt).toISOString(), '2026-09-28T14:13:07.666Z');
    assert.deepEqual(overview.players.map(player => player.playerId), [
      'ludi_gmx', 'ludwig_w', 'ludi_ionos', 'ludi_gmail'
    ]);
    assert.deepEqual(overview.players.map(player => player.titleForecast), [35, 29, 21, 15]);

    await db.exec(pairingCorrectionMigration);
    const correctedPlayers = (await db.query(`
      select player_id,team,position
      from public.match_players
      where match_id='test-2026-live-3'
      order by team,position
    `)).rows;
    assert.deepEqual(correctedPlayers.map(row => [row.player_id, row.team, row.position]), [
      ['ludi_ionos', 1, 1],
      ['ludwig_w', 1, 2],
      ['ludi_gmx', 2, 1],
      ['ludi_gmail', 2, 2]
    ]);
    const correctedOverview = (await db.query(
      "select public.get_public_final_four_overview('test-2026-live-3') as value"
    )).rows[0].value;
    assert.equal(new Date(correctedOverview.snapshotAt).toISOString(), '2026-09-28T14:13:07.666Z');
    assert.deepEqual(correctedOverview.players.map(player => player.titleForecast), [31, 33, 22, 14]);

    await db.exec(testFixtureMigration);
    await db.exec(pairingCorrectionMigration);
    assert.equal((await db.query(
      "select count(*)::integer as count from public.final_four_prematch_snapshots"
    )).rows[0].count, 1, 'reapplying the fixture remains idempotent');
  });

test('withdrawn finalist facts receive match-tiebreak markers without changing the frozen history',
  { skip: !process.env.PGLITE_MODULE }, async t => {
    const { PGlite } = require(process.env.PGLITE_MODULE);
    const db = new PGlite();
    t.after(() => db.close());
    await db.exec(schema);
    await db.exec(`
      insert into public.players values
        ('original','Original',1000),('replacement','Replacement',1000),
        ('b','B',1000),('c','C',1000),('d','D',1000);
      insert into public.seasons values('season','Saison',true);
      insert into public.matches(
        id,season_id,match_at,competition_stage,winner,actual_sets,result_details
      ) values
        ('regular','season','2026-09-01T12:00:00Z','league',1,'2:0','6:2, 6:3'),
        ('match-tiebreak','season','2026-09-02T12:00:00Z','league',2,'1:2','6:4, 4:6 – 8:10');
      insert into public.final_four_replacements(
        season_id,original_player_id,replacement_player_id,original_prematch_facts
      ) values (
        'season','original','replacement',
        '{"playerId":"original","leagueHistory":[{"id":"regular","outcome":"win"},{"id":"match-tiebreak","outcome":"loss"}]}'::jsonb
      );
    `);

    await db.exec(replacementMatchTiebreakMigration);
    const facts = (await db.query(`
      select original_prematch_facts as value
      from public.final_four_replacements
      where season_id = 'season'
    `)).rows[0].value;

    assert.equal(facts.playerId, 'original');
    assert.deepEqual(facts.leagueHistory.map(match => match.id), ['regular', 'match-tiebreak']);
    assert.deepEqual(facts.leagueHistory.map(match => match.decidedByMatchTiebreak), [false, true]);
  });
