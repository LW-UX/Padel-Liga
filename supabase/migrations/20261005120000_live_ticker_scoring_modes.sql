begin;

alter table public.live_match_sessions
  add column if not exists scoring_mode text not null default 'points';

alter table public.live_match_sessions
  drop constraint if exists live_match_sessions_scoring_mode_check;
alter table public.live_match_sessions
  add constraint live_match_sessions_scoring_mode_check
  check (scoring_mode in ('points', 'games'));

alter table public.live_match_events
  drop constraint if exists live_match_events_event_type_check;
alter table public.live_match_events
  add constraint live_match_events_event_type_check
  check (event_type in ('point', 'game', 'undo', 'server_set', 'server_correction', 'finish', 'cancel', 'official_correction'));

create or replace function private.live_public_payload(p_match_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with selected_match as (
    select match.*, season.label as season_label
    from public.matches as match
    join public.seasons as season on season.id = match.season_id
    where match.id = p_match_id
  ), selected_session as (
    select session.*
    from public.live_match_sessions as session
    where session.match_id = p_match_id and session.status <> 'cancelled'
    order by session.revision desc limit 1
  )
  select case when not exists (select 1 from selected_match) then null else jsonb_build_object(
    'matchId', match.id,
    'seasonId', match.season_id,
    'seasonLabel', match.season_label,
    'displayLabel', coalesce(match.display_label, 'Partie ' || match.matchday),
    'matchAt', match.match_at,
    'result', match.result_details,
    'sets', match.actual_sets,
    'winner', match.winner,
    'corrected', coalesce(session.corrected_at is not null, false),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'matchId', sibling.id,
        'displayLabel', coalesce(sibling.display_label, 'Partie ' || sibling.matchday),
        'matchAt', sibling.match_at,
        'result', sibling.result_details,
        'winner', sibling.winner,
        'hasHistory', exists (
          select 1 from public.live_match_sessions as archive
          where archive.match_id = sibling.id and archive.status = 'finished'
        ),
        'isLive', exists (
          select 1 from public.live_match_sessions as active
          where active.match_id = sibling.id and active.status in ('live','needs_server','ready_to_finish')
        )
      ) order by sibling.match_at nulls last, sibling.id)
      from public.matches as sibling
      where sibling.season_id = match.season_id
        and sibling.competition_stage = 'final_four'
    ), '[]'::jsonb),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'playerId', player.id,
        'displayName', player.display_name,
        'initials', player.initials,
        'company', player.company,
        'team', member.team,
        'position', member.position,
        'currentElo', coalesce((
          select change.new_elo
          from public.match_elo_changes as change
          join public.matches as elo_match on elo_match.id = change.match_id
          where change.player_id = player.id and elo_match.counts_for_elo
          order by elo_match.match_at desc, elo_match.id desc limit 1
        ), player.initial_elo)
      ) order by member.team, member.position)
      from public.match_players as member
      join public.players as player on player.id = member.player_id
      where member.match_id = match.id
    ), '[]'::jsonb),
    'session', case when session.id is null then null else jsonb_build_object(
      'id', session.id,
      'revision', session.revision,
      'status', session.status,
      'version', session.version,
      'scoringMode', session.scoring_mode,
      'firstServingTeam', session.first_serving_team,
      'teamOneFirstServerId', session.team_one_first_server_id,
      'teamTwoFirstServerId', session.team_two_first_server_id,
      'currentServerPlayerId', session.current_server_player_id,
      'teamOneGames', session.team_one_games,
      'teamTwoGames', session.team_two_games,
      'teamOnePoints', session.team_one_points,
      'teamTwoPoints', session.team_two_points,
      'isTiebreak', session.is_tiebreak,
      'teamOneTiebreak', session.team_one_tiebreak,
      'teamTwoTiebreak', session.team_two_tiebreak,
      'startedAt', session.started_at,
      'finishedAt', session.finished_at,
      'events', coalesce((
        select jsonb_agg(jsonb_build_object(
          'sequence', event.sequence,
          'eventType', event.event_type,
          'winningTeam', event.winning_team,
          'serverPlayerId', event.server_player_id,
          'gameNumber', event.game_number,
          'pointLabel', event.point_label_after,
          'teamOneGames', event.team_one_games_after,
          'teamTwoGames', event.team_two_games_after,
          'gameEnded', event.game_ended,
          'break', event.was_break,
          'tiebreakScore', case when coalesce((event.payload->>'tiebreak')::boolean, false)
            then event.point_label_after else null end,
          'createdAt', event.created_at
        ) order by event.sequence)
        from public.live_match_events as event
        where event.session_id = session.id
          and event.event_type in ('point', 'game')
          and event.voided_at is null
      ), '[]'::jsonb)
    ) end
  ) end
  from selected_match as match
  left join selected_session as session on true;
