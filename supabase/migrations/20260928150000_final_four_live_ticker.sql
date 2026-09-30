begin;

create table public.live_match_scorer_assignments (
  id bigint generated always as identity primary key,
  match_id text not null references public.matches(id) on delete cascade,
  scorer_profile_id uuid not null references public.profiles(id) on delete cascade,
  nominated_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked')),
  nominated_at timestamptz not null default now(),
  responded_at timestamptz,
  revoked_at timestamptz
);

create unique index live_match_scorer_assignments_active_idx
  on public.live_match_scorer_assignments(match_id)
  where status in ('pending', 'accepted');
create index live_match_scorer_assignments_scorer_idx
  on public.live_match_scorer_assignments(scorer_profile_id, status);

create table public.live_match_sessions (
  id bigint generated always as identity primary key,
  match_id text not null references public.matches(id) on delete cascade,
  revision integer not null default 1 check (revision > 0),
  status text not null default 'live' check (status in ('live', 'needs_server', 'ready_to_finish', 'finished', 'cancelled')),
  version integer not null default 0 check (version >= 0),
  first_serving_team smallint not null check (first_serving_team in (1, 2)),
  team_one_first_server_id text references public.players(id) on delete restrict,
  team_two_first_server_id text references public.players(id) on delete restrict,
  current_server_player_id text references public.players(id) on delete restrict,
  team_one_games smallint not null default 0 check (team_one_games between 0 and 7),
  team_two_games smallint not null default 0 check (team_two_games between 0 and 7),
  team_one_points smallint not null default 0 check (team_one_points between 0 and 3),
  team_two_points smallint not null default 0 check (team_two_points between 0 and 3),
  is_tiebreak boolean not null default false,
  team_one_tiebreak smallint not null default 0 check (team_one_tiebreak >= 0),
  team_two_tiebreak smallint not null default 0 check (team_two_tiebreak >= 0),
  game_number smallint not null default 1 check (game_number between 1 and 13),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  corrected_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (match_id, revision)
);

create unique index live_match_sessions_open_match_idx
  on public.live_match_sessions(match_id)
  where status in ('live', 'needs_server', 'ready_to_finish');
create unique index live_match_sessions_one_active_idx
  on public.live_match_sessions((true))
  where status in ('live', 'needs_server', 'ready_to_finish');

