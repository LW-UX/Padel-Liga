begin;

alter table public.training_rounds
  add column if not exists is_complete boolean not null default true;

alter table public.training_rounds
  drop constraint if exists training_rounds_set_count_check;

alter table public.training_rounds
  add constraint training_rounds_set_count_check check (set_count in (1, 2, 3));

create or replace function public.create_training_session(
  p_played_on date,
  p_display_time time,
  p_player_ids text[],
  p_rounds jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_profile record;
  session_id bigint;
  round_item jsonb;
  team_one text[];
  team_two text[];
  result_details text;
  set_count integer;
  is_complete boolean;
  round_number integer := 0;
  score_count integer;
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  if not private.user_email_is_confirmed(current_user_id) then raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen.'; end if;
  select profile.* into current_profile from public.profiles as profile where profile.id = current_user_id;
  if current_profile.app_role not in ('player', 'admin') then raise exception 'Nur Spieler dürfen Trainings anlegen.'; end if;
  if cardinality(p_player_ids) <> 4 or (select count(distinct id) from unnest(p_player_ids) as id) <> 4 then
    raise exception 'Ein Training benötigt genau vier verschiedene Spieler.';
  end if;
  if current_profile.app_role <> 'admin' and not (current_profile.player_id = any(p_player_ids)) then
    raise exception 'Der Ersteller muss am Training teilnehmen.';
  end if;
  if (select count(*) from public.players as player where player.id = any(p_player_ids)) <> 4 then
    raise exception 'Mindestens ein Spieler ist unbekannt.';
  end if;
  if jsonb_typeof(p_rounds) <> 'array' or jsonb_array_length(p_rounds) < 1 then
    raise exception 'Mindestens ein Spielergebnis ist erforderlich.';
  end if;

  insert into public.training_sessions (played_on, display_time, player_ids, created_by)
  values (p_played_on, p_display_time, p_player_ids, current_user_id)
  returning id into session_id;

  for round_item in select value from jsonb_array_elements(p_rounds)
  loop
    round_number := round_number + 1;
    select array_agg(value) into team_one from jsonb_array_elements_text(round_item -> 'team_one_ids');
    select array_agg(value) into team_two from jsonb_array_elements_text(round_item -> 'team_two_ids');
    result_details := trim(round_item ->> 'result_details');
    set_count := (round_item ->> 'set_count')::integer;
    is_complete := coalesce((round_item ->> 'is_complete')::boolean, true);

    if cardinality(team_one) <> 2 or cardinality(team_two) <> 2
      or (select count(distinct id) from unnest(team_one || team_two) as id) <> 4
      or exists (select 1 from unnest(team_one || team_two) as id where not (id = any(p_player_ids))) then
      raise exception 'Jede Trainingsrunde muss dieselben vier Spieler genau einmal enthalten.';
    end if;
    select count(*) into score_count from regexp_matches(result_details, '[0-9]+\s*:\s*[0-9]+', 'g');
    if set_count not in (1, 2, 3) or score_count <> set_count then
      raise exception 'Das Trainingsergebnis muss aus einem bis drei Ergebnisabschnitten bestehen.';
    end if;

    insert into public.training_rounds (
      session_id, round_number, team_one_ids, team_two_ids, result_details, set_count, is_complete
    ) values (session_id, round_number, team_one, team_two, result_details, set_count, is_complete);
  end loop;

  return session_id;
end;
$$;

create or replace function public.get_my_training_tasks()
returns table (
  session_id bigint,
  training_number bigint,
  created_at timestamptz,
  played_on date,
  display_time time,
  player_ids text[],
  created_by_me boolean,
  rounds jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with numbered_sessions as (
    select
      session.*,
      row_number() over (order by session.created_at, session.id) as training_number
    from public.training_sessions as session
  )
  select
    session.id,
    session.training_number,
    session.created_at,
    session.played_on,
    session.display_time,
    session.player_ids,
    session.created_by = (select auth.uid()),
    (
      select jsonb_agg(jsonb_build_object(
        'round_number', round.round_number,
        'team_one_ids', round.team_one_ids,
        'team_two_ids', round.team_two_ids,
        'result_details', round.result_details,
        'set_count', round.set_count,
        'is_complete', round.is_complete
      ) order by round.round_number)
      from public.training_rounds as round
      where round.session_id = session.id
    )
  from numbered_sessions as session
  join public.profiles as profile on profile.id = (select auth.uid())
  where session.status = 'pending'
    and (
      session.created_by = (select auth.uid())
      or profile.app_role = 'admin'
      or (profile.player_id = any(session.player_ids) and session.created_by <> (select auth.uid()))
    )
  order by session.created_at desc, session.id desc;
$$;

create or replace function public.get_training_sessions()
returns table (
  session_id bigint,
  played_on date,
  display_time time,
  players jsonb,
  rounds jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    session.id,
    session.played_on,
    session.display_time,
    (
      select jsonb_agg(jsonb_build_object(
        'id', player.id,
        'display_name', player.display_name,
        'initials', player.initials
      ) order by member.ordinality)
      from unnest(session.player_ids) with ordinality as member(player_id, ordinality)
      join public.players as player on player.id = member.player_id
    ),
    (
      select jsonb_agg(jsonb_build_object(
        'round_number', round.round_number,
        'team_one_ids', round.team_one_ids,
        'team_two_ids', round.team_two_ids,
        'result_details', round.result_details,
        'set_count', round.set_count,
        'is_complete', round.is_complete
      ) order by round.round_number)
      from public.training_rounds as round
      where round.session_id = session.id
    )
  from public.training_sessions as session
  where session.status = 'confirmed'
  order by session.played_on desc, session.display_time desc, session.id desc;
$$;

create or replace view private.player_profile_match_rows as
select
  member.player_id,
  match.id as row_id,
  'league'::text as kind,
  match.scheduled_date as played_on,
  match.display_time,
  match.season_id,
  season.label as season_label,
  member.team,
  match.result_details,
  case when match.winner = member.team then 'win' else 'loss' end::text as outcome,
  coalesce((
    select array_agg(player.display_name order by teammate.position)
    from public.match_players as teammate
    join public.players as player on player.id = teammate.player_id
    where teammate.match_id = match.id
      and teammate.team = member.team
      and teammate.player_id <> member.player_id
  ), '{}')::text[] as partner_names,
  coalesce((
    select array_agg(player.display_name order by opponent.position)
    from public.match_players as opponent
    join public.players as player on player.id = opponent.player_id
    where opponent.match_id = match.id
      and opponent.team <> member.team
  ), '{}')::text[] as opponent_names,
  case member.team
    when 1 then (private.profile_regular_game_totals(match.result_details))[1]
    else (private.profile_regular_game_totals(match.result_details))[2]
  end as games_for,
  case member.team
    when 1 then (private.profile_regular_game_totals(match.result_details))[2]
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
  true as is_complete,
  null::bigint as training_session_id,
  null::integer as training_round_number
from public.matches as match
join public.seasons as season
  on season.id = match.season_id
 and season.counts_for_profile
join public.match_players as member on member.match_id = match.id
where match.actual_sets is not null
  and match.winner is not null
  and match.match_type in ('season', 'final')

union all

select
  participant.player_id,
  'training-' || session.id || '-' || round.round_number as row_id,
  'training'::text as kind,
  session.played_on,
  to_char(session.display_time, 'HH24.MI') as display_time,
  null::text as season_id,
  'Training'::text as season_label,
  case when participant.player_id = any(round.team_one_ids) then 1 else 2 end::smallint as team,
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
  end::text as outcome,
  coalesce((
    select array_agg(player.display_name order by member.ordinality)
    from unnest(case
      when participant.player_id = any(round.team_one_ids) then round.team_one_ids
      else round.team_two_ids
    end) with ordinality as member(player_id, ordinality)
    join public.players as player on player.id = member.player_id
    where member.player_id <> participant.player_id
  ), '{}')::text[] as partner_names,
  coalesce((
    select array_agg(player.display_name order by member.ordinality)
    from unnest(case
      when participant.player_id = any(round.team_one_ids) then round.team_two_ids
      else round.team_one_ids
    end) with ordinality as member(player_id, ordinality)
    join public.players as player on player.id = member.player_id
  ), '{}')::text[] as opponent_names,
  case when participant.player_id = any(round.team_one_ids)
    then (private.profile_regular_game_totals(round.result_details))[1]
    else (private.profile_regular_game_totals(round.result_details))[2]
  end as games_for,
  case when participant.player_id = any(round.team_one_ids)
    then (private.profile_regular_game_totals(round.result_details))[2]
    else (private.profile_regular_game_totals(round.result_details))[1]
  end as games_against,
  0 as points,
  false as counts_for_ranking,
  round.is_complete,
  session.id as training_session_id,
  round.round_number as training_round_number
from public.training_sessions as session
join public.training_rounds as round on round.session_id = session.id
cross join lateral unnest(session.player_ids) as participant(player_id)
where session.status = 'confirmed';

create or replace function public.get_player_profile(p_player_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with selected_player as (
    select player.* from public.players as player where player.id = p_player_id
  ), career as (
    select * from private.player_profile_match_rows as history
    where history.player_id = p_player_id
  ), scored_career as (
    select * from career where is_complete
  ), elo_events as (
    select
      participant.season_id,
      season.label as season_label,
      season.starts_on as event_date,
      null::text as display_time,
      'Start'::text as label,
      participant.start_elo as elo,
      0 as event_order
    from public.season_players as participant
    join public.seasons as season
      on season.id = participant.season_id
     and season.counts_for_profile
    where participant.player_id = p_player_id
    union all
    select
      match.season_id,
      season.label,
      match.scheduled_date,
      match.display_time,
      coalesce(match.display_label, 'Partie ' || match.matchday),
      change.new_elo,
      1
    from public.match_elo_changes as change
    join public.matches as match on match.id = change.match_id and match.counts_for_elo
    join public.seasons as season on season.id = match.season_id and season.counts_for_profile
    where change.player_id = p_player_id
  ), ordered_elo as (
    select * from elo_events
    order by event_date nulls last, display_time nulls last, event_order, label
  )
  select case when exists (select 1 from selected_player) then jsonb_build_object(
    'identity', (
      select jsonb_build_object(
        'id', player.id,
        'displayName', player.display_name,
        'initials', player.initials,
        'company', player.company
      ) from selected_player as player
    ),
    'summary', jsonb_build_object(
      'currentElo', (select elo from ordered_elo order by event_date desc nulls last, display_time desc nulls last, event_order desc limit 1),
      'peakElo', (select max(elo) from ordered_elo),
      'matches', (select count(*) from scored_career),
      'wins', (select count(*) from scored_career where outcome = 'win'),
      'losses', (select count(*) from scored_career where outcome = 'loss'),
      'gamesFor', coalesce((select sum(games_for) from scored_career), 0),
      'gamesAgainst', coalesce((select sum(games_against) from scored_career), 0),
      'gameDiff', coalesce((select sum(games_for - games_against) from scored_career), 0)
    ),
    'eloSeries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'seasonId', event.season_id,
        'seasonLabel', event.season_label,
        'date', event.event_date,
        'label', event.label,
        'elo', event.elo
      ) order by event.event_date nulls last, event.display_time nulls last, event.event_order, event.label)
      from ordered_elo as event
    ), '[]'::jsonb),
    'participations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'seasonId', stats.season_id,
        'seasonLabel', stats.season_label,
        'isActive', stats.is_active,
        'rank', stats.rank,
        'matches', stats.matches,
        'wins', stats.wins,
        'losses', stats.matches - stats.wins,
        'points', stats.points,
        'gameDiff', stats.games_for - stats.games_against
      ) order by stats.is_active desc, stats.season_id desc)
      from private.season_player_statistics as stats
      where stats.player_id = p_player_id
    ), '[]'::jsonb),
    'achievements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', achievement.id,
        'kind', achievement.kind,
        'title', achievement.title,
        'subtitle', achievement.subtitle,
        'achievedOn', achievement.achieved_on,
        'seasonId', achievement.season_id
      ) order by achievement.priority desc, achievement.achieved_on desc nulls last, achievement.id)
      from public.player_achievements as achievement
      left join public.seasons as season on season.id = achievement.season_id
      where achievement.player_id = p_player_id
        and (achievement.season_id is null or season.counts_for_profile)
    ), '[]'::jsonb),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', history.row_id,
        'kind', history.kind,
        'date', history.played_on,
        'seasonId', history.season_id,
        'seasonLabel', history.season_label,
        'resultDetails', history.result_details,
        'team', history.team,
        'outcome', history.outcome,
        'isComplete', history.is_complete,
        'trainingSessionId', history.training_session_id,
        'trainingRoundNumber', history.training_round_number,
        'partnerNames', to_jsonb(history.partner_names),
        'opponentNames', to_jsonb(history.opponent_names)
      ) order by history.played_on desc nulls last, history.display_time desc nulls last,
        history.training_session_id desc nulls last, history.training_round_number asc nulls last, history.row_id desc)
      from career as history
    ), '[]'::jsonb)
  ) else null end;
$$;

revoke execute on function public.create_training_session(date, time, text[], jsonb) from public, anon;
revoke execute on function public.get_my_training_tasks() from public, anon;
revoke execute on function public.get_training_sessions() from public;
revoke execute on function public.get_player_profile(text) from public;
grant execute on function public.create_training_session(date, time, text[], jsonb) to authenticated;
grant execute on function public.get_my_training_tasks() to authenticated;
grant execute on function public.get_training_sessions() to anon, authenticated;
grant execute on function public.get_player_profile(text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