$$;

create or replace function public.get_my_live_ticker_tasks()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select profile.* from public.profiles as profile where profile.id = (select auth.uid())
  )
  select jsonb_build_object(
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'matchId', match.id,
        'seasonId', match.season_id,
        'seasonLabel', season.label,
        'displayLabel', coalesce(match.display_label, 'Partie ' || match.matchday),
        'matchAt', match.match_at,
        'result', match.result_details,
        'teamOneLabel', match.team_one_label,
        'teamTwoLabel', match.team_two_label,
        'myTeam', member.team,
        'isAdmin', me.app_role = 'admin',
        'assignment', case when assignment.id is null then null else jsonb_build_object(
          'id', assignment.id,
          'scorerProfileId', assignment.scorer_profile_id,
          'scorerName', scorer.display_name,
          'status', assignment.status
        ) end,
        'session', case when session.id is null then null else jsonb_build_object(
          'id', session.id, 'status', session.status, 'version', session.version,
          'scoringMode', session.scoring_mode,
          'firstServingTeam', session.first_serving_team,
          'teamOneFirstServerId', session.team_one_first_server_id,
          'teamTwoFirstServerId', session.team_two_first_server_id,
          'currentServerPlayerId', session.current_server_player_id,
          'teamOneGames', session.team_one_games, 'teamTwoGames', session.team_two_games,
          'teamOnePoints', session.team_one_points, 'teamTwoPoints', session.team_two_points,
          'isTiebreak', session.is_tiebreak,
          'teamOneTiebreak', session.team_one_tiebreak, 'teamTwoTiebreak', session.team_two_tiebreak
        ) end,
        'players', coalesce((select jsonb_agg(jsonb_build_object(
          'playerId', player.id, 'displayName', player.display_name,
          'team', player_member.team, 'position', player_member.position
        ) order by player_member.team, player_member.position)
          from public.match_players as player_member
          join public.players as player on player.id = player_member.player_id
          where player_member.match_id = match.id), '[]'::jsonb)
      ) order by match.match_at nulls last, match.id)
      from me
      join public.matches as match on match.competition_stage = 'final_four'
        and match.format = 'single-set'
        and match.match_at is not null
      join public.seasons as season on season.id = match.season_id
      left join public.match_players as member on member.match_id = match.id and member.player_id = me.player_id
      left join public.live_match_scorer_assignments as assignment
        on assignment.match_id = match.id and assignment.status in ('pending','accepted')
      left join public.profiles as scorer on scorer.id = assignment.scorer_profile_id
      left join public.live_match_sessions as session
        on session.match_id = match.id and session.status in ('live','needs_server','ready_to_finish')
      where (
        me.app_role = 'admin'
        or member.player_id is not null
        or assignment.scorer_profile_id = me.id
      ) and match.actual_sets is null
        and (select count(*) from public.match_players as lineup where lineup.match_id = match.id) = 4
    ), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignmentId', assignment.id,
        'matchId', assignment.match_id,
        'displayLabel', coalesce(match.display_label, 'Partie ' || match.matchday),
        'seasonLabel', season.label,
        'matchAt', match.match_at,
        'nominatedBy', nominator.display_name
      ) order by assignment.nominated_at)
      from me
      join public.live_match_scorer_assignments as assignment
        on assignment.scorer_profile_id = me.id and assignment.status = 'pending'
      join public.matches as match on match.id = assignment.match_id
      join public.seasons as season on season.id = match.season_id
      join public.profiles as nominator on nominator.id = assignment.nominated_by
    ), '[]'::jsonb)
  );
$$;

