begin;

-- Liefert für die Tippübersicht je Konto die einzelnen Partie- und Bonustipps.
-- Tippwerte erscheinen erst nach Tippschluss; vorher wird nur gemeldet, dass getippt wurde.
-- Die Sichtbarkeit wird bei jedem Aufruf neu geprüft, sodass eine in die Zukunft verschobene
-- Partie ihre Tipps wieder verbirgt. Die Punktelogik entspricht private.get_prediction_leaderboard_rows.
create or replace function public.get_prediction_overview(p_season_id text)
returns table (
  user_id uuid,
  item_type text,
  item_id text,
  prediction text,
  answers text[],
  is_tipped boolean,
  points integer,
  is_passive boolean
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
      match.cancelled_at,
      match.actual_sets is not null
        or match.cancelled_at is not null
        or (match.match_at is not null and match.match_at <= now()) as is_visible,
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
        when cancelled_at is not null or actual_sets is null then null
        when prediction = actual_value then 4
        when predicted_team_one = actual_team_one then 2
        else 0
      end::integer as awarded_points
    from prediction_scores
  ), match_floor as (
    select match_id, min(awarded_points)::integer as awarded_points
    from scored_predictions
    where awarded_points is not null
    group by match_id
  ), bonus_results as materialized (
    select * from private.get_prediction_bonus_results(p_season_id)
  ), bonus_entries as (
    select
      selection.user_id,
      question.id as question_id,
      now() >= question.lock_at as is_visible,
      coalesce(result.resolved, false) as resolved,
      array_agg(selection.answer order by selection.answer) as answers,
      (count(*) filter (
        where coalesce(result.resolved, false)
          and selection.answer = any(result.correct_answers)
      ) * question.points_per_correct)::integer as awarded_points
    from public.prediction_bonus_selections as selection
    join public.prediction_bonus_questions as question on question.id = selection.question_id
    left join bonus_results as result on result.question_type = question.question_type
    where question.season_id = p_season_id
    group by selection.user_id, question.id, question.lock_at, question.points_per_correct, result.resolved
  )
  select
    scored.user_id,
    'match',
    scored.match_id,
    case when scored.is_visible then scored.prediction end,
    null::text[],
    true,
    case when scored.is_visible then scored.awarded_points end,
    false
  from scored_predictions as scored

  union all

  select
    profile.id,
    'match',
    floor.match_id,
    null,
    null::text[],
    false,
    floor.awarded_points,
    true
  from match_floor as floor
  join public.match_players as member on member.match_id = floor.match_id
  join public.profiles as profile on profile.player_id = member.player_id

  union all

  select
    bonus.user_id,
    'bonus',
    bonus.question_id,
    null,
    case when bonus.is_visible then bonus.answers end,
    true,
    case when bonus.is_visible and bonus.resolved then bonus.awarded_points end,
    false
  from bonus_entries as bonus;
$$;

revoke all on function public.get_prediction_overview(text) from public;
grant execute on function public.get_prediction_overview(text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
