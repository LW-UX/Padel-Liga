begin;

-- Im Ein-Satz-Format gibt es 3 Punkte, wenn Sieger und Spieldifferenz stimmen, das Ergebnis aber
-- nicht exakt getroffen ist (etwa 7:5 getippt, 6:4 gespielt). Das gilt auch für den Passiv-Tipp
-- eigener Partien. Solche Tipps zählen als richtiger Sieger; die Rangliste liefert ihre Zahl
-- zusätzlich als near_count, damit die Oberfläche passive Punkte weiterhin herausrechnen kann.
--
-- Der Passiv-Tipp im Ein-Satz-Format wird nach dem Mehrheitsanteil feiner abgestuft:
-- bis unter 60 % 6:4 (auch bei genau 50 % für das eigene Team), bis unter 70 % 6:3,
-- bis unter 80 % 6:2, bis unter 90 % 6:1, ab 90 % 6:0. Best of three bleibt unverändert.

create or replace function private.get_prediction_own_match_tips(p_season_id text)
returns table (
  match_id text,
  team smallint,
  prediction text,
  awarded_points bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with source_predictions as (
    select
      prediction.match_id,
      match.format,
      case when match.format = 'single-set'
        then split_part(prediction.prediction, ':', 1)::integer > split_part(prediction.prediction, ':', 2)::integer
        else prediction.prediction in ('2:0', '2:1')
      end as predicted_team_one
    from public.predictions as prediction
    join public.matches as match on match.id = prediction.match_id
    where match.season_id = p_season_id
      and match.cancelled_at is null
      and match.actual_sets is not null
      and not private.is_benchmark_account(prediction.user_id)
      and not exists (
        select 1
        from public.profiles as own_profile
        join public.match_players as own_member on own_member.player_id = own_profile.player_id
        where own_profile.id = prediction.user_id
          and own_member.match_id = prediction.match_id
      )
  ), match_shares as (
    select
      source.match_id,
      source.format,
      count(*) as tip_count,
      count(*) filter (where source.predicted_team_one) as team_one_count
    from source_predictions as source
    group by source.match_id, source.format
  ), team_tips as (
    select
      share.match_id,
      side.team,
      share.format,
      share.tip_count,
      greatest(share.team_one_count, share.tip_count - share.team_one_count) as majority_count,
      case
        when 2 * share.team_one_count > share.tip_count then 1
        when 2 * share.team_one_count < share.tip_count then 2
        else side.team
      end as winner_team
    from match_shares as share
    cross join (values (1::smallint), (2::smallint)) as side(team)
  ), graded_tips as (
    select
      tip.match_id,
      tip.team,
      tip.winner_team,
      case
        when tip.format = 'single-set' then
          case
            when 10 * tip.majority_count < 6 * tip.tip_count then '6:4'
            when 10 * tip.majority_count < 7 * tip.tip_count then '6:3'
            when 10 * tip.majority_count < 8 * tip.tip_count then '6:2'
            when 10 * tip.majority_count < 9 * tip.tip_count then '6:1'
            else '6:0'
          end
        when 4 * tip.majority_count >= 3 * tip.tip_count then '2:0'
        else '2:1'
      end as winner_score
    from team_tips as tip
  ), named_tips as (
    select
      tip.match_id,
      tip.team,
      case when tip.winner_team = 1
        then tip.winner_score
        else split_part(tip.winner_score, ':', 2) || ':' || split_part(tip.winner_score, ':', 1)
      end as prediction
    from graded_tips as tip
  ), scored_tips as (
    select
      tip.match_id,
      tip.team,
      tip.prediction,
      match.format,
      case when match.format = 'single-set'
        then replace(substring(match.result_details from '([0-9]+\s*:\s*[0-9]+)'), ' ', '')
        else match.actual_sets
      end as actual_value,
      case when match.format = 'single-set'
        then split_part(tip.prediction, ':', 1)::integer > split_part(tip.prediction, ':', 2)::integer
        else tip.prediction in ('2:0', '2:1')
      end as predicted_team_one,
      case when match.format = 'single-set'
        then split_part(replace(substring(match.result_details from '([0-9]+\s*:\s*[0-9]+)'), ' ', ''), ':', 1)::integer
          > split_part(replace(substring(match.result_details from '([0-9]+\s*:\s*[0-9]+)'), ' ', ''), ':', 2)::integer
        else match.actual_sets in ('2:0', '2:1')
      end as actual_team_one
    from named_tips as tip
    join public.matches as match on match.id = tip.match_id
  )
  select
    scored.match_id,
    scored.team,
    scored.prediction,
    case
      when scored.prediction = scored.actual_value then 4
      when scored.format = 'single-set'
        and scored.predicted_team_one = scored.actual_team_one
        and split_part(scored.prediction, ':', 1)::integer - split_part(scored.prediction, ':', 2)::integer
          = split_part(scored.actual_value, ':', 1)::integer - split_part(scored.actual_value, ':', 2)::integer then 3
      when scored.predicted_team_one = scored.actual_team_one then 2
      else 0
    end::bigint as awarded_points
  from scored_tips as scored;
$$;

revoke all on function private.get_prediction_own_match_tips(text) from public;
revoke all on function private.get_prediction_own_match_tips(text) from anon, authenticated;

drop function public.get_prediction_leaderboard(text);
drop function private.get_prediction_leaderboard_rows(text);

create function private.get_prediction_leaderboard_rows(p_season_id text)
returns table (
  user_id uuid,
  display_name text,
  is_player boolean,
  predictions_count bigint,
  scored_count bigint,
  exact_count bigint,
  tendency_count bigint,
  near_count bigint,
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
      match.format,
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
        when format = 'single-set'
          and predicted_team_one = actual_team_one
          and split_part(prediction, ':', 1)::integer - split_part(prediction, ':', 2)::integer
            = split_part(actual_value, ':', 1)::integer - split_part(actual_value, ':', 2)::integer then 3
        when predicted_team_one = actual_team_one then 2
        else 0
      end::bigint as awarded_points
    from prediction_scores
  ), own_match_tips as (
    select * from private.get_prediction_own_match_tips(p_season_id)
  ), leaderboard_entries as (
    select
      scored.user_id,
      scored.match_id,
      true as is_prediction,
      scored.awarded_points is not null as is_scored,
      scored.awarded_points = 4 and scored.prediction = scored.actual_value as is_exact,
      scored.awarded_points in (2, 3) as is_tendency,
      scored.awarded_points = 3 as is_near,
      false as is_passive,
      coalesce(scored.awarded_points, 0)::bigint as awarded_points
    from scored_predictions as scored

    union all

    select
      profile.id,
      own_tip.match_id,
      false,
      true,
      false,
      false,
      false,
      true,
      own_tip.awarded_points
    from own_match_tips as own_tip
    join public.match_players as member
      on member.match_id = own_tip.match_id
     and member.team = own_tip.team
    join public.profiles as profile on profile.player_id = member.player_id
  ), match_totals as (
    select
      entry.user_id,
      count(entry.match_id) filter (where entry.is_prediction) as predictions_count,
      count(entry.match_id) filter (where entry.is_scored) as scored_count,
      count(entry.match_id) filter (where entry.is_exact) as exact_count,
      count(entry.match_id) filter (where entry.is_tendency) as tendency_count,
      count(entry.match_id) filter (where entry.is_near) as near_count,
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
    coalesce(match_totals.near_count, 0),
    coalesce(match_totals.passive_count, 0),
    coalesce(bonus_totals.bonus_points, 0),
    coalesce(match_totals.points, 0) + coalesce(bonus_totals.bonus_points, 0)
  from leaderboard_users
  join public.profiles as profile on profile.id = leaderboard_users.user_id
  left join match_totals on match_totals.user_id = leaderboard_users.user_id
  left join bonus_totals on bonus_totals.user_id = leaderboard_users.user_id;
$$;

revoke all on function private.get_prediction_leaderboard_rows(text) from public;
revoke all on function private.get_prediction_leaderboard_rows(text) from anon, authenticated;

create function public.get_prediction_leaderboard(p_season_id text)
returns table (
  user_id uuid,
  display_name text,
  is_player boolean,
  is_benchmark boolean,
  company text,
  previous_prediction_winner boolean,
  previous_prediction_season_label text,
  previous_prediction_rank integer,
  predictions_count bigint,
  scored_count bigint,
  exact_count bigint,
  tendency_count bigint,
  near_count bigint,
  passive_count bigint,
  bonus_points bigint,
  points bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with current_season as (
    select season.starts_on
    from public.seasons as season
    where season.id = p_season_id
  ), previous_league_season as (
    select season.id, season.label
    from public.seasons as season
    cross join current_season
    where season.id <> p_season_id
      and season.completed_at is not null
      and season.counts_for_profile
      and season.visual_theme <> 'cup'
      and (current_season.starts_on is null or season.starts_on < current_season.starts_on)
    order by season.starts_on desc nulls last, season.completed_at desc, season.id
    limit 1
  ), previous_prediction_winner as (
    select
      previous_entry.user_id,
      previous_season.label as season_label,
      (row_number() over (
        order by
          previous_entry.points desc,
          previous_entry.exact_count desc,
          previous_entry.tendency_count desc,
          previous_entry.display_name asc,
          previous_entry.user_id
      ))::integer as final_rank
    from previous_league_season as previous_season
    cross join lateral private.get_prediction_leaderboard_rows(previous_season.id) as previous_entry
    where not private.is_benchmark_account(previous_entry.user_id)
    order by final_rank
    limit 3
  )
  select
    current_entry.user_id,
    current_entry.display_name,
    current_entry.is_player,
    coalesce(profile.is_benchmark, false),
    case when coalesce(profile.is_benchmark, false) then null else coalesce(player.company, profile.company) end,
    coalesce(previous_winner.final_rank = 1, false),
    previous_winner.season_label,
    previous_winner.final_rank,
    current_entry.predictions_count,
    current_entry.scored_count,
    current_entry.exact_count,
    current_entry.tendency_count,
    current_entry.near_count,
    current_entry.passive_count,
    current_entry.bonus_points,
    current_entry.points
  from private.get_prediction_leaderboard_rows(p_season_id) as current_entry
  left join public.profiles as profile on profile.id = current_entry.user_id
  left join public.players as player on player.id = profile.player_id
  left join previous_prediction_winner as previous_winner
    on previous_winner.user_id = current_entry.user_id
  order by
    current_entry.points desc,
    current_entry.exact_count desc,
    current_entry.tendency_count desc,
    current_entry.display_name asc;
$$;

revoke all on function public.get_prediction_leaderboard(text) from public;
revoke all on function public.get_prediction_leaderboard(text) from anon, authenticated;
grant execute on function public.get_prediction_leaderboard(text) to anon, authenticated;

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
      match.format,
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
        when format = 'single-set'
          and predicted_team_one = actual_team_one
          and split_part(prediction, ':', 1)::integer - split_part(prediction, ':', 2)::integer
            = split_part(actual_value, ':', 1)::integer - split_part(actual_value, ':', 2)::integer then 3
        when predicted_team_one = actual_team_one then 2
        else 0
      end::integer as awarded_points
    from prediction_scores
  ), own_match_tips as (
    select * from private.get_prediction_own_match_tips(p_season_id)
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
    own_tip.match_id,
    null,
    null::text[],
    false,
    own_tip.awarded_points::integer,
    true
  from own_match_tips as own_tip
  join public.match_players as member
    on member.match_id = own_tip.match_id
   and member.team = own_tip.team
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

commit;