create or replace function public.start_live_match_with_mode(
  p_match_id text, p_first_server_player_id text, p_scoring_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_match record;
  first_team smallint;
  next_revision integer;
  new_session_id bigint;
begin
  if p_scoring_mode not in ('points', 'games') then
    raise exception 'Bitte einen gültigen Liveticker-Modus auswählen.';
  end if;
  if not private.live_user_can_score(p_match_id) then raise exception 'Du bist für diese Partie nicht als Schreiber bestätigt.'; end if;
  select match.* into selected_match from public.matches as match where match.id = p_match_id for update;
  if selected_match.id is null or selected_match.competition_stage <> 'final_four' or selected_match.format <> 'single-set'
    or selected_match.match_at is null or selected_match.actual_sets is not null then raise exception 'Diese Partie kann nicht live gestartet werden.'; end if;
  if exists (
    select 1 from public.result_proposals as proposal
    where proposal.match_id = p_match_id and proposal.status = 'pending'
  ) then
    raise exception 'Für diese Partie wartet bereits ein Ergebnis auf Bestätigung.';
  end if;
  if (select count(*) from public.match_players as member where member.match_id = p_match_id) <> 4 then
    raise exception 'Für den Liveticker müssen vier Spieler feststehen.';
  end if;
  first_team := private.live_player_team(p_match_id, p_first_server_player_id);
  if first_team is null then raise exception 'Der erste Aufschläger gehört nicht zu dieser Partie.'; end if;
  if exists (select 1 from public.live_match_sessions as session where session.status in ('live','needs_server','ready_to_finish')) then
    raise exception 'Es läuft bereits eine Partie live.';
  end if;
  select coalesce(max(session.revision), 0) + 1 into next_revision
  from public.live_match_sessions as session where session.match_id = p_match_id;
  insert into public.live_match_sessions(
    match_id, revision, scoring_mode, first_serving_team, team_one_first_server_id,
    team_two_first_server_id, current_server_player_id
  ) values (
    p_match_id, next_revision, p_scoring_mode, first_team,
    case when first_team = 1 then p_first_server_player_id end,
    case when first_team = 2 then p_first_server_player_id end,
    p_first_server_player_id
  ) returning id into new_session_id;
  insert into public.live_match_events(session_id, sequence, event_type, actor_user_id, server_player_id, payload)
  values (new_session_id, 1, 'server_set', (select auth.uid()), p_first_server_player_id,
    jsonb_build_object('team', first_team, 'scoringMode', p_scoring_mode));
  return private.live_public_payload(p_match_id);
end;
$$;

create or replace function public.start_live_match(p_match_id text, p_first_server_player_id text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.start_live_match_with_mode(p_match_id, p_first_server_player_id, 'points');
$$;

create or replace function public.set_live_team_first_server(
  p_match_id text, p_team smallint, p_player_id text, p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare session public.live_match_sessions%rowtype; old_player text; next_sequence integer;
begin
  if not private.live_user_can_score(p_match_id) then raise exception 'Keine Schreibberechtigung.'; end if;
  select active.* into session from public.live_match_sessions as active
  where active.match_id = p_match_id and active.status in ('live','needs_server') for update;
  if session.id is null then raise exception 'Die Partie ist nicht live.'; end if;
  if session.version <> p_expected_version then raise exception 'Der Liveticker wurde zwischenzeitlich aktualisiert.' using errcode = '40001'; end if;
  if private.live_player_team(p_match_id, p_player_id) is distinct from p_team then raise exception 'Der Aufschläger gehört nicht zu diesem Team.'; end if;
  if p_team = 1 then old_player := session.team_one_first_server_id; else old_player := session.team_two_first_server_id; end if;
  if old_player is not null and exists (
    select 1 from public.live_match_events as event
    where event.session_id = session.id and event.event_type in ('point', 'game')
      and event.server_player_id = old_player and event.voided_at is null
  ) then raise exception 'Diesen Aufschläger kannst du nur durch Zurücknehmen bis vor sein erstes Aufschlagspiel korrigieren.'; end if;
  if p_team = 1 then
    update public.live_match_sessions set team_one_first_server_id = p_player_id,
      current_server_player_id = case when current_server_player_id is null or current_server_player_id = old_player then p_player_id else current_server_player_id end,
      status = 'live', version = version + 1, updated_at = now() where id = session.id;
  else
    update public.live_match_sessions set team_two_first_server_id = p_player_id,
      current_server_player_id = case when current_server_player_id is null or current_server_player_id = old_player then p_player_id else current_server_player_id end,
      status = 'live', version = version + 1, updated_at = now() where id = session.id;
  end if;
  select coalesce(max(event.sequence), 0) + 1 into next_sequence from public.live_match_events as event where event.session_id = session.id;
  insert into public.live_match_events(session_id, sequence, event_type, actor_user_id, server_player_id, payload)
  values (session.id, next_sequence, case when old_player is null then 'server_set' else 'server_correction' end,
    (select auth.uid()), p_player_id, jsonb_build_object('team', p_team, 'previousPlayerId', old_player));
  return private.live_public_payload(p_match_id);
end;
$$;

create or replace function public.record_live_point(
  p_match_id text, p_winning_team smallint, p_expected_version integer, p_client_action_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  session public.live_match_sessions%rowtype;
  next_sequence integer;
  before_state jsonb;
  one_points smallint;
  two_points smallint;
  one_games smallint;
  two_games smallint;
  one_tiebreak smallint;
  two_tiebreak smallint;
  game_finished boolean := false;
  set_finished boolean := false;
  break_point boolean := false;
  point_label text;
  next_server text;
  total_tiebreak_points integer;
  rotation_index integer;
begin
  if p_winning_team not in (1, 2) then raise exception 'Bitte ein gültiges Team auswählen.'; end if;
  if not private.live_user_can_score(p_match_id) then raise exception 'Keine Schreibberechtigung.'; end if;
  if exists (select 1 from public.live_match_events as event where event.client_action_id = p_client_action_id) then
    return private.live_public_payload(p_match_id);
  end if;
  select active.* into session from public.live_match_sessions as active
  where active.match_id = p_match_id and active.status = 'live' for update;
  if session.id is null then raise exception 'Die Partie erwartet noch einen Aufschläger oder ist nicht live.'; end if;
  if session.scoring_mode <> 'points' then raise exception 'Diese Partie wird Spiel für Spiel erfasst.'; end if;
  if session.version <> p_expected_version then raise exception 'Der Liveticker wurde zwischenzeitlich aktualisiert.' using errcode = '40001'; end if;
  if session.current_server_player_id is null then raise exception 'Bitte zuerst den Aufschläger festlegen.'; end if;

  before_state := jsonb_build_object(
    'status', session.status, 'currentServerPlayerId', session.current_server_player_id,
    'teamOneGames', session.team_one_games, 'teamTwoGames', session.team_two_games,
    'teamOnePoints', session.team_one_points, 'teamTwoPoints', session.team_two_points,
    'isTiebreak', session.is_tiebreak,
    'teamOneTiebreak', session.team_one_tiebreak, 'teamTwoTiebreak', session.team_two_tiebreak,
    'gameNumber', session.game_number
  );
  one_points := session.team_one_points; two_points := session.team_two_points;
  one_games := session.team_one_games; two_games := session.team_two_games;
  one_tiebreak := session.team_one_tiebreak; two_tiebreak := session.team_two_tiebreak;

  if session.is_tiebreak then
    if p_winning_team = 1 then one_tiebreak := one_tiebreak + 1; else two_tiebreak := two_tiebreak + 1; end if;
    point_label := one_tiebreak::text || ':' || two_tiebreak::text;
    if greatest(one_tiebreak, two_tiebreak) >= 7 and abs(one_tiebreak - two_tiebreak) >= 2 then
      game_finished := true; set_finished := true;
      if one_tiebreak > two_tiebreak then one_games := 7; else two_games := 7; end if;
    end if;
  else
    if p_winning_team = 1 then
      if one_points = 3 then game_finished := true; else one_points := one_points + 1; end if;
    else
      if two_points = 3 then game_finished := true; else two_points := two_points + 1; end if;
    end if;
    if game_finished then
      if p_winning_team = 1 then one_games := one_games + 1; else two_games := two_games + 1; end if;
      point_label := 'Spiel';
      break_point := private.live_player_team(p_match_id, session.current_server_player_id) <> p_winning_team;
      one_points := 0; two_points := 0;
      if (greatest(one_games, two_games) >= 6 and abs(one_games - two_games) >= 2) or greatest(one_games, two_games) = 7 then
        set_finished := true;
      end if;
    else
      point_label := private.live_point_label(one_points, two_points);
    end if;
  end if;

  select coalesce(max(event.sequence), 0) + 1 into next_sequence
  from public.live_match_events as event where event.session_id = session.id;
  insert into public.live_match_events(
    session_id, sequence, event_type, client_action_id, actor_user_id, winning_team,
    server_player_id, game_number, point_label_after, team_one_games_after,
    team_two_games_after, game_ended, was_break, before_state
  ) values (
    session.id, next_sequence, 'point', p_client_action_id, (select auth.uid()), p_winning_team,
    session.current_server_player_id, session.game_number, point_label, one_games, two_games,
    game_finished, break_point, before_state
  );

  if set_finished then
    update public.live_match_sessions set status = 'ready_to_finish', version = version + 1,
      team_one_games = one_games, team_two_games = two_games,
      team_one_points = one_points, team_two_points = two_points,
      team_one_tiebreak = one_tiebreak, team_two_tiebreak = two_tiebreak,
      updated_at = now() where id = session.id;
  elsif game_finished then
    if one_games = 6 and two_games = 6 then
      next_server := private.live_rotation_player(session.id, one_games + two_games);
      update public.live_match_sessions set version = version + 1,
        team_one_games = one_games, team_two_games = two_games,
        team_one_points = 0, team_two_points = 0, is_tiebreak = true,
        game_number = game_number + 1, current_server_player_id = next_server,
        status = case when next_server is null then 'needs_server' else 'live' end,
        updated_at = now() where id = session.id;
    else
      next_server := private.live_rotation_player(session.id, one_games + two_games);
      update public.live_match_sessions set version = version + 1,
        team_one_games = one_games, team_two_games = two_games,
        team_one_points = 0, team_two_points = 0,
        game_number = game_number + 1, current_server_player_id = next_server,
        status = case when next_server is null then 'needs_server' else 'live' end,
        updated_at = now() where id = session.id;
    end if;
  elsif session.is_tiebreak then
    total_tiebreak_points := one_tiebreak + two_tiebreak;
    rotation_index := case when total_tiebreak_points = 0 then 0 else 1 + ((total_tiebreak_points - 1) / 2) end;
    next_server := private.live_rotation_player(session.id, rotation_index);
    update public.live_match_sessions set version = version + 1,
      team_one_tiebreak = one_tiebreak, team_two_tiebreak = two_tiebreak,
      current_server_player_id = next_server, updated_at = now() where id = session.id;
  else
    update public.live_match_sessions set version = version + 1,
      team_one_points = one_points, team_two_points = two_points, updated_at = now() where id = session.id;
  end if;
  return private.live_public_payload(p_match_id);
end;
$$;

create or replace function public.record_live_game(
  p_match_id text, p_winning_team smallint, p_expected_version integer, p_client_action_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  session public.live_match_sessions%rowtype;
  next_sequence integer;
  before_state jsonb;
  one_games smallint;
  two_games smallint;
  set_finished boolean;
  break_game boolean;
  next_server text;
begin
  if p_winning_team not in (1, 2) then raise exception 'Bitte ein gültiges Team auswählen.'; end if;
  if not private.live_user_can_score(p_match_id) then raise exception 'Keine Schreibberechtigung.'; end if;
  if exists (select 1 from public.live_match_events as event where event.client_action_id = p_client_action_id) then
    return private.live_public_payload(p_match_id);
  end if;
  select active.* into session from public.live_match_sessions as active
  where active.match_id = p_match_id and active.status = 'live' for update;
  if session.id is null then raise exception 'Die Partie erwartet noch einen Aufschläger oder ist nicht live.'; end if;
  if session.scoring_mode <> 'games' then raise exception 'Diese Partie wird Punkt für Punkt erfasst.'; end if;
  if session.is_tiebreak then raise exception 'Bitte den vollständigen Tiebreak-Endstand eintragen.'; end if;
  if session.version <> p_expected_version then raise exception 'Der Liveticker wurde zwischenzeitlich aktualisiert.' using errcode = '40001'; end if;
  if session.current_server_player_id is null then raise exception 'Bitte zuerst den Aufschläger festlegen.'; end if;

  before_state := jsonb_build_object(
    'status', session.status, 'currentServerPlayerId', session.current_server_player_id,
    'teamOneGames', session.team_one_games, 'teamTwoGames', session.team_two_games,
    'teamOnePoints', session.team_one_points, 'teamTwoPoints', session.team_two_points,
    'isTiebreak', session.is_tiebreak,
    'teamOneTiebreak', session.team_one_tiebreak, 'teamTwoTiebreak', session.team_two_tiebreak,
    'gameNumber', session.game_number
  );
  one_games := session.team_one_games;
  two_games := session.team_two_games;
  if p_winning_team = 1 then one_games := one_games + 1; else two_games := two_games + 1; end if;
  set_finished := greatest(one_games, two_games) >= 6 and abs(one_games - two_games) >= 2;
  break_game := private.live_player_team(p_match_id, session.current_server_player_id) <> p_winning_team;

  select coalesce(max(event.sequence), 0) + 1 into next_sequence
  from public.live_match_events as event where event.session_id = session.id;
  insert into public.live_match_events(
    session_id, sequence, event_type, client_action_id, actor_user_id, winning_team,
    server_player_id, game_number, point_label_after, team_one_games_after,
    team_two_games_after, game_ended, was_break, before_state
  ) values (
    session.id, next_sequence, 'game', p_client_action_id, (select auth.uid()), p_winning_team,
    session.current_server_player_id, session.game_number, 'Spiel', one_games, two_games,
    true, break_game, before_state
  );

  if set_finished then
    update public.live_match_sessions set status = 'ready_to_finish', version = version + 1,
      team_one_games = one_games, team_two_games = two_games, updated_at = now()
    where id = session.id;
  else
    next_server := private.live_rotation_player(session.id, one_games + two_games);
    update public.live_match_sessions set version = version + 1,
      team_one_games = one_games, team_two_games = two_games,
      is_tiebreak = one_games = 6 and two_games = 6,
      game_number = game_number + 1,
      current_server_player_id = next_server,
      status = case when next_server is null then 'needs_server' else 'live' end,
      updated_at = now()
    where id = session.id;
  end if;
  return private.live_public_payload(p_match_id);
end;
$$;

create or replace function public.record_live_tiebreak_result(
  p_match_id text, p_team_one_points smallint, p_team_two_points smallint,
  p_expected_version integer, p_client_action_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  session public.live_match_sessions%rowtype;
  next_sequence integer;
  before_state jsonb;
  winning_team smallint;
  one_games smallint;
  two_games smallint;
begin
  if p_team_one_points is null or p_team_two_points is null
    or p_team_one_points < 0 or p_team_two_points < 0
    or not (
      (greatest(p_team_one_points, p_team_two_points) = 7
        and least(p_team_one_points, p_team_two_points) <= 5)
      or (greatest(p_team_one_points, p_team_two_points) > 7
        and abs(p_team_one_points - p_team_two_points) = 2)
    ) then
    raise exception 'Der Tiebreak benötigt mindestens sieben Punkte und zwei Punkte Abstand.';
  end if;
  if not private.live_user_can_score(p_match_id) then raise exception 'Keine Schreibberechtigung.'; end if;
  if exists (select 1 from public.live_match_events as event where event.client_action_id = p_client_action_id) then
    return private.live_public_payload(p_match_id);
  end if;
  select active.* into session from public.live_match_sessions as active
  where active.match_id = p_match_id and active.status = 'live' for update;
  if session.id is null then raise exception 'Die Partie ist nicht live.'; end if;
  if session.scoring_mode <> 'games' then raise exception 'Diese Partie wird Punkt für Punkt erfasst.'; end if;
  if not session.is_tiebreak or session.team_one_games <> 6 or session.team_two_games <> 6 then
    raise exception 'Ein Tiebreak-Endstand ist erst bei 6:6 möglich.';
  end if;
  if session.version <> p_expected_version then raise exception 'Der Liveticker wurde zwischenzeitlich aktualisiert.' using errcode = '40001'; end if;

  winning_team := case when p_team_one_points > p_team_two_points then 1 else 2 end;
  one_games := case when winning_team = 1 then 7 else 6 end;
  two_games := case when winning_team = 2 then 7 else 6 end;
  before_state := jsonb_build_object(
    'status', session.status, 'currentServerPlayerId', session.current_server_player_id,
    'teamOneGames', session.team_one_games, 'teamTwoGames', session.team_two_games,
    'teamOnePoints', session.team_one_points, 'teamTwoPoints', session.team_two_points,
    'isTiebreak', session.is_tiebreak,
    'teamOneTiebreak', session.team_one_tiebreak, 'teamTwoTiebreak', session.team_two_tiebreak,
    'gameNumber', session.game_number
  );

  select coalesce(max(event.sequence), 0) + 1 into next_sequence
  from public.live_match_events as event where event.session_id = session.id;
  insert into public.live_match_events(
    session_id, sequence, event_type, client_action_id, actor_user_id, winning_team,
    game_number, point_label_after, team_one_games_after, team_two_games_after,
    game_ended, was_break, before_state, payload
  ) values (
    session.id, next_sequence, 'game', p_client_action_id, (select auth.uid()), winning_team,
    session.game_number, p_team_one_points::text || ':' || p_team_two_points::text,
    one_games, two_games, true, false, before_state,
    jsonb_build_object('tiebreak', true, 'teamOnePoints', p_team_one_points, 'teamTwoPoints', p_team_two_points)
  );
  update public.live_match_sessions set status = 'ready_to_finish', version = version + 1,
    team_one_games = one_games, team_two_games = two_games,
    team_one_tiebreak = p_team_one_points, team_two_tiebreak = p_team_two_points,
    updated_at = now()
  where id = session.id;
  return private.live_public_payload(p_match_id);
end;
$$;

create or replace function public.undo_live_game(p_match_id text, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare session public.live_match_sessions%rowtype; game_event public.live_match_events%rowtype; next_sequence integer;
begin
  if not private.live_user_can_score(p_match_id) then raise exception 'Keine Schreibberechtigung.'; end if;
  select active.* into session from public.live_match_sessions as active
  where active.match_id = p_match_id and active.status in ('live','needs_server','ready_to_finish') for update;
  if session.id is null then raise exception 'Die Partie ist nicht live.'; end if;
  if session.scoring_mode <> 'games' then raise exception 'Diese Partie wird Punkt für Punkt erfasst.'; end if;
  if session.version <> p_expected_version then raise exception 'Der Liveticker wurde zwischenzeitlich aktualisiert.' using errcode = '40001'; end if;
  select event.* into game_event from public.live_match_events as event
  where event.session_id = session.id and event.event_type = 'game' and event.voided_at is null
  order by event.sequence desc limit 1 for update;
  if game_event.id is null then raise exception 'Es gibt noch kein Spiel zum Zurücknehmen.'; end if;
  update public.live_match_events set voided_at = now(), voided_by = (select auth.uid()) where id = game_event.id;
  update public.live_match_sessions set
    status = game_event.before_state->>'status',
    current_server_player_id = game_event.before_state->>'currentServerPlayerId',
    team_one_games = (game_event.before_state->>'teamOneGames')::smallint,
    team_two_games = (game_event.before_state->>'teamTwoGames')::smallint,
    team_one_points = (game_event.before_state->>'teamOnePoints')::smallint,
    team_two_points = (game_event.before_state->>'teamTwoPoints')::smallint,
    is_tiebreak = (game_event.before_state->>'isTiebreak')::boolean,
    team_one_tiebreak = (game_event.before_state->>'teamOneTiebreak')::smallint,
    team_two_tiebreak = (game_event.before_state->>'teamTwoTiebreak')::smallint,
    game_number = (game_event.before_state->>'gameNumber')::smallint,
    version = version + 1, updated_at = now()
  where id = session.id;
  select coalesce(max(event.sequence), 0) + 1 into next_sequence from public.live_match_events as event where event.session_id = session.id;
  insert into public.live_match_events(session_id, sequence, event_type, actor_user_id, payload)
  values (session.id, next_sequence, 'undo', (select auth.uid()), jsonb_build_object('voidedSequence', game_event.sequence));
  return private.live_public_payload(p_match_id);
end;
$$;

revoke all on function public.start_live_match_with_mode(text, text, text),
  public.record_live_game(text, smallint, integer, uuid),
  public.record_live_tiebreak_result(text, smallint, smallint, integer, uuid),
  public.undo_live_game(text, integer) from public;
grant execute on function public.start_live_match_with_mode(text, text, text),
  public.record_live_game(text, smallint, integer, uuid),
  public.record_live_tiebreak_result(text, smallint, smallint, integer, uuid),
  public.undo_live_game(text, integer) to authenticated;

notify pgrst, 'reload schema';

commit;