create table public.live_match_events (
  id bigint generated always as identity primary key,
  session_id bigint not null references public.live_match_sessions(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  event_type text not null check (event_type in ('point', 'undo', 'server_set', 'server_correction', 'finish', 'cancel', 'official_correction')),
  client_action_id uuid,
  actor_user_id uuid not null references public.profiles(id) on delete restrict,
  winning_team smallint check (winning_team in (1, 2)),
  server_player_id text references public.players(id) on delete restrict,
  game_number smallint,
  point_label_after text,
  team_one_games_after smallint,
  team_two_games_after smallint,
  game_ended boolean not null default false,
  was_break boolean not null default false,
  before_state jsonb,
  payload jsonb not null default '{}'::jsonb,
  voided_at timestamptz,
  voided_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (session_id, sequence),
  unique (client_action_id)
);

create index live_match_events_public_history_idx
  on public.live_match_events(session_id, sequence)
  where event_type = 'point' and voided_at is null;

create table public.live_match_official_corrections (
  id bigint generated always as identity primary key,
  session_id bigint not null references public.live_match_sessions(id) on delete restrict,
  corrected_by uuid not null references public.profiles(id) on delete restrict,
  previous_result_details text not null,
  previous_actual_sets text not null,
  previous_winner smallint not null,
  corrected_result_details text not null,
  corrected_actual_sets text not null,
  corrected_winner smallint not null,
  reason text not null check (char_length(trim(reason)) between 3 and 500),
  created_at timestamptz not null default now()
);

create or replace function private.prevent_parallel_live_match_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('app.live_finish_match_id', true) is distinct from new.id
    and exists (
      select 1
      from public.live_match_sessions as session
      where session.match_id = new.id
        and session.status in ('live', 'needs_server', 'ready_to_finish')
    )
    and (
      new.actual_sets is distinct from old.actual_sets
      or new.result_details is distinct from old.result_details
      or new.winner is distinct from old.winner
    )
  then
    raise exception 'Diese Partie wird gerade im Liveticker geführt.';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_parallel_live_match_result on public.matches;
create trigger prevent_parallel_live_match_result
before update of actual_sets, result_details, winner on public.matches
for each row execute function private.prevent_parallel_live_match_result();

create or replace function private.prevent_parallel_live_result_proposal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.matches as match where match.id = new.match_id for update;
  if new.status = 'pending' and exists (
    select 1
    from public.live_match_sessions as session
    where session.match_id = new.match_id
      and session.status in ('live', 'needs_server', 'ready_to_finish')
  ) then
    raise exception 'Diese Partie wird gerade im Liveticker geführt.';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_parallel_live_result_proposal on public.result_proposals;
create trigger prevent_parallel_live_result_proposal
before insert or update of status on public.result_proposals
for each row execute function private.prevent_parallel_live_result_proposal();

alter table public.live_match_scorer_assignments enable row level security;
alter table public.live_match_sessions enable row level security;
alter table public.live_match_events enable row level security;
alter table public.live_match_official_corrections enable row level security;

revoke all on public.live_match_scorer_assignments, public.live_match_sessions,
  public.live_match_events, public.live_match_official_corrections from anon, authenticated;
grant select on public.live_match_sessions to anon, authenticated;

drop policy if exists "Live sessions are public" on public.live_match_sessions;
create policy "Live sessions are public"
  on public.live_match_sessions for select to anon, authenticated using (true);

create or replace function private.live_user_can_score(p_match_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and (
        profile.app_role = 'admin'
        or exists (
          select 1
          from public.live_match_scorer_assignments as assignment
          where assignment.match_id = p_match_id
            and assignment.scorer_profile_id = profile.id
            and assignment.status = 'accepted'
        )
      )
  );
$$;

create or replace function private.live_player_team(p_match_id text, p_player_id text)
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select member.team
  from public.match_players as member
  where member.match_id = p_match_id and member.player_id = p_player_id;
$$;

create or replace function private.live_rotation_player(p_session_id bigint, p_rotation_index integer)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with selected as (
    select session.*, match.id as selected_match_id
    from public.live_match_sessions as session
    join public.matches as match on match.id = session.match_id
    where session.id = p_session_id
  ), rotation as (
    select 0 as slot,
      case when selected.first_serving_team = 1 then selected.team_one_first_server_id else selected.team_two_first_server_id end as player_id
    from selected
    union all
    select 1,
      case when selected.first_serving_team = 1 then selected.team_two_first_server_id else selected.team_one_first_server_id end
    from selected
    union all
    select 2, member.player_id
    from selected
    join public.match_players as member
      on member.match_id = selected.selected_match_id
     and member.team = selected.first_serving_team
     and member.player_id <> case when selected.first_serving_team = 1 then selected.team_one_first_server_id else selected.team_two_first_server_id end
    union all
    select 3, member.player_id
    from selected
    join public.match_players as member
      on member.match_id = selected.selected_match_id
     and member.team <> selected.first_serving_team
     and member.player_id <> case when selected.first_serving_team = 1 then selected.team_two_first_server_id else selected.team_one_first_server_id end
  )
  select rotation.player_id from rotation where rotation.slot = mod(p_rotation_index, 4);
$$;

create or replace function private.live_point_label(p_one smallint, p_two smallint)
returns text
language sql
immutable
set search_path = ''
as $$
  select (array['0','15','30','40'])[p_one + 1] || ':' || (array['0','15','30','40'])[p_two + 1];
$$;

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
          'winningTeam', event.winning_team,
          'serverPlayerId', event.server_player_id,
          'gameNumber', event.game_number,
          'pointLabel', event.point_label_after,
          'teamOneGames', event.team_one_games_after,
          'teamTwoGames', event.team_two_games_after,
          'gameEnded', event.game_ended,
          'break', event.was_break,
          'createdAt', event.created_at
        ) order by event.sequence)
        from public.live_match_events as event
        where event.session_id = session.id
          and event.event_type = 'point'
          and event.voided_at is null
      ), '[]'::jsonb)
    ) end
  ) end
  from selected_match as match
  left join selected_session as session on true;
$$;

