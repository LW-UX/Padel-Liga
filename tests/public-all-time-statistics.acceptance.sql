begin;
set local role anon;

with payload as (
  select public.get_public_all_time_statistics() as value
), returned_matches as (
  select item
  from payload
  cross join lateral jsonb_array_elements(value -> 'matches') as item
), returned_players as (
  select item
  from payload
  cross join lateral jsonb_array_elements(value -> 'players') as item
)
select jsonb_build_object(
  'anonymousExecute', has_function_privilege(
    current_user,
    'public.get_public_all_time_statistics()',
    'EXECUTE'
  ),
  'playerCount', (select count(*) from returned_players),
  'matchCount', (select count(*) from returned_matches),
  'seasonIds', coalesce((
    select jsonb_agg(season_id order by season_id)
    from (
      select distinct item ->> 'seasonId' as season_id
      from returned_matches
    ) as seasons
  ), '[]'::jsonb),
  'stages', coalesce((
    select jsonb_object_agg(stage, match_count order by stage)
    from (
      select item ->> 'stage' as stage, count(*) as match_count
      from returned_matches
      group by item ->> 'stage'
    ) as stage_counts
  ), '{}'::jsonb),
  'cupCompletedMatches', (
    select count(*) from returned_matches where item ->> 'seasonId' = 'cup-2027'
  ),
  'eligibleSourceStages', coalesce((
    select jsonb_object_agg(stage, match_count order by stage)
    from (
      select replace(match.competition_stage, '_', '-') as stage, count(*) as match_count
      from public.matches as match
      join public.seasons as season
        on season.id = match.season_id
       and season.counts_for_profile
      where match.match_type in ('season', 'final')
        and match.actual_sets is not null
        and match.winner is not null
      group by replace(match.competition_stage, '_', '-')
    ) as source_stage_counts
  ), '{}'::jsonb),
  'scheduledOfficialStages', coalesce((
    select jsonb_object_agg(stage, match_count order by stage)
    from (
      select replace(match.competition_stage, '_', '-') as stage, count(*) as match_count
      from public.matches as match
      join public.seasons as season
        on season.id = match.season_id
       and season.counts_for_profile
      where match.match_type in ('season', 'final')
      group by replace(match.competition_stage, '_', '-')
    ) as source_stage_counts
  ), '{}'::jsonb),
  'includedTrainingMatches', (
    select count(*)
    from returned_matches as returned
    join public.matches as source on source.id = returned.item ->> 'id'
    where source.match_type = 'training'
  ),
  'includedTestSeasonMatches', (
    select count(*)
    from returned_matches as returned
    join public.matches as source on source.id = returned.item ->> 'id'
    join public.seasons as season on season.id = source.season_id
    where not season.counts_for_profile
  ),
  'includedOpenMatches', (
    select count(*)
    from returned_matches as returned
    join public.matches as source on source.id = returned.item ->> 'id'
    where source.actual_sets is null or source.winner is null
  ),
  'playersWithoutReturnedMatch', (
    select count(*)
    from returned_players as player
    where not exists (
      select 1
      from returned_matches as match
      where (match.item #> '{team1,playerIds}') ? (player.item ->> 'playerId')
         or (match.item #> '{team2,playerIds}') ? (player.item ->> 'playerId')
    )
  ),
  'playersWithWrongInitialCount', (
    select count(*)
    from returned_players as player
    where (
      select count(*)
      from jsonb_array_elements(player.item -> 'eloHistory') as event
      where event ->> 'eventType' = 'initial'
    ) <> 1
  ),
  'unexpectedEloEventTypes', (
    select count(*)
    from returned_players as player
    cross join lateral jsonb_array_elements(player.item -> 'eloHistory') as event
    where event ->> 'eventType' not in ('initial', 'match')
  )
) as acceptance;

rollback;
