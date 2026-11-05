begin;

-- Nur in der nicht öffentlichen Test-Saison wird die Final-Four-Bonusfrage bereits ausgewertet,
-- sobald die vier Finalisten hinterlegt sind, auch wenn noch Ligapartien offen sind.
-- Alle anderen Saisons behalten unverändert Halbfinal-Sieger beziehungsweise Qualifikationsauszeichnungen.
create or replace function private.get_prediction_bonus_results(p_season_id text)
returns table (
  question_type text,
  resolved boolean,
  correct_answers text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with base_results as materialized (
    select *
    from private.get_prediction_bonus_results_without_direct_final_four(p_season_id)
  ), semifinal_status as (
    select count(*)::integer as match_count
    from public.matches as match
    where match.season_id = p_season_id
      and match.competition_stage = 'semifinal'
  ), direct_qualification as (
    select
      count(distinct achievement.player_id) = 4 as complete,
      coalesce(
        array_agg(distinct achievement.player_id order by achievement.player_id),
        '{}'::text[]
      ) as correct_answers
    from public.player_achievements as achievement
    where achievement.season_id = p_season_id
      and achievement.kind in ('winner', 'final_four')
  ), tournament_finalists as (
    select
      count(distinct finalist.player_id) = 4 as complete,
      coalesce(
        array_agg(distinct finalist.player_id order by finalist.player_id),
        '{}'::text[]
      ) as correct_answers
    from public.season_tournament_players as finalist
    where p_season_id = 'test-2026'
      and finalist.season_id = p_season_id
      and finalist.stage = 'final_four'
  ), base_final_four as (
    select result.resolved, result.correct_answers
    from base_results as result
    where result.question_type = 'final_four_players'
  )
  select result.question_type, result.resolved, result.correct_answers
  from base_results as result
  where result.question_type <> 'final_four_players'

  union all

  select
    'final_four_players'::text,
    case
      when semifinal_status.match_count > 0 then base_final_four.resolved
      when direct_qualification.complete then true
      else tournament_finalists.complete
    end,
    case
      when semifinal_status.match_count > 0 then base_final_four.correct_answers
      when direct_qualification.complete then direct_qualification.correct_answers
      when tournament_finalists.complete then tournament_finalists.correct_answers
      else '{}'::text[]
    end
  from semifinal_status
  cross join direct_qualification
  cross join tournament_finalists
  cross join base_final_four;
$$;

revoke all on function private.get_prediction_bonus_results(text) from public, anon, authenticated;

commit;
