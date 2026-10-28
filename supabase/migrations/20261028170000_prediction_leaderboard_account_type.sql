begin;

drop function public.get_prediction_leaderboard(text);

create function public.get_prediction_leaderboard(p_season_id text)
returns table (
  user_id uuid,
  display_name text,
  is_player boolean,
  predictions_count bigint,
  scored_count bigint,
  exact_count bigint,
  tendency_count bigint,
  passive_count bigint,
  bonus_points bigint,
  points bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with prediction_scores as (
    select
      prediction.user_id,
      prediction.match_id,
      prediction.prediction,
      match.actual_sets,
      case when match.format = 'single-set'
        then replace(substring(match.result_details from '([0-9]+\s*:\s*[0-9]+)'), ' ', '')
        else match.actual_sets
      end as actual_value,
      case when match.format = 'single-set'
        then split_part(prediction.prediction, ':', 1)::integer > split_part(prediction.prediction, ':', 2)::integer
        else prediction.prediction in ('2:0', '2:1')
      end as predicted_team_one,
      case when match.format = 'single-set'
        then split_part(replace(substring(match.result_details from '([0-9]+\s*:\s*[0-9]+)'), ' ', ''), ':', 1)::integer
          > split_part(replace(substring(match.result_details from '([0-9]+\s*:\s*[0-9]+)'), ' ', ''), ':', 2)::integer
        else match.actual_sets in ('2:0', '2:1')
      end as actual_team_one
    from public.predictions as prediction
    join public.matches as match on match.id = prediction.match_id
    where match.season_id = p_season_id
      and match.cancelled_at is null
      and not exists (
        select 1
        from public.profiles as own_profile
        join public.match_players as own_member on own_member.player_id = own_profile.player_id
        where own_profile.id = prediction.user_id
          and own_member.match_id = prediction.match_id
      )
  ), scored_predictions as (
    select
      prediction_scores.*,
      case
        when actual_sets is null then null
        when prediction = actual_value then 4
        when predicted_team_one = actual_team_one then 2
        else 0
      end::bigint as awarded_points
    from prediction_scores
  ), match_floor as (
    select match_id, min(awarded_points)::bigint as awarded_points
    from scored_predictions
    where awarded_points is not null
    group by match_id
  ), leaderboard_entries as (
    select
      scored.user_id,
      scored.match_id,
      true as is_prediction,
      scored.awarded_points is not null as is_scored,
      scored.awarded_points = 4 and scored.prediction = scored.actual_value as is_exact,
      scored.awarded_points = 2 as is_tendency,
      false as is_passive,
      coalesce(scored.awarded_points, 0)::bigint as awarded_points
    from scored_predictions as scored

    union all

    select
      profile.id,
      floor.match_id,
      false,
      true,
      false,
      false,
      true,
      floor.awarded_points
    from match_floor as floor
    join public.match_players as member on member.match_id = floor.match_id
    join public.profiles as profile on profile.player_id = member.player_id
  ), match_totals as (
    select
      entry.user_id,
      count(entry.match_id) filter (where entry.is_prediction) as predictions_count,
      count(entry.match_id) filter (where entry.is_scored) as scored_count,
      count(entry.match_id) filter (where entry.is_exact) as exact_count,
      count(entry.match_id) filter (where entry.is_tendency) as tendency_count,
      count(entry.match_id) filter (where entry.is_passive) as passive_count,
      sum(entry.awarded_points)::bigint as points
    from leaderboard_entries as entry
    group by entry.user_id
  ), bonus_results as materialized (
    select * from private.get_prediction_bonus_results(p_season_id)
  ), bonus_totals as (
    select
      selection.user_id,
      count(distinct selection.question_id)::bigint as predictions_count,
      coalesce(sum(case
        when result.resolved and selection.answer = any(result.correct_answers)
          then question.points_per_correct
        else 0
      end), 0)::bigint as bonus_points
    from public.prediction_bonus_selections as selection
    join public.prediction_bonus_questions as question on question.id = selection.question_id
    join bonus_results as result on result.question_type = question.question_type
    where question.season_id = p_season_id
    group by selection.user_id
  ), leaderboard_users as (
    select user_id from match_totals
    union
    select user_id from bonus_totals
  )
  select
    profile.id,
    profile.display_name,
    profile.player_id is not null,
    coalesce(match_totals.predictions_count, 0) + coalesce(bonus_totals.predictions_count, 0),
    coalesce(match_totals.scored_count, 0),
    coalesce(match_totals.exact_count, 0),
    coalesce(match_totals.tendency_count, 0),
    coalesce(match_totals.passive_count, 0),
    coalesce(bonus_totals.bonus_points, 0),
    coalesce(match_totals.points, 0) + coalesce(bonus_totals.bonus_points, 0)
  from leaderboard_users
  join public.profiles as profile on profile.id = leaderboard_users.user_id
  left join match_totals on match_totals.user_id = leaderboard_users.user_id
  left join bonus_totals on bonus_totals.user_id = leaderboard_users.user_id
  order by
    coalesce(match_totals.points, 0) + coalesce(bonus_totals.bonus_points, 0) desc,
    coalesce(match_totals.exact_count, 0) desc,
    coalesce(match_totals.tendency_count, 0) desc,
    profile.display_name asc;
$$;

revoke all on function public.get_prediction_leaderboard(text) from public;
revoke all on function public.get_prediction_leaderboard(text) from anon, authenticated;
grant execute on function public.get_prediction_leaderboard(text) to anon, authenticated;

commit;
