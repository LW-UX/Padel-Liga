begin;

do $$
declare
  summer_id text;
begin
  select season.id into summer_id
  from public.seasons as season
  where season.id in ('2026', '2026-sommer')
    and season.label = 'Sommer 2026'
  for update;
  if summer_id is null then
    raise exception 'Sommer 2026 wurde nicht gefunden.';
  end if;

  perform 1 from public.matches as match
  where match.season_id = summer_id and match.competition_stage = 'final_four'
  order by match.id for update;

  if not exists (
    select 1 from public.final_four_replacements as replacement
    where replacement.season_id = summer_id
      and replacement.original_player_id = 'marco_m'
      and replacement.replacement_player_id = 'ludwig_w'
  ) then
    raise exception 'Die dokumentierte Nachrückung von Marco zu Ludwig fehlt.';
  end if;

  if (
    select jsonb_agg(jsonb_build_array(finalist.seed, finalist.player_id,
      finalist.league_rank) order by finalist.seed)
    from public.season_tournament_players as finalist
    where finalist.season_id = summer_id and finalist.stage = 'final_four'
  ) <> '[[1,"ludwig_w",5],[2,"luca_w",2],[3,"jonas_l",3],[4,"marcel_m",4]]'::jsonb then
    raise exception 'Die bisherige Final-Four-Setzung stimmt nicht mehr.';
  end if;

  if (
    select count(*) from public.matches as match
    where match.season_id = summer_id and match.competition_stage = 'final_four'
  ) <> 3 or (
    select count(*) from public.matches as match
    where match.season_id = summer_id and match.competition_stage = 'final_four'
      and match.id in ('season-2026-partie-28', 'season-2026-partie-29',
        'season-2026-partie-30')
      and match.cancelled_at is null
      and match.actual_sets is null and match.winner is null
      and (
        (match.id = 'season-2026-partie-28'
          and to_jsonb(match.team_one_qualifier_ranks) = '[1,2]'::jsonb
          and to_jsonb(match.team_two_qualifier_ranks) = '[3,4]'::jsonb)
        or (match.id = 'season-2026-partie-29'
          and to_jsonb(match.team_one_qualifier_ranks) = '[1,4]'::jsonb
          and to_jsonb(match.team_two_qualifier_ranks) = '[2,3]'::jsonb)
        or (match.id = 'season-2026-partie-30'
          and to_jsonb(match.team_one_qualifier_ranks) = '[1,3]'::jsonb
          and to_jsonb(match.team_two_qualifier_ranks) = '[2,4]'::jsonb)
      )
  ) <> 3 then
    raise exception 'Die drei offenen Final-Four-Partien entsprechen nicht dem Spielplan.';
  end if;

  if exists (
    select 1 from public.result_proposals as proposal
    join public.matches as match on match.id = proposal.match_id
    where match.season_id = summer_id and match.competition_stage = 'final_four'
  ) or exists (
    select 1 from public.live_match_sessions as session
    join public.matches as match on match.id = session.match_id
    where match.season_id = summer_id and match.competition_stage = 'final_four'
  ) or exists (
    select 1 from public.predictions as prediction
    join public.matches as match on match.id = prediction.match_id
    where match.season_id = summer_id and match.competition_stage = 'final_four'
  ) or exists (
    select 1 from public.final_four_prematch_snapshots as snapshot
    where snapshot.season_id = summer_id
  ) then
    raise exception 'Das Final Four wurde bereits begonnen, getippt oder eingefroren.';
  end if;

  if (
    select count(*) from public.match_players as member
    join public.matches as match on match.id = member.match_id
    where match.season_id = summer_id and match.competition_stage = 'final_four'
  ) <> 12 then
    raise exception 'Die bisherige Spielbesetzung ist unvollständig.';
  end if;

  -- Move seeds out of the way before assigning 1–4 again; preserve the
  -- original league ranks, including Ludwig's fifth place.
  update public.season_tournament_players as finalist
  set seed = finalist.seed + 10
  where finalist.season_id = summer_id and finalist.stage = 'final_four';

  update public.season_tournament_players as finalist
  set seed = case finalist.player_id
    when 'luca_w' then 1
    when 'jonas_l' then 2
    when 'marcel_m' then 3
    when 'ludwig_w' then 4
  end
  where finalist.season_id = summer_id and finalist.stage = 'final_four';

  delete from public.match_players as member
  using public.matches as match
  where match.id = member.match_id
    and match.season_id = summer_id
    and match.competition_stage = 'final_four';

  insert into public.match_players (match_id, player_id, team, position)
  select match.id, finalist.player_id, 1, wanted.ordinality::smallint
  from public.matches as match
  cross join lateral unnest(match.team_one_qualifier_ranks)
    with ordinality as wanted(seed, ordinality)
  join public.season_tournament_players as finalist
    on finalist.season_id = summer_id
   and finalist.stage = 'final_four'
   and finalist.seed = wanted.seed
  where match.season_id = summer_id and match.competition_stage = 'final_four'
  union all
  select match.id, finalist.player_id, 2, wanted.ordinality::smallint
  from public.matches as match
  cross join lateral unnest(match.team_two_qualifier_ranks)
    with ordinality as wanted(seed, ordinality)
  join public.season_tournament_players as finalist
    on finalist.season_id = summer_id
   and finalist.stage = 'final_four'
   and finalist.seed = wanted.seed
  where match.season_id = summer_id and match.competition_stage = 'final_four';

  if (
    select count(*) from public.match_players as member
    join public.matches as match on match.id = member.match_id
    where match.season_id = summer_id and match.competition_stage = 'final_four'
  ) <> 12 then
    raise exception 'Die neuen Final-Four-Partien sind unvollständig.';
  end if;

  update public.matches as match
  set team_one_label = (
        select string_agg(player.display_name, ' / ' order by member.position)
        from public.match_players as member
        join public.players as player on player.id = member.player_id
        where member.match_id = match.id and member.team = 1
      ),
      team_two_label = (
        select string_agg(player.display_name, ' / ' order by member.position)
        from public.match_players as member
        join public.players as player on player.id = member.player_id
        where member.match_id = match.id and member.team = 2
      ),
      updated_at = now()
  where match.season_id = summer_id and match.competition_stage = 'final_four';
end;
$$;

commit;
