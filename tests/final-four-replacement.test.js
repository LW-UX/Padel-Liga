const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(
  __dirname, '..', 'supabase', 'migrations',
  '20261015090000_summer_2026_final_four_replacement.sql'
), 'utf8');
const reseedMigration = fs.readFileSync(path.join(
  __dirname, '..', 'supabase', 'migrations',
  '20261015100000_reseed_summer_2026_final_four.sql'
), 'utf8');

test('Sommer 2026 replaces the finalist and reseeds the three pairings',
  { skip: !process.env.PGLITE_MODULE }, async t => {
    const { PGlite } = require(process.env.PGLITE_MODULE);
    const db = new PGlite();
    t.after(() => db.close());
    await db.exec(`
      create schema private;
      create role anon;
      create role authenticated;
      create table public.seasons(id text primary key, label text not null);
      create table public.players(id text primary key, display_name text not null);
      create table public.matches(
        id text primary key, season_id text references public.seasons(id),
        competition_stage text, cancelled_at timestamptz, actual_sets text,
        winner integer, result_details text, team_one_label text,
        team_two_label text, updated_at timestamptz,
        team_one_qualifier_ranks integer[], team_two_qualifier_ranks integer[]
      );
      create table public.match_players(
        match_id text references public.matches(id), player_id text references public.players(id),
        team integer, position integer, primary key(match_id, player_id),
        unique(match_id, team, position)
      );
      create table public.season_tournament_players(
        season_id text references public.seasons(id), stage text, seed integer,
        player_id text references public.players(id), league_rank integer,
        qualified_at timestamptz default now(), primary key(season_id, stage, seed),
        unique(season_id, stage, player_id)
      );
      create table private.season_player_statistics(
        season_id text, league_id text, rank integer, player_id text
      );
      create table public.result_proposals(match_id text);
      create table public.predictions(match_id text);
      create table public.live_match_sessions(match_id text);
      create table public.final_four_prematch_snapshots(season_id text);
      create table public.final_four_poll_votes(season_id text, player_id text);
      create table public.player_achievements(
        player_id text, season_id text, league_id text, kind text, title text,
        subtitle text, achieved_on date, priority integer
      );
      create table public.leagues(season_id text, id text, is_default boolean);

      create function private.build_final_four_prematch_facts(
        p_season_id text, p_at timestamptz, p_match_id text
      ) returns jsonb language sql stable as $$
        select jsonb_build_object('seasonId', p_season_id, 'players', jsonb_agg(
          jsonb_build_object('playerId', finalist.player_id,
            'displayName', player.display_name, 'seed', finalist.seed,
            'leagueRank', finalist.league_rank, 'titleForecast', 25,
            'leagueHistory', '[]'::jsonb)
          order by finalist.league_rank))
        from public.season_tournament_players as finalist
        join public.players as player on player.id = finalist.player_id
        where finalist.season_id = p_season_id and finalist.stage = 'final_four';
      $$;
      create function private.award_final_four_players(p_season_id text)
      returns void language sql as $$
        insert into public.player_achievements(
          player_id, season_id, league_id, kind, title, subtitle, priority
        ) select finalist.player_id, p_season_id, 'main', 'final_four',
            'Final 4 Teilnehmer', 'Padel-Liga Sommer 2026', 100
          from public.season_tournament_players as finalist
          where finalist.season_id = p_season_id and finalist.stage = 'final_four'
            and not exists (
              select 1 from public.player_achievements as award
              where award.season_id = p_season_id
                and award.player_id = finalist.player_id and award.kind = 'final_four'
            );
      $$;
      create function public.get_public_final_four_overview(p_match_id text)
      returns jsonb language sql stable as $$
        select private.build_final_four_prematch_facts(match.season_id, now(), match.id)
        from public.matches as match where match.id = p_match_id;
      $$;
      create function public.get_public_final_four_poll(p_match_id text, p_browser_id uuid)
      returns jsonb language sql stable as $$
        select jsonb_build_object('options', jsonb_agg(jsonb_build_object(
          'playerId', finalist.player_id) order by finalist.seed))
        from public.matches as match
        join public.season_tournament_players as finalist
          on finalist.season_id = match.season_id and finalist.stage = 'final_four'
        where match.id = p_match_id;
      $$;

      insert into public.seasons values('2026', 'Sommer 2026'), ('winter-2026', 'Winter 2026');
      insert into public.players values
        ('marco_m','Marco M.'),('luca_w','Luca W.'),('jonas_l','Jonas L.'),
        ('marcel_m','Marcel M.'),('ludwig_w','Ludwig W.');
      insert into private.season_player_statistics values('2026','main',5,'ludwig_w');
      insert into public.season_tournament_players(season_id,stage,seed,player_id,league_rank)
      values ('2026','final_four',1,'marco_m',1),
        ('2026','final_four',2,'luca_w',2),
        ('2026','final_four',3,'jonas_l',3),
        ('2026','final_four',4,'marcel_m',4),
        ('winter-2026','final_four',1,'marco_m',1);
      insert into public.leagues values('2026','main',true);
      insert into public.player_achievements(player_id,season_id,league_id,kind,title)
        values('marco_m','2026','main','final_four','Final 4 Teilnehmer');
      insert into public.final_four_poll_votes values('2026','luca_w');
      insert into public.matches(id,season_id,competition_stage,
        team_one_qualifier_ranks,team_two_qualifier_ranks) values
        ('season-2026-partie-28','2026','final_four',array[1,2],array[3,4]),
        ('season-2026-partie-29','2026','final_four',array[1,4],array[2,3]),
        ('season-2026-partie-30','2026','final_four',array[1,3],array[2,4]);
      insert into public.match_players values
        ('season-2026-partie-28','marco_m',1,1),
        ('season-2026-partie-28','luca_w',1,2),
        ('season-2026-partie-28','jonas_l',2,1),
        ('season-2026-partie-28','marcel_m',2,2),
        ('season-2026-partie-29','marco_m',1,1),
        ('season-2026-partie-29','marcel_m',1,2),
        ('season-2026-partie-29','luca_w',2,1),
        ('season-2026-partie-29','jonas_l',2,2),
        ('season-2026-partie-30','marco_m',1,1),
        ('season-2026-partie-30','jonas_l',1,2),
        ('season-2026-partie-30','luca_w',2,1),
        ('season-2026-partie-30','marcel_m',2,2);
    `);

    await db.exec(migration);
    const facts = (await db.query(
      "select public.get_public_final_four_overview('season-2026-partie-28') as facts"
    )).rows[0].facts;
    assert.deepEqual(facts.players.map(player => player.playerId),
      ['marco_m', 'luca_w', 'jonas_l', 'marcel_m', 'ludwig_w']);
    assert.equal(facts.players[0].participationStatus, 'withdrawn');
    assert.equal(facts.players[0].titleForecast, null);
    assert.equal(facts.players[4].participationStatus, 'replacement');
    assert.equal(facts.players[4].leagueRank, 5);
    assert.deepEqual((await db.query(
      "select player_id from public.season_tournament_players where season_id='2026' order by seed"
    )).rows.map(row => row.player_id), ['ludwig_w', 'luca_w', 'jonas_l', 'marcel_m']);
    assert.equal((await db.query(
      "select count(*)::integer as n from public.match_players where player_id='ludwig_w'"
    )).rows[0].n, 3);
    assert.equal((await db.query(
      "select count(*)::integer as n from public.player_achievements where season_id='2026' and kind='final_four' and player_id in ('marco_m','ludwig_w')"
    )).rows[0].n, 2);
    const poll = (await db.query(
      "select public.get_public_final_four_poll('season-2026-partie-28', null) as poll"
    )).rows[0].poll;
    assert.deepEqual(poll.options.map(option => option.playerId),
      ['luca_w', 'jonas_l', 'marcel_m', 'ludwig_w']);
    assert.equal((await db.query(
      "select player_id from public.season_tournament_players where season_id='winter-2026'"
    )).rows[0].player_id, 'marco_m');

    await db.exec(reseedMigration);
    const roster = (await db.query(
      "select player_id, seed, league_rank from public.season_tournament_players where season_id='2026' order by seed"
    )).rows;
    assert.deepEqual(roster.map(player => [player.player_id, player.seed, player.league_rank]), [
      ['luca_w', 1, 2], ['jonas_l', 2, 3],
      ['marcel_m', 3, 4], ['ludwig_w', 4, 5]
    ]);
    const pairings = (await db.query(`
      select match_id, team, array_agg(player_id order by position) as players
      from public.match_players
      group by match_id, team order by match_id, team
    `)).rows;
    assert.deepEqual(pairings.map(pairing => pairing.players), [
      ['luca_w', 'jonas_l'], ['marcel_m', 'ludwig_w'],
      ['luca_w', 'ludwig_w'], ['jonas_l', 'marcel_m'],
      ['luca_w', 'marcel_m'], ['jonas_l', 'ludwig_w']
    ]);
    assert.deepEqual((await db.query(
      "select player_id from public.season_tournament_players where season_id='winter-2026'"
    )).rows.map(row => row.player_id), ['marco_m']);
    assert.deepEqual((await db.query(
      "select public.get_public_final_four_overview('season-2026-partie-28') as facts"
    )).rows[0].facts.players.map(player => player.playerId),
    ['marco_m', 'luca_w', 'jonas_l', 'marcel_m', 'ludwig_w']);
  });
