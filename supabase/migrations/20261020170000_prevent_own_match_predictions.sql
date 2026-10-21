begin;

drop policy if exists "Users create open predictions" on public.predictions;
create policy "Users create open predictions" on public.predictions for insert to authenticated
with check (
  (select auth.uid()) is not null
  and (select auth.uid()) = user_id
  and not exists (
    select 1
    from public.profiles as profile
    join public.match_players as member on member.player_id = profile.player_id
    where profile.id = (select auth.uid())
      and member.match_id = predictions.match_id
  )
  and exists (
    select 1
    from public.matches as match
    join public.seasons as season on season.id = match.season_id and season.predictions_enabled
    where match.id = match_id
      and match.betting_open
      and match.actual_sets is null
      and (match.match_at is null or match.match_at > now())
      and (
        match.competition_stage = 'league'
        or (
          match.match_at is not null
          and (select count(*) from public.match_players as member where member.match_id = match.id) = 4
        )
      )
  )
);

drop policy if exists "Users update open predictions" on public.predictions;
create policy "Users update open predictions" on public.predictions for update to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.uid()) = user_id
  and not exists (
    select 1
    from public.profiles as profile
    join public.match_players as member on member.player_id = profile.player_id
    where profile.id = (select auth.uid())
      and member.match_id = predictions.match_id
  )
  and exists (
    select 1
    from public.matches as match
    join public.seasons as season on season.id = match.season_id and season.predictions_enabled
    where match.id = match_id
      and match.betting_open
      and match.actual_sets is null
      and (match.match_at is null or match.match_at > now())
  )
)
with check (
  (select auth.uid()) is not null
  and (select auth.uid()) = user_id
  and not exists (
    select 1
    from public.profiles as profile
    join public.match_players as member on member.player_id = profile.player_id
    where profile.id = (select auth.uid())
      and member.match_id = predictions.match_id
  )
  and exists (
    select 1
    from public.matches as match
    join public.seasons as season on season.id = match.season_id and season.predictions_enabled
    where match.id = match_id
      and match.betting_open
      and match.actual_sets is null
      and (match.match_at is null or match.match_at > now())
      and (
        match.competition_stage = 'league'
        or (
          match.match_at is not null
          and (select count(*) from public.match_players as member where member.match_id = match.id) = 4
        )
      )
  )
);

create or replace function public.get_prediction_leaderboard(p_season_id text)
returns table (
  user_id uuid,
  display_name text,
  predictions_count bigint,
  scored_count bigint,
  exact_count bigint,
  tendency_count bigint,
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
      floor.awarded_points
    from match_floor as floor
    join public.match_players as member on member.match_id = floor.match_id
    join public.profiles as profile on profile.player_id = member.player_id
  ), totals as (
    select
      entry.user_id,
      count(entry.match_id) filter (where entry.is_prediction) as predictions_count,
      count(entry.match_id) filter (where entry.is_scored) as scored_count,
      count(entry.match_id) filter (where entry.is_exact) as exact_count,
      count(entry.match_id) filter (where entry.is_tendency) as tendency_count,
      sum(entry.awarded_points)::bigint as points
    from leaderboard_entries as entry
    group by entry.user_id
  )
  select
    profile.id,
    profile.display_name,
    totals.predictions_count,
    totals.scored_count,
    totals.exact_count,
    totals.tendency_count,
    totals.points
  from totals
  join public.profiles as profile on profile.id = totals.user_id
  order by totals.points desc, totals.exact_count desc, totals.tendency_count desc, profile.display_name asc;
$$;

create or replace function public.submit_match_quick_prediction(
  p_match_id text,
  p_prediction text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  selected_match record;
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  if not private.user_email_is_confirmed(current_user_id) then
    raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen.';
  end if;
  if p_prediction is null or p_prediction not in ('2:0', '2:1', '1:2', '0:2') then
    raise exception 'Ungültiger Tipp.';
  end if;

  if exists (
    select 1
    from public.profiles as profile
    join public.match_players as member on member.player_id = profile.player_id
    where profile.id = current_user_id
      and member.match_id = p_match_id
  ) then
    raise exception 'Eigene Partien können nicht getippt werden.';
  end if;

  select match.* into selected_match
  from public.matches as match
  where match.id = p_match_id
  for update of match;
  if not found then raise exception 'Partie nicht gefunden.'; end if;

  if private.match_forecast_mode(p_match_id) is distinct from 'preview'
    or not selected_match.betting_open
    or selected_match.winner is not null
    or selected_match.actual_sets is not null then
    raise exception 'Für diese Partie ist kein Tipp geöffnet.';
  end if;
  if selected_match.match_at is not null and selected_match.match_at <= now() then
    raise exception 'Die Tippabgabe ist bereits beendet.';
  end if;

  insert into public.predictions(user_id, match_id, prediction)
  values (current_user_id, p_match_id, p_prediction)
  on conflict (user_id, match_id) do update
    set prediction = excluded.prediction,
        updated_at = now();

  return private.get_match_forecast_state(p_match_id, current_user_id);
end;
$$;

create or replace function public.submit_match_quick_prediction(
  p_match_id text,
  p_team smallint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_team is null or p_team not in (1, 2) then raise exception 'Ungültiges Team.'; end if;
  return public.submit_match_quick_prediction(
    p_match_id,
    case when p_team = 1 then '2:0' else '0:2' end
  );
end;
$$;

revoke all on function public.get_prediction_leaderboard(text) from public;
revoke all on function public.submit_match_quick_prediction(text,text) from public, anon;
revoke all on function public.submit_match_quick_prediction(text,smallint) from public, anon;
grant execute on function public.get_prediction_leaderboard(text) to anon, authenticated;
grant execute on function public.submit_match_quick_prediction(text,text) to authenticated;
grant execute on function public.submit_match_quick_prediction(text,smallint) to authenticated;

notify pgrst, 'reload schema';

commit;
