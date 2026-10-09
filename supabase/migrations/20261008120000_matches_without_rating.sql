begin;

alter table public.matches
  add column if not exists cancelled_at timestamptz;

alter function public.get_public_season(text) set schema private;
alter function private.get_public_season(text) rename to get_public_season_base_without_cancellation;

create function public.get_public_season(p_season_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select private.get_public_season_base_without_cancellation(p_season_id) as payload
  )
  select case when base.payload is null then null else jsonb_set(
    base.payload,
    '{matches}',
    coalesce((
      select jsonb_agg(
        item.value || jsonb_build_object('cancelledAt', match.cancelled_at)
        order by item.ordinality
      )
      from jsonb_array_elements(coalesce(base.payload -> 'matches', '[]'::jsonb))
        with ordinality as item(value, ordinality)
      left join public.matches as match on match.id = item.value ->> 'id'
    ), '[]'::jsonb)
  ) end
  from base;
$$;

revoke all on function private.get_public_season_base_without_cancellation(text) from public, anon, authenticated;
revoke all on function public.get_public_season(text) from public;
grant execute on function public.get_public_season(text) to anon, authenticated;

alter function public.get_player_profile(text) set schema private;
alter function private.get_player_profile(text) rename to get_player_profile_base_without_cancellation;

create function public.get_player_profile(p_player_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select private.get_player_profile_base_without_cancellation(p_player_id) as payload
  )
  select case when base.payload is null then null else jsonb_set(
    base.payload,
    '{matches}',
    coalesce((
      select jsonb_agg(
        item.value || jsonb_build_object('isCancelled', match.cancelled_at is not null)
        order by item.ordinality
      )
      from jsonb_array_elements(coalesce(base.payload -> 'matches', '[]'::jsonb))
        with ordinality as item(value, ordinality)
      left join public.matches as match on match.id = item.value ->> 'id'
    ), '[]'::jsonb)
  ) end
  from base;
$$;

revoke all on function private.get_player_profile_base_without_cancellation(text) from public, anon, authenticated;
revoke execute on function public.get_player_profile(text) from public;
grant execute on function public.get_player_profile(text) to anon, authenticated;

alter table public.matches drop constraint if exists matches_cancelled_without_rating_check;
alter table public.matches add constraint matches_cancelled_without_rating_check check (
  cancelled_at is null or (
    competition_stage = 'league'
    and result_details is null
    and actual_sets is null
    and winner is null
    and not counts_for_ranking
    and not counts_for_elo
    and not betting_open
  )
);

create or replace function private.protect_cancelled_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.cancelled_at is not null and (
    new.cancelled_at is distinct from old.cancelled_at
    or new.match_at is distinct from old.match_at
    or new.result_details is distinct from old.result_details
    or new.actual_sets is distinct from old.actual_sets
    or new.winner is distinct from old.winner
    or new.counts_for_ranking is distinct from old.counts_for_ranking
    or new.counts_for_elo is distinct from old.counts_for_elo
    or new.betting_open is distinct from old.betting_open
  ) then
    raise exception 'Diese Partie wurde endgültig aus der Wertung genommen.';
  end if;
  return new;
end;
$$;

drop trigger if exists matches_protect_cancelled on public.matches;
create trigger matches_protect_cancelled
before update of cancelled_at, match_at, result_details, actual_sets, winner,
  counts_for_ranking, counts_for_elo, betting_open on public.matches
for each row execute function private.protect_cancelled_match();

create or replace function private.reject_cancelled_match_proposal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.matches as match
    where match.id = new.match_id and match.cancelled_at is not null
  ) then
    raise exception 'Diese Partie wurde aus der Wertung genommen.';
  end if;
  return new;
end;
$$;

drop trigger if exists result_proposals_reject_cancelled_match on public.result_proposals;
create trigger result_proposals_reject_cancelled_match
before insert or update of match_id on public.result_proposals
for each row execute function private.reject_cancelled_match_proposal();

