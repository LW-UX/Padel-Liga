begin;

-- Eigene Partien werden nicht mehr mit dem schlechtesten Fremdtipp gewertet, sondern mit einem
-- Ersatz-Tipp aus dem gewichteten Durchschnitt aller wertbaren Fremdtipps (ohne Benchmark-Konten
-- und ohne Tipps Beteiligter).
--
-- Best of three: Jeder Tipp zählt mit seinem Satzanteil für Team 1 (2:0 = 1, 2:1 = 2/3,
-- 1:2 = 1/3, 0:2 = 0). Ab 75 % gilt 2:0, über 50 % 2:1, bei genau 50 % tippt jedes Team
-- 2:1 auf sich selbst; spiegelbildlich für Team 2. Gerechnet wird in Dritteln, damit die
-- Grenzen exakt gelten.
--
-- Ein Satz: Jeder Tipp zählt mit seinem Spielanteil für Team 1 (6:2 = 6/8). Der Ersatz-Tipp ist
-- der nächstliegende tippbare Satzstand der Seite mit mehr als 50 %; bei genau 50 % tippt jedes
-- Team 7:6 auf sich selbst.
--
-- Der Ersatz-Tipp wird wie ein normaler Tipp gewertet. Ohne Fremdtipp gibt es keine Gutschrift.
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
      case prediction.prediction
        when '2:0' then 3
        when '2:1' then 2
        when '1:2' then 1
        when '0:2' then 0
      end as team_one_thirds,
      case when match.format = 'single-set'
        then split_part(prediction.prediction, ':', 1)::numeric
          / nullif(split_part(prediction.prediction, ':', 1)::numeric + split_part(prediction.prediction, ':', 2)::numeric, 0)
      end as team_one_game_share
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
  ), match_averages as (
    select
      source.match_id,
      source.format,
      count(*) as tip_count,
      sum(source.team_one_thirds) as team_one_thirds,
      round(avg(source.team_one_game_share), 10) as team_one_game_share
    from source_predictions as source
    group by source.match_id, source.format
  ), team_tips as (
    select
      average.match_id,
      side.team,
      case
        when average.format <> 'single-set' then
          case
            when 4 * average.team_one_thirds >= 9 * average.tip_count then '2:0'
            when 2 * average.team_one_thirds > 3 * average.tip_count then '2:1'
            when 2 * average.team_one_thirds = 3 * average.tip_count
              then case when side.team = 1 then '2:1' else '1:2' end
            when 4 * average.team_one_thirds > 3 * average.tip_count then '1:2'
            else '0:2'
          end
        when average.team_one_game_share = 0.5
          then case when side.team = 1 then '7:6' else '6:7' end
        else (
          select candidate.value
          from (values
            ('6:0'), ('6:1'), ('6:2'), ('6:3'), ('6:4'), ('7:5'), ('7:6'),
            ('0:6'), ('1:6'), ('2:6'), ('3:6'), ('4:6'), ('5:7'), ('6:7')
          ) as candidate(value)
          cross join lateral (
            select split_part(candidate.value, ':', 1)::numeric
              / (split_part(candidate.value, ':', 1)::numeric + split_part(candidate.value, ':', 2)::numeric) as share
          ) as candidate_share
          where (candidate_share.share > 0.5) = (average.team_one_game_share > 0.5)
          order by abs(candidate_share.share - average.team_one_game_share), candidate.value
          limit 1
        )
      end as prediction
    from match_averages as average
    cross join (values (1::smallint), (2::smallint)) as side(team)
  ), scored_tips as (
    select
      tip.match_id,
      tip.team,
      tip.prediction,
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
    from team_tips as tip
    join public.matches as match on match.id = tip.match_id
  )
  select
    scored.match_id,
    scored.team,
    scored.prediction,
    case
      when scored.prediction = scored.actual_value then 4
      when scored.predicted_team_one = scored.actual_team_one then 2
      else 0
    end::bigint as awarded_points
  from scored_tips as scored;
$$;

revoke all on function private.get_prediction_own_match_tips(text) from public;
revoke all on function private.get_prediction_own_match_tips(text) from anon, authenticated;

create or replace function private.get_prediction_leaderboard_rows(p_season_id text)
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
  ), own_match_tips as (
    select * from private.get_prediction_own_match_tips(p_season_id)
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
      own_tip.match_id,
      false,
      true,
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
  left join bonus_totals on bonus_totals.user_id = leaderboard_users.user_id;
$$;

revoke all on function private.get_prediction_leaderboard_rows(text) from public;
revoke all on function private.get_prediction_leaderboard_rows(text) from anon, authenticated;

-- Die Tippseite erhält je Partie und Team den Ersatz-Tipp ohne Kontobezug.
drop function public.get_prediction_match_floors(text);

create function public.get_prediction_match_floors(p_season_id text)
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
  select own_tip.match_id, own_tip.team, own_tip.prediction, own_tip.awarded_points
  from private.get_prediction_own_match_tips(p_season_id) as own_tip
  order by own_tip.match_id, own_tip.team;
$$;

revoke all on function public.get_prediction_match_floors(text) from public;
grant execute on function public.get_prediction_match_floors(text) to anon, authenticated;

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
