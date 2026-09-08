begin;

create or replace function private.profile_training_metrics(p_result_details text)
returns integer[]
language sql
immutable
set search_path = ''
as $$
  with source as (
    select
      parts[1] as regular_result,
      parts[2] as match_tiebreak_result
    from (
      select regexp_split_to_array(
        regexp_replace(coalesce(p_result_details, ''), '\([^)]*\)', '', 'g'),
        '\s*[–-]\s*'
      ) as parts
    ) as parsed
  ), scores as (
    select
      (capture)[1]::integer as team_one,
      (capture)[2]::integer as team_two
    from source,
      regexp_matches(regular_result, '([0-9]+)\s*:\s*([0-9]+)', 'g') as score(capture)
  ), completed as (
    select *
    from scores
    where private.training_regular_set_state(team_one, team_two) = 'complete'
  ), set_summary as (
    select
      count(*)::integer as completed_count,
      count(*) filter (where team_one > team_two)::integer as team_one_wins,
      count(*) filter (where team_two > team_one)::integer as team_two_wins,
      coalesce(sum(team_one), 0)::integer as team_one_games,
      coalesce(sum(team_two), 0)::integer as team_two_games
    from completed
  ), match_tiebreak as (
    select
      (capture)[1]::integer as team_one,
      (capture)[2]::integer as team_two
    from source
    left join lateral regexp_matches(
      coalesce(source.match_tiebreak_result, ''),
      '^\s*([0-9]+)\s*:\s*([0-9]+)\s*$'
    ) as score(capture) on true
  ), resolved as (
    select
      set_summary.*,
      match_tiebreak.team_one as match_tiebreak_team_one,
      match_tiebreak.team_two as match_tiebreak_team_two,
      set_summary.completed_count = 2
        and set_summary.team_one_wins = 1
        and set_summary.team_two_wins = 1
        and private.training_tiebreak_state(
          match_tiebreak.team_one,
          match_tiebreak.team_two,
          10
        ) = 'complete' as has_deciding_match_tiebreak
    from set_summary
    cross join match_tiebreak
  )
  select array[
    completed_count,
    case
      when has_deciding_match_tiebreak then case when match_tiebreak_team_one > match_tiebreak_team_two then 2 else 0 end
      else team_one_wins
    end,
    case
      when has_deciding_match_tiebreak then case when match_tiebreak_team_two > match_tiebreak_team_one then 2 else 0 end
      else team_two_wins
    end,
    team_one_games,
    team_two_games
  ]
  from resolved;
$$;

notify pgrst, 'reload schema';

commit;