create or replace function private.reject_cancelled_live_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.matches as match
    where match.id = new.match_id and match.cancelled_at is not null
  ) then
    raise exception 'Für diese Partie kann kein Liveticker mehr gestartet werden.';
  end if;
  return new;
end;
$$;

drop trigger if exists live_match_sessions_reject_cancelled_match on public.live_match_sessions;
create trigger live_match_sessions_reject_cancelled_match
before insert or update of match_id on public.live_match_sessions
for each row execute function private.reject_cancelled_live_session();

create or replace function public.cancel_match(p_match_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_profile record;
  selected_match record;
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  if not private.user_email_is_confirmed(current_user_id) then
    raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen.';
  end if;

  select profile.* into current_profile
  from public.profiles as profile
  where profile.id = current_user_id;
  if not found or current_profile.app_role is distinct from 'admin' then
    raise exception 'Nur Admins dürfen Partien aus der Wertung nehmen.';
  end if;

  select match.* into selected_match
  from public.matches as match
  join public.seasons as season on season.id = match.season_id
  where match.id = p_match_id and season.results_entry_enabled
  for update of match;
  if not found then raise exception 'Partie nicht gefunden.'; end if;
  if selected_match.competition_stage <> 'league' then
    raise exception 'Nur Ligapartien können aus der Wertung genommen werden.';
  end if;
  if selected_match.cancelled_at is not null then
    raise exception 'Diese Partie wurde bereits aus der Wertung genommen.';
  end if;
  if selected_match.actual_sets is not null
    or selected_match.winner is not null
    or selected_match.result_details is not null then
    raise exception 'Die Partie besitzt bereits ein offizielles Ergebnis.';
  end if;
  if exists (
    select 1 from public.result_proposals as proposal
    where proposal.match_id = p_match_id and proposal.status = 'pending'
  ) then
    raise exception 'Für diese Partie wartet bereits ein Ergebnis auf Bestätigung.';
  end if;
  if exists (
    select 1 from public.live_match_sessions as session
    where session.match_id = p_match_id
      and session.status in ('live', 'needs_server', 'ready_to_finish')
  ) then
    raise exception 'Der laufende Liveticker muss zuerst verworfen werden.';
  end if;

  update public.matches
  set
    cancelled_at = now(),
    counts_for_ranking = false,
    counts_for_elo = false,
    betting_open = false
  where id = p_match_id;

  perform private.advance_season_tournament(selected_match.season_id);
  perform private.try_complete_season(selected_match.season_id);
end;
$$;

revoke execute on function public.cancel_match(text) from public, anon;
grant execute on function public.cancel_match(text) to authenticated;

create or replace function private.try_complete_season(p_season_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_season record;
  season_end_at timestamptz;
  match_count integer;
  open_match_count integer;
  incomplete_team_count integer;
  league_count integer;
  quarterfinal_count integer;
  semifinal_count integer;
  final_four_count integer;
  final_count integer;
begin
  select season.* into selected_season
  from public.seasons as season
  where season.id = p_season_id
  for update;

  if not found
    or selected_season.completed_at is not null
    or not selected_season.counts_for_profile
    or not selected_season.regular_schedule_locked then
    return false;
  end if;

  select
    count(*),
    count(*) filter (
      where match.cancelled_at is null
        and (match.actual_sets is null or match.winner is null or match.match_at is null)
    ),
    count(*) filter (
      where match.cancelled_at is null and (
        select count(*) from public.match_players as member where member.match_id = match.id
      ) <> 4
    ),
    count(*) filter (where match.competition_stage = 'league'),
    count(*) filter (where match.competition_stage = 'quarterfinal'),
    count(*) filter (where match.competition_stage = 'semifinal'),
    count(*) filter (where match.competition_stage = 'final_four'),
    count(*) filter (where match.competition_stage = 'final')
  into match_count, open_match_count, incomplete_team_count,
    league_count, quarterfinal_count, semifinal_count, final_four_count, final_count
  from public.matches as match
  where match.season_id = p_season_id;

  if match_count = 0 or open_match_count > 0 or incomplete_team_count > 0 then
    return false;
  end if;

  if selected_season.tournament_mode = 'direct_final_four'
    and (league_count = 0 or final_four_count <> 3) then
    return false;
  elsif selected_season.tournament_mode = 'top8_semifinals'
    and (league_count = 0 or semifinal_count <> 2 or final_four_count <> 3) then
    return false;
  elsif selected_season.tournament_mode = 'knockout_redraw'
    and (quarterfinal_count <> 4 or semifinal_count <> 2 or final_count <> 1) then
    return false;
  end if;

  select max(match.match_at) into season_end_at
  from public.matches as match
  where match.season_id = p_season_id and match.cancelled_at is null;

  update public.season_players as participant
  set end_elo = coalesce((
    select change.new_elo
    from public.match_elo_changes as change
    join public.matches as match on match.id = change.match_id
    join public.seasons as season
      on season.id = match.season_id
     and season.counts_for_profile
    where change.player_id = participant.player_id
      and match.counts_for_elo
      and match.match_at <= season_end_at
    order by match.match_at desc, match.id desc
    limit 1
  ), (
    select player.initial_elo
    from public.players as player
    where player.id = participant.player_id
  ), participant.start_elo)
  where participant.season_id = p_season_id;

  update public.seasons
  set
    completed_at = now(),
    elo_final_date = (season_end_at at time zone 'Europe/Berlin')::date,
    results_entry_enabled = false
  where id = p_season_id;

  return true;
end;
$$;

drop function if exists public.get_my_result_tasks(text);
create function public.get_my_result_tasks(p_season_id text default null)
returns table (
  match_id text,
  season_id text,
  season_label text,
  league_id text,
  league_label text,
  matchday integer,
  match_format text,
  competition_stage text,
  match_at timestamptz,
  team_one_label text,
  team_two_label text,
  my_team smallint,
  task_type text,
  is_open boolean,
  proposal_id bigint,
  proposed_result text,
  proposed_sets text,
  proposed_winner smallint,
  proposed_match_at timestamptz,
  official_result text,
  official_sets text
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select profile.id, profile.player_id, profile.app_role
    from public.profiles as profile where profile.id = (select auth.uid())
  ), pending as (
    select proposal.* from public.result_proposals as proposal where proposal.status = 'pending'
  ), task_matches as (
    select match.*, season.label as season_label, league.label as league_label,
      member.team as my_team, me.app_role,
      pending.id as proposal_id, pending.proposed_by_team,
      pending.result_details as proposed_result,
      pending.actual_sets as proposed_sets,
      pending.winner as proposed_winner,
      pending.match_at as proposed_match_at,
      case
        when match.actual_sets is not null then false
        when pending.id is not null then true
        when match.match_at is null then false
        else match.match_at <= now()
      end as is_open
    from public.matches as match
    join public.seasons as season on season.id = match.season_id and season.results_entry_enabled
    join public.leagues as league on league.season_id = match.season_id and league.id = match.league_id
    cross join me
    left join public.match_players as member
      on member.match_id = match.id and member.player_id = me.player_id
    left join pending on pending.match_id = match.id
    where match.cancelled_at is null
      and (p_season_id is null or match.season_id = p_season_id)
      and (me.app_role = 'admin' or member.player_id is not null)
  )
  select task_match.id, task_match.season_id, task_match.season_label,
    task_match.league_id, task_match.league_label, task_match.matchday,
    task_match.format, task_match.competition_stage, task_match.match_at,
    task_match.team_one_label, task_match.team_two_label, task_match.my_team,
    case
      when task_match.actual_sets is not null then 'completed'
      when task_match.proposal_id is null then 'enter'
      when task_match.app_role = 'admin' or task_match.proposed_by_team <> task_match.my_team then 'review'
      else 'waiting'
    end,
    task_match.is_open, task_match.proposal_id,
    task_match.proposed_result, task_match.proposed_sets, task_match.proposed_winner,
    task_match.proposed_match_at, task_match.result_details, task_match.actual_sets
  from task_matches as task_match
  order by task_match.match_at nulls last, task_match.id;
$$;

revoke execute on function public.get_my_result_tasks(text) from public, anon;
grant execute on function public.get_my_result_tasks(text) to authenticated;

create or replace view private.player_profile_match_rows as
select
  member.player_id,
  match.id as row_id,
  case when match.competition_stage = 'final_four' then 'final-four' else 'league' end::text as kind,
  (match.match_at at time zone 'Europe/Berlin')::date as played_on,
  to_char(match.match_at at time zone 'Europe/Berlin', 'HH24.MI') as display_time,
  match.season_id,
  season.label as season_label,
  member.team,
  match.result_details,
  case
    when match.cancelled_at is not null then 'unfinished'
    when match.winner = member.team then 'win'
    else 'loss'
  end::text as outcome,
  coalesce((
    select array_agg(player.display_name order by teammate.position)
    from public.match_players as teammate
    join public.players as player on player.id = teammate.player_id
    where teammate.match_id = match.id and teammate.team = member.team
      and teammate.player_id <> member.player_id
  ), '{}')::text[] as partner_names,
  coalesce((
    select array_agg(player.display_name order by opponent.position)
    from public.match_players as opponent
    join public.players as player on player.id = opponent.player_id
    where opponent.match_id = match.id and opponent.team <> member.team
  ), '{}')::text[] as opponent_names,
  case
    when match.cancelled_at is not null then 0
    when member.team = 1 then (private.profile_regular_game_totals(match.result_details))[1]
    else (private.profile_regular_game_totals(match.result_details))[2]
  end as games_for,
  case
    when match.cancelled_at is not null then 0
    when member.team = 1 then (private.profile_regular_game_totals(match.result_details))[2]
    else (private.profile_regular_game_totals(match.result_details))[1]
  end as games_against,
  case
    when not match.counts_for_ranking then 0
    when member.team = 1 and match.actual_sets = '2:0' then 3
    when member.team = 1 and match.actual_sets = '2:1' then 2
    when member.team = 1 and match.actual_sets = '1:2' then 1
    when member.team = 2 and match.actual_sets = '0:2' then 3
    when member.team = 2 and match.actual_sets = '1:2' then 2
    when member.team = 2 and match.actual_sets = '2:1' then 1
    else 0
  end as points,
  match.counts_for_ranking,
  match.cancelled_at is null as is_complete,
  null::bigint as training_session_id,
  null::integer as training_round_number
from public.matches as match
join public.seasons as season on season.id = match.season_id and season.counts_for_profile
join public.match_players as member on member.match_id = match.id
where (
    (match.actual_sets is not null and match.winner is not null)
    or match.cancelled_at is not null
  )
  and match.match_type in ('season', 'final')

union all

select
  participant.player_id,
  'training-' || session.id || '-' || round.round_number,
  'training'::text,
  session.played_on,
  to_char(session.display_time, 'HH24.MI'),
  null::text,
  'Training'::text,
  case when participant.player_id = any(round.team_one_ids) then 1 else 2 end::smallint,
  round.result_details,
  case
    when not round.is_complete then 'unfinished'
    when (private.profile_set_win_totals(round.result_details, round.set_count))[1]
       = (private.profile_set_win_totals(round.result_details, round.set_count))[2] then 'draw'
    when participant.player_id = any(round.team_one_ids)
      then case when (private.profile_set_win_totals(round.result_details, round.set_count))[1]
                   > (private.profile_set_win_totals(round.result_details, round.set_count))[2]
                then 'win' else 'loss' end
    else case when (private.profile_set_win_totals(round.result_details, round.set_count))[2]
                 > (private.profile_set_win_totals(round.result_details, round.set_count))[1]
              then 'win' else 'loss' end
  end::text,
  coalesce((
    select array_agg(player.display_name order by member.ordinality)
    from unnest(case when participant.player_id = any(round.team_one_ids)
      then round.team_one_ids else round.team_two_ids end)
      with ordinality as member(player_id, ordinality)
    join public.players as player on player.id = member.player_id
    where member.player_id <> participant.player_id
  ), '{}')::text[],
  coalesce((
    select array_agg(player.display_name order by member.ordinality)
    from unnest(case when participant.player_id = any(round.team_one_ids)
      then round.team_two_ids else round.team_one_ids end)
      with ordinality as member(player_id, ordinality)
    join public.players as player on player.id = member.player_id
  ), '{}')::text[],
  case when participant.player_id = any(round.team_one_ids)
    then (private.profile_regular_game_totals(round.result_details))[1]
    else (private.profile_regular_game_totals(round.result_details))[2] end,
  case when participant.player_id = any(round.team_one_ids)
    then (private.profile_regular_game_totals(round.result_details))[2]
    else (private.profile_regular_game_totals(round.result_details))[1] end,
  0,
  false,
  round.is_complete,
  session.id,
  round.round_number
from public.training_sessions as session
join public.training_rounds as round on round.session_id = session.id
cross join lateral unnest(session.player_ids) as participant(player_id)
where session.status = 'confirmed';

create or replace function private.profile_match_weight(
  p_kind text,
  p_result_details text
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kind = 'training' then (private.profile_training_metrics(p_result_details))[1] * 0.5::numeric
    when p_result_details is null then 0::numeric
    when p_kind = 'final-four' then 0.5::numeric
    else 1::numeric
  end;
$$;

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
  with scored as (
    select
      prediction.user_id,
      prediction.match_id,
      prediction.prediction,
      match.format,
      match.actual_sets,
      case when match.format = 'single-set'
        then substring(match.result_details from '([0-9]+\s*:\s*[0-9]+)')
        else match.actual_sets
      end as actual_value,
      case when match.format = 'single-set'
        then split_part(prediction.prediction, ':', 1)::integer > split_part(prediction.prediction, ':', 2)::integer
        else prediction.prediction in ('2:0', '2:1')
      end as predicted_team_one,
      case when match.format = 'single-set'
        then split_part(substring(match.result_details from '([0-9]+\s*:\s*[0-9]+)'), ':', 1)::integer
          > split_part(substring(match.result_details from '([0-9]+\s*:\s*[0-9]+)'), ':', 2)::integer
        else match.actual_sets in ('2:0', '2:1')
      end as actual_team_one
    from public.predictions as prediction
    join public.matches as match on match.id = prediction.match_id
    where match.season_id = p_season_id and match.cancelled_at is null
  )
  select
    profile.id,
    profile.display_name,
    count(scored.match_id),
    count(scored.match_id) filter (where scored.actual_sets is not null),
    count(scored.match_id) filter (where scored.actual_sets is not null and scored.prediction = scored.actual_value),
    count(scored.match_id) filter (
      where scored.actual_sets is not null
        and scored.prediction <> scored.actual_value
        and scored.predicted_team_one = scored.actual_team_one
    ),
    coalesce(sum(case
      when scored.actual_sets is null then 0
      when scored.prediction = scored.actual_value then 4
      when scored.predicted_team_one = scored.actual_team_one then 2
      else 0
    end), 0)::bigint
  from public.profiles as profile
  join scored on scored.user_id = profile.id
  group by profile.id, profile.display_name
  order by 7 desc, 5 desc, 6 desc, 2 asc;
$$;

commit;