create or replace function public.get_public_live_ticker(p_match_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$ select private.live_public_payload(p_match_id); $$;

create or replace function public.get_public_live_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'activeMatch', (
      select jsonb_build_object(
        'matchId', session.match_id,
        'seasonId', match.season_id,
        'teamOneGames', session.team_one_games,
        'teamTwoGames', session.team_two_games,
        'teamOnePoints', session.team_one_points,
        'teamTwoPoints', session.team_two_points,
        'isTiebreak', session.is_tiebreak,
        'teamOneTiebreak', session.team_one_tiebreak,
        'teamTwoTiebreak', session.team_two_tiebreak
      )
      from public.live_match_sessions as session
      join public.matches as match on match.id = session.match_id
      where session.status in ('live','needs_server','ready_to_finish')
      order by session.started_at desc limit 1
    ),
    'historyMatchIds', coalesce((
      select jsonb_agg(distinct session.match_id)
      from public.live_match_sessions as session
      where session.status = 'finished'
    ), '[]'::jsonb)
  );
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

create or replace function public.get_live_scorer_candidates(p_match_id text)
returns table (profile_id uuid, display_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me record;
begin
  select profile.* into me from public.profiles as profile where profile.id = (select auth.uid());
  if me.id is null then raise exception 'Nicht angemeldet.'; end if;
  if me.app_role <> 'admin' and not exists (
    select 1 from public.match_players as member
    where member.match_id = p_match_id and member.player_id = me.player_id
  ) then raise exception 'Nur Beteiligte dürfen einen Schreiber festlegen.'; end if;
  return query
    select profile.id, profile.display_name
    from public.profiles as profile
    join auth.users as auth_user on auth_user.id = profile.id and auth_user.email_confirmed_at is not null
    order by profile.display_name;
end;
$$;

create or replace function public.nominate_live_scorer(p_match_id text, p_scorer_profile_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  me record;
  selected_match record;
  new_id bigint;
begin
  select profile.* into me from public.profiles as profile where profile.id = (select auth.uid());
  if me.id is null or not private.user_email_is_confirmed(me.id) then raise exception 'Bitte zuerst anmelden und die E-Mail-Adresse bestätigen.'; end if;
  select match.* into selected_match from public.matches as match where match.id = p_match_id for update;
  if selected_match.id is null or selected_match.competition_stage <> 'final_four' or selected_match.format <> 'single-set'
    or selected_match.match_at is null or selected_match.actual_sets is not null then
    raise exception 'Für diese Partie kann kein Schreiber festgelegt werden.';
  end if;
  if (select count(*) from public.match_players as member where member.match_id = p_match_id) <> 4 then
    raise exception 'Für den Liveticker müssen vier Spieler feststehen.';
  end if;
  if exists (select 1 from public.live_match_sessions as session where session.match_id = p_match_id and session.status <> 'cancelled') then
    raise exception 'Nach dem Start kann der Schreiber nicht mehr geändert werden.';
  end if;
  if me.app_role <> 'admin' and not exists (
    select 1 from public.match_players as member where member.match_id = p_match_id and member.player_id = me.player_id
  ) then raise exception 'Nur Beteiligte dürfen einen Schreiber festlegen.'; end if;
  if not private.user_email_is_confirmed(p_scorer_profile_id) then raise exception 'Dieses Konto ist nicht bestätigt.'; end if;
  update public.live_match_scorer_assignments set status = 'revoked', revoked_at = now()
    where match_id = p_match_id and status in ('pending','accepted');
  insert into public.live_match_scorer_assignments(match_id, scorer_profile_id, nominated_by)
  values (p_match_id, p_scorer_profile_id, me.id) returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.respond_live_scorer_assignment(p_assignment_id bigint, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare selected_assignment record;
begin
  select assignment.* into selected_assignment
  from public.live_match_scorer_assignments as assignment
  where assignment.id = p_assignment_id for update;
  if selected_assignment.id is null or selected_assignment.scorer_profile_id <> (select auth.uid()) or selected_assignment.status <> 'pending' then
    raise exception 'Diese Anfrage ist nicht mehr offen.';
  end if;
  update public.live_match_scorer_assignments
  set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now()
  where id = p_assignment_id;
end;
$$;

create or replace function public.revoke_live_scorer(p_match_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare me record;
begin
  select profile.* into me from public.profiles as profile where profile.id = (select auth.uid());
  if me.id is null then raise exception 'Nicht angemeldet.'; end if;
  if exists (select 1 from public.live_match_sessions as session where session.match_id = p_match_id and session.status <> 'cancelled') then
    raise exception 'Nach dem Start kann der Schreiber nicht mehr geändert werden.';
  end if;
  if me.app_role <> 'admin' and not exists (
    select 1 from public.match_players as member where member.match_id = p_match_id and member.player_id = me.player_id
  ) then raise exception 'Nur Beteiligte dürfen die Zuweisung aufheben.'; end if;
  update public.live_match_scorer_assignments set status = 'revoked', revoked_at = now()
  where match_id = p_match_id and status in ('pending','accepted');
end;
$$;

create or replace function public.start_live_match(p_match_id text, p_first_server_player_id text)
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
    match_id, revision, first_serving_team, team_one_first_server_id,
    team_two_first_server_id, current_server_player_id
  ) values (
    p_match_id, next_revision, first_team,
    case when first_team = 1 then p_first_server_player_id end,
    case when first_team = 2 then p_first_server_player_id end,
    p_first_server_player_id
  ) returning id into new_session_id;
  insert into public.live_match_events(session_id, sequence, event_type, actor_user_id, server_player_id, payload)
  values (new_session_id, 1, 'server_set', (select auth.uid()), p_first_server_player_id, jsonb_build_object('team', first_team));
  return private.live_public_payload(p_match_id);
end;
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
    where event.session_id = session.id and event.event_type = 'point'
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

create or replace function public.undo_live_point(p_match_id text, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare session public.live_match_sessions%rowtype; point_event public.live_match_events%rowtype; next_sequence integer;
begin
  if not private.live_user_can_score(p_match_id) then raise exception 'Keine Schreibberechtigung.'; end if;
  select active.* into session from public.live_match_sessions as active
  where active.match_id = p_match_id and active.status in ('live','needs_server','ready_to_finish') for update;
  if session.id is null then raise exception 'Die Partie ist nicht live.'; end if;
  if session.version <> p_expected_version then raise exception 'Der Liveticker wurde zwischenzeitlich aktualisiert.' using errcode = '40001'; end if;
  select event.* into point_event from public.live_match_events as event
  where event.session_id = session.id and event.event_type = 'point' and event.voided_at is null
  order by event.sequence desc limit 1 for update;
  if point_event.id is null then raise exception 'Es gibt noch keinen Punkt zum Zurücknehmen.'; end if;
  update public.live_match_events set voided_at = now(), voided_by = (select auth.uid()) where id = point_event.id;
  update public.live_match_sessions set
    status = point_event.before_state->>'status',
    current_server_player_id = point_event.before_state->>'currentServerPlayerId',
    team_one_games = (point_event.before_state->>'teamOneGames')::smallint,
    team_two_games = (point_event.before_state->>'teamTwoGames')::smallint,
    team_one_points = (point_event.before_state->>'teamOnePoints')::smallint,
    team_two_points = (point_event.before_state->>'teamTwoPoints')::smallint,
    is_tiebreak = (point_event.before_state->>'isTiebreak')::boolean,
    team_one_tiebreak = (point_event.before_state->>'teamOneTiebreak')::smallint,
    team_two_tiebreak = (point_event.before_state->>'teamTwoTiebreak')::smallint,
    game_number = (point_event.before_state->>'gameNumber')::smallint,
    version = version + 1, updated_at = now()
  where id = session.id;
  select coalesce(max(event.sequence), 0) + 1 into next_sequence from public.live_match_events as event where event.session_id = session.id;
  insert into public.live_match_events(session_id, sequence, event_type, actor_user_id, payload)
  values (session.id, next_sequence, 'undo', (select auth.uid()), jsonb_build_object('voidedSequence', point_event.sequence));
  return private.live_public_payload(p_match_id);
end;
$$;

create or replace function public.finish_live_match(p_match_id text, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  session public.live_match_sessions%rowtype;
  selected_match public.matches%rowtype;
  details text;
  sets text;
  winning_team smallint;
  next_sequence integer;
begin
  if not private.live_user_can_score(p_match_id) then raise exception 'Keine Schreibberechtigung.'; end if;
  select active.* into session from public.live_match_sessions as active
  where active.match_id = p_match_id and active.status = 'ready_to_finish' for update;
  if session.id is null then raise exception 'Die Partie ist noch nicht beendet.'; end if;
  if session.version <> p_expected_version then raise exception 'Der Liveticker wurde zwischenzeitlich aktualisiert.' using errcode = '40001'; end if;
  select match.* into selected_match from public.matches as match where match.id = p_match_id for update;
  if selected_match.actual_sets is not null then
    raise exception 'Für diese Partie wurde zwischenzeitlich bereits ein offizielles Ergebnis eingetragen.';
  end if;
  winning_team := case when session.team_one_games > session.team_two_games then 1 else 2 end;
  details := session.team_one_games::text || ':' || session.team_two_games::text;
  if (session.team_one_games = 7 and session.team_two_games = 6) or (session.team_one_games = 6 and session.team_two_games = 7) then
    details := details || ' (' || session.team_one_tiebreak::text || ':' || session.team_two_tiebreak::text || ')';
  end if;
  sets := case when winning_team = 1 then '1:0' else '0:1' end;
  perform private.validate_result_for_format('single-set', details, sets, winning_team);
  perform set_config('app.live_finish_match_id', p_match_id, true);
  update public.matches set match_at = session.started_at, result_details = details,
    actual_sets = sets, winner = winning_team, betting_open = false where id = p_match_id;
  update public.result_proposals set status = 'superseded', resolved_at = now()
    where match_id = p_match_id and status = 'pending';
  update public.live_match_sessions set status = 'finished', version = version + 1,
    finished_at = now(), updated_at = now() where id = session.id;
  select coalesce(max(event.sequence), 0) + 1 into next_sequence from public.live_match_events as event where event.session_id = session.id;
  insert into public.live_match_events(session_id, sequence, event_type, actor_user_id, payload)
  values (session.id, next_sequence, 'finish', (select auth.uid()), jsonb_build_object('result', details, 'sets', sets, 'winner', winning_team));
  return private.live_public_payload(p_match_id);
end;
$$;

create or replace function public.cancel_live_match(p_match_id text, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare session public.live_match_sessions%rowtype; next_sequence integer;
begin
  if not private.live_user_can_score(p_match_id) then raise exception 'Keine Schreibberechtigung.'; end if;
  select active.* into session from public.live_match_sessions as active
  where active.match_id = p_match_id and active.status in ('live','needs_server','ready_to_finish') for update;
  if session.id is null then raise exception 'Die Partie ist nicht live.'; end if;
  if session.version <> p_expected_version then raise exception 'Der Liveticker wurde zwischenzeitlich aktualisiert.' using errcode = '40001'; end if;
  update public.live_match_sessions set status = 'cancelled', version = version + 1, updated_at = now()
  where id = session.id;
  select coalesce(max(event.sequence), 0) + 1 into next_sequence
  from public.live_match_events as event where event.session_id = session.id;
  insert into public.live_match_events(session_id, sequence, event_type, actor_user_id)
  values (session.id, next_sequence, 'cancel', (select auth.uid()));
end;
$$;

create or replace function public.admin_correct_live_match_result(
  p_match_id text, p_result_details text, p_actual_sets text, p_winner smallint, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare me record; selected_match record; session public.live_match_sessions%rowtype; next_sequence integer;
begin
  select profile.* into me from public.profiles as profile where profile.id = (select auth.uid());
  if me.app_role is distinct from 'admin' then raise exception 'Nur Admins dürfen abgeschlossene Liveticker korrigieren.'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Bitte einen Korrekturgrund angeben.'; end if;
  select match.* into selected_match from public.matches as match where match.id = p_match_id for update;
  select archive.* into session from public.live_match_sessions as archive
  where archive.match_id = p_match_id and archive.status = 'finished' order by archive.revision desc limit 1 for update;
  if session.id is null or selected_match.actual_sets is null then raise exception 'Keine abgeschlossene Liveticker-Partie gefunden.'; end if;
  perform private.validate_result_for_format(selected_match.format, trim(p_result_details), p_actual_sets, p_winner);
  insert into public.live_match_official_corrections(
    session_id, corrected_by, previous_result_details, previous_actual_sets, previous_winner,
    corrected_result_details, corrected_actual_sets, corrected_winner, reason
  ) values (
    session.id, me.id, selected_match.result_details, selected_match.actual_sets, selected_match.winner,
    trim(p_result_details), p_actual_sets, p_winner, trim(p_reason)
  );
  update public.matches set result_details = trim(p_result_details), actual_sets = p_actual_sets, winner = p_winner where id = p_match_id;
  update public.live_match_sessions set corrected_at = now(), updated_at = now() where id = session.id;
  select coalesce(max(event.sequence), 0) + 1 into next_sequence from public.live_match_events as event where event.session_id = session.id;
  insert into public.live_match_events(session_id, sequence, event_type, actor_user_id, payload)
  values (session.id, next_sequence, 'official_correction', me.id, jsonb_build_object('reason', trim(p_reason)));
  return private.live_public_payload(p_match_id);
end;
$$;

revoke all on function public.get_public_live_ticker(text), public.get_public_live_status(),
  public.get_my_live_ticker_tasks(), public.get_live_scorer_candidates(text),
  public.nominate_live_scorer(text, uuid), public.respond_live_scorer_assignment(bigint, boolean),
  public.revoke_live_scorer(text), public.start_live_match(text, text),
  public.set_live_team_first_server(text, smallint, text, integer),
  public.record_live_point(text, smallint, integer, uuid), public.undo_live_point(text, integer),
  public.finish_live_match(text, integer), public.cancel_live_match(text, integer),
  public.admin_correct_live_match_result(text, text, text, smallint, text)
from public;
grant execute on function public.get_public_live_ticker(text), public.get_public_live_status() to anon, authenticated;
grant execute on function public.get_my_live_ticker_tasks(), public.get_live_scorer_candidates(text),
  public.nominate_live_scorer(text, uuid), public.respond_live_scorer_assignment(bigint, boolean),
  public.revoke_live_scorer(text), public.start_live_match(text, text),
  public.set_live_team_first_server(text, smallint, text, integer),
  public.record_live_point(text, smallint, integer, uuid), public.undo_live_point(text, integer),
  public.finish_live_match(text, integer), public.cancel_live_match(text, integer),
  public.admin_correct_live_match_result(text, text, text, smallint, text)
to authenticated;

insert into public.matches (
  id, season_id, league_id, matchday, match_type, competition_stage, format,
  display_label, match_at,
  counts_for_ranking, counts_for_elo, team_one_label, team_two_label, betting_open
) values
  ('test-2026-live-1', 'test-2026', 'main', 3, 'final', 'final_four', 'single-set',
   'Liveticker 1', timestamp '2026-10-07 18:00' at time zone 'Europe/Berlin',
   false, false, 'Ludi GMX / Ludi Ionos', 'Ludi Gmail / Ludwig W.', false),
  ('test-2026-live-2', 'test-2026', 'main', 3, 'final', 'final_four', 'single-set',
   'Liveticker 2', timestamp '2026-10-07 18:30' at time zone 'Europe/Berlin',
   false, false, 'Ludi GMX / Ludwig W.', 'Ludi Gmail / Ludi Ionos', false),
  ('test-2026-live-3', 'test-2026', 'main', 3, 'final', 'final_four', 'single-set',
   'Liveticker 3', timestamp '2026-10-07 19:00' at time zone 'Europe/Berlin',
   false, false, 'Ludi Gmail / Ludwig W.', 'Ludi GMX / Ludi Ionos', false)
on conflict (id) do nothing;

insert into public.match_players(match_id, player_id, team, position) values
  ('test-2026-live-1', 'ludi_gmx', 1, 1), ('test-2026-live-1', 'ludi_ionos', 1, 2),
  ('test-2026-live-1', 'ludi_gmail', 2, 1), ('test-2026-live-1', 'ludwig_w', 2, 2),
  ('test-2026-live-2', 'ludi_gmx', 1, 1), ('test-2026-live-2', 'ludwig_w', 1, 2),
  ('test-2026-live-2', 'ludi_gmail', 2, 1), ('test-2026-live-2', 'ludi_ionos', 2, 2),
  ('test-2026-live-3', 'ludi_gmail', 1, 1), ('test-2026-live-3', 'ludwig_w', 1, 2),
  ('test-2026-live-3', 'ludi_gmx', 2, 1), ('test-2026-live-3', 'ludi_ionos', 2, 2)
on conflict (match_id, player_id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'live_match_sessions'
  ) then
    alter publication supabase_realtime add table public.live_match_sessions;
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
