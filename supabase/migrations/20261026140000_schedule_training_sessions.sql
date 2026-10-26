begin;

alter table public.training_sessions
  drop constraint if exists training_sessions_status_check;
alter table public.training_sessions
  add constraint training_sessions_status_check
  check (status in ('scheduled', 'pending', 'confirmed'));

create or replace function private.training_session_at(
  p_played_on date,
  p_display_time time
)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select (p_played_on + p_display_time) at time zone 'Europe/Berlin';
$$;

create or replace function private.enforce_training_session_timing()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  session_at timestamptz := private.training_session_at(new.played_on, new.display_time);
begin
  if new.status = 'scheduled' and session_at <= now() then
    raise exception 'Ein Trainingstermin muss in der Zukunft liegen.';
  end if;
  if tg_op = 'INSERT' and new.status in ('pending', 'confirmed') and session_at > now() then
    raise exception 'Ein Trainingsergebnis darf nicht in der Zukunft liegen.';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_training_session_timing on public.training_sessions;
create trigger enforce_training_session_timing
before insert or update of played_on, display_time, status
on public.training_sessions
for each row execute function private.enforce_training_session_timing();

create function public.schedule_training_session(
  p_played_on date,
  p_display_time time,
  p_player_ids text[],
  p_guest_names jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_profile record;
  normalized_guest_names jsonb := '{}'::jsonb;
  guest_entry record;
  new_session_id bigint;
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  if not private.user_email_is_confirmed(current_user_id) then
    raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen.';
  end if;
  select profile.* into current_profile
  from public.profiles as profile where profile.id = current_user_id;
  if current_profile.app_role not in ('player', 'admin') then
    raise exception 'Nur Spieler dürfen Trainings terminieren.';
  end if;
  if cardinality(p_player_ids) <> 4
    or (select count(distinct id) from unnest(p_player_ids) as id) <> 4 then
    raise exception 'Ein Training benötigt genau vier verschiedene Spieler oder Gäste.';
  end if;
  if current_profile.app_role <> 'admin'
    and not (current_profile.player_id = any(p_player_ids)) then
    raise exception 'Der Ersteller muss am Training teilnehmen.';
  end if;
  if p_guest_names is null or jsonb_typeof(p_guest_names) <> 'object' then
    raise exception 'Die Gastnamen sind ungültig.';
  end if;

  for guest_entry in
    select entry.key, trim(entry.value) as value
    from jsonb_each_text(p_guest_names) as entry
  loop
    if guest_entry.key !~ '^guest:[1-4]$'
      or not (guest_entry.key = any(p_player_ids)) then
      raise exception 'Mindestens ein Gastplatz ist ungültig.';
    end if;
    if char_length(guest_entry.value) not between 2 and 40
      or guest_entry.value ~ '[[:cntrl:]]' then
      raise exception 'Gastnamen müssen 2 bis 40 Zeichen lang sein.';
    end if;
    normalized_guest_names := normalized_guest_names
      || jsonb_build_object(guest_entry.key, guest_entry.value);
  end loop;

  if exists (
    select 1
    from unnest(p_player_ids) as participant(id)
    where not exists (select 1 from public.players as player where player.id = participant.id)
      and not (normalized_guest_names ? participant.id)
  ) or (select count(*) from public.players as player where player.id = any(p_player_ids))
      + (select count(*) from jsonb_object_keys(normalized_guest_names)) <> 4 then
    raise exception 'Jeder Teilnehmer muss ein bekannter Spieler oder benannter Gast sein.';
  end if;

  insert into public.training_sessions (
    played_on, display_time, player_ids, guest_names, created_by, status
  ) values (
    p_played_on, p_display_time, p_player_ids, normalized_guest_names, current_user_id, 'scheduled'
  ) returning id into new_session_id;

  return new_session_id;
end;
$$;

create function public.update_scheduled_training(
  p_session_id bigint,
  p_played_on date,
  p_display_time time,
  p_player_ids text[],
  p_guest_names jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_profile record;
  selected_session record;
  candidate_id bigint;
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  select profile.* into current_profile
  from public.profiles as profile where profile.id = current_user_id;
  select session.* into selected_session
  from public.training_sessions as session
  where session.id = p_session_id and session.status = 'scheduled'
  for update;
  if not found then raise exception 'Der Trainingstermin ist nicht mehr verfügbar.'; end if;
  if current_profile.app_role <> 'admin'
    and selected_session.created_by <> current_user_id then
    raise exception 'Nur der Ersteller darf den Trainingstermin ändern.';
  end if;

  select public.schedule_training_session(
    p_played_on, p_display_time, p_player_ids, p_guest_names
  ) into candidate_id;

  update public.training_sessions as session
  set played_on = candidate.played_on,
    display_time = candidate.display_time,
    player_ids = candidate.player_ids,
    guest_names = candidate.guest_names
  from public.training_sessions as candidate
  where session.id = selected_session.id and candidate.id = candidate_id;

  delete from public.training_sessions where id = candidate_id;
end;
$$;

create function public.delete_scheduled_training(p_session_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  is_admin boolean := false;
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  select profile.app_role = 'admin' into is_admin
  from public.profiles as profile where profile.id = current_user_id;

  delete from public.training_sessions as session
  where session.id = p_session_id
    and session.status = 'scheduled'
    and (session.created_by = current_user_id or is_admin);
  if not found then raise exception 'Der Trainingstermin kann nicht gelöscht werden.'; end if;
end;
$$;

create function public.submit_scheduled_training_result(
  p_session_id bigint,
  p_played_on date,
  p_display_time time,
  p_player_ids text[],
  p_rounds jsonb,
  p_guest_names jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_profile record;
  selected_session record;
  new_session_id bigint;
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  select profile.* into current_profile
  from public.profiles as profile where profile.id = current_user_id;
  select session.* into selected_session
  from public.training_sessions as session
  where session.id = p_session_id and session.status = 'scheduled'
  for update;
  if not found then raise exception 'Der Trainingstermin ist nicht mehr verfügbar.'; end if;
  if current_profile.app_role <> 'admin'
    and (current_profile.player_id is null
      or not (current_profile.player_id = any(selected_session.player_ids))) then
    raise exception 'Nur ein beteiligter Spieler darf das Ergebnis eintragen.';
  end if;
  if not (selected_session.player_ids @> p_player_ids
    and p_player_ids @> selected_session.player_ids)
    or selected_session.guest_names is distinct from p_guest_names then
    raise exception 'Die Teilnehmer eines terminierten Trainings können beim Ergebnis nicht geändert werden.';
  end if;

  select public.create_training_session(
    p_played_on, p_display_time, p_player_ids, p_rounds, p_guest_names
  ) into new_session_id;

  delete from public.training_sessions where id = selected_session.id;
  return new_session_id;
end;
$$;

drop function public.get_my_training_tasks();
create function public.get_my_training_tasks()
returns table (
  session_id bigint,
  training_number bigint,
  created_at timestamptz,
  played_on date,
  display_time time,
  player_ids text[],
  guest_names jsonb,
  status text,
  created_by_me boolean,
  rounds jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with numbered_sessions as (
    select session.*, row_number() over (order by session.created_at, session.id) as training_number
    from public.training_sessions as session
  )
  select
    session.id,
    session.training_number,
    session.created_at,
    session.played_on,
    session.display_time,
    session.player_ids,
    session.guest_names,
    session.status,
    session.created_by = (select auth.uid()),
    (
      select jsonb_agg(jsonb_build_object(
        'round_number', round.round_number,
        'team_one_ids', round.team_one_ids,
        'team_two_ids', round.team_two_ids,
        'result_details', round.result_details,
        'set_count', round.set_count,
        'result_format', round.result_format,
        'is_complete', round.is_complete
      ) order by round.round_number)
      from public.training_rounds as round
      where round.session_id = session.id
    )
  from numbered_sessions as session
  join public.profiles as profile on profile.id = (select auth.uid())
  where session.status in ('scheduled', 'pending')
    and (
      session.created_by = (select auth.uid())
      or profile.app_role = 'admin'
      or (profile.player_id = any(session.player_ids)
        and (session.status = 'scheduled' or session.created_by <> (select auth.uid())))
    )
  order by session.played_on, session.display_time, session.id;
$$;

create function public.get_public_training_feed()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with feed as (
    select
      session.id,
      session.status,
      session.played_on,
      session.display_time,
      private.training_session_at(session.played_on, session.display_time) as training_at,
      (
        select jsonb_agg(jsonb_build_object(
          'id', case when session.guest_names ? member.player_id then null else member.player_id end,
          'displayName', private.training_participant_display_name(member.player_id, session.guest_names),
          'isGuest', session.guest_names ? member.player_id
        ) order by member.ordinality)
        from unnest(session.player_ids) with ordinality as member(player_id, ordinality)
      ) as participants,
      (select count(*)::integer from public.training_rounds as round where round.session_id = session.id) as round_count,
      (
        select coalesce(sum((private.profile_training_metrics(round.result_details))[1]), 0)::integer
        from public.training_rounds as round where round.session_id = session.id
      ) as completed_set_count
    from public.training_sessions as session
    where (session.status = 'scheduled'
        and private.training_session_at(session.played_on, session.display_time) > now())
      or session.status = 'confirmed'
  ), upcoming as (
    select * from feed
    where status = 'scheduled'
    order by training_at, id
    limit 3
  ), recent as (
    select * from feed
    where status = 'confirmed'
    order by training_at desc, id desc
    limit 3
  )
  select jsonb_build_object(
    'upcoming', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sessionId', item.id,
        'playedOn', item.played_on,
        'displayTime', to_char(item.display_time, 'HH24.MI'),
        'participants', item.participants,
        'roundCount', item.round_count,
        'completedSetCount', item.completed_set_count
      ) order by item.training_at, item.id)
      from upcoming as item
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sessionId', item.id,
        'playedOn', item.played_on,
        'displayTime', to_char(item.display_time, 'HH24.MI'),
        'participants', item.participants,
        'roundCount', item.round_count,
        'completedSetCount', item.completed_set_count
      ) order by item.training_at desc, item.id desc)
      from recent as item
    ), '[]'::jsonb)
  );
$$;

revoke all on function private.training_session_at(date, time) from public, anon, authenticated;
revoke all on function private.enforce_training_session_timing() from public, anon, authenticated;

revoke execute on function public.schedule_training_session(date, time, text[], jsonb) from public, anon;
revoke execute on function public.update_scheduled_training(bigint, date, time, text[], jsonb) from public, anon;
revoke execute on function public.delete_scheduled_training(bigint) from public, anon;
revoke execute on function public.submit_scheduled_training_result(bigint, date, time, text[], jsonb, jsonb) from public, anon;
revoke execute on function public.get_my_training_tasks() from public, anon;
revoke execute on function public.get_public_training_feed() from public;

grant execute on function public.schedule_training_session(date, time, text[], jsonb) to authenticated;
grant execute on function public.update_scheduled_training(bigint, date, time, text[], jsonb) to authenticated;
grant execute on function public.delete_scheduled_training(bigint) to authenticated;
grant execute on function public.submit_scheduled_training_result(bigint, date, time, text[], jsonb, jsonb) to authenticated;
grant execute on function public.get_my_training_tasks() to authenticated;
grant execute on function public.get_public_training_feed() to anon, authenticated;

commit;
