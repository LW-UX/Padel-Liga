begin;

do $$
declare
  test_season_id text;
  first_match_id text;
  first_started_at timestamptz;
begin
  select season.id into test_season_id
  from public.seasons as season
  where season.id in ('test-2026', '2026-test')
    and not season.counts_for_profile
  order by case season.id when 'test-2026' then 1 else 2 end
  limit 1;

  if test_season_id is null then
    raise exception 'Die nicht öffentliche Test-Saison wurde nicht gefunden.';
  end if;

  if (
    select count(*)
    from public.seasons as season
    where season.id in ('test-2026', '2026-test')
      and not season.counts_for_profile
  ) <> 1 then
    raise exception 'Die Test-Saison ist nicht eindeutig.';
  end if;

  if (
    select count(*)
    from public.matches as match
    where match.season_id = test_season_id
      and match.competition_stage = 'final_four'
      and match.cancelled_at is null
  ) <> 3 or (
    select count(*)
    from public.matches as match
    where match.season_id = test_season_id
      and match.competition_stage = 'final_four'
      and match.cancelled_at is null
      and match.id in ('test-2026-live-1', 'test-2026-live-2', 'test-2026-live-3')
  ) <> 3 then
    raise exception 'Die drei erwarteten Test-Final-Four-Partien sind nicht eindeutig vorhanden.';
  end if;

  if (
    select count(*)
    from public.match_players as member
    join public.matches as match on match.id = member.match_id
    where match.season_id = test_season_id
      and match.id in ('test-2026-live-1', 'test-2026-live-2', 'test-2026-live-3')
  ) <> 12 or exists (
    select match.id
    from public.matches as match
    left join public.match_players as member on member.match_id = match.id
    where match.season_id = test_season_id
      and match.id in ('test-2026-live-1', 'test-2026-live-2', 'test-2026-live-3')
    group by match.id
    having count(member.player_id) <> 4
      or count(distinct member.player_id) <> 4
      or count(*) filter (where member.team = 1) <> 2
      or count(*) filter (where member.team = 2) <> 2
  ) or (
    select array_agg(distinct member.player_id order by member.player_id)
    from public.match_players as member
    join public.matches as match on match.id = member.match_id
    where match.season_id = test_season_id
      and match.id in ('test-2026-live-1', 'test-2026-live-2', 'test-2026-live-3')
  ) <> array['ludi_gmail', 'ludi_gmx', 'ludi_ionos', 'ludwig_w']::text[] then
    raise exception 'Die Test-Final-Four-Besetzung entspricht nicht dem erwarteten Viererszenario.';
  end if;

  if exists (
    select 1
    from public.season_tournament_players as finalist
    where finalist.season_id = test_season_id
      and finalist.stage = 'final_four'
  ) and exists (
    select expected.seed, expected.player_id, expected.league_rank
    from (values
      (1::smallint, 'ludi_gmx'::text, 1::smallint),
      (2::smallint, 'ludwig_w'::text, 2::smallint),
      (3::smallint, 'ludi_ionos'::text, 3::smallint),
      (4::smallint, 'ludi_gmail'::text, 4::smallint)
    ) as expected(seed, player_id, league_rank)
    full join public.season_tournament_players as finalist
      on finalist.season_id = test_season_id
     and finalist.stage = 'final_four'
     and finalist.seed = expected.seed
     and finalist.player_id = expected.player_id
     and finalist.league_rank = expected.league_rank
    where expected.seed is null or finalist.seed is null
  ) then
    raise exception 'Bereits vorhandene Test-Finalisten weichen von der erwarteten Rangfolge ab.';
  end if;

  insert into public.season_tournament_players (
    season_id, stage, seed, player_id, league_rank
  ) values
    (test_season_id, 'final_four', 1, 'ludi_gmx', 1),
    (test_season_id, 'final_four', 2, 'ludwig_w', 2),
    (test_season_id, 'final_four', 3, 'ludi_ionos', 3),
    (test_season_id, 'final_four', 4, 'ludi_gmail', 4)
  on conflict (season_id, stage, seed) do nothing;

  select session.match_id, session.started_at
  into first_match_id, first_started_at
  from public.live_match_sessions as session
  join public.matches as match on match.id = session.match_id
  where match.season_id = test_season_id
    and match.competition_stage = 'final_four'
  order by session.started_at, session.match_id
  limit 1;

  if first_match_id is null then
    raise exception 'Für das Test-Final-Four fehlt ein erster Livestart.';
  end if;

  perform private.ensure_final_four_prematch_snapshot(
    test_season_id, first_match_id, first_started_at
  );

  if not exists (
    select 1
    from public.final_four_prematch_snapshots as snapshot
    where snapshot.season_id = test_season_id
      and snapshot.source_match_id = first_match_id
      and snapshot.captured_at = first_started_at
  ) then
    raise exception 'Der Test-Prematch-Snapshot konnte nicht erzeugt werden.';
  end if;
end;
$$;

commit;
