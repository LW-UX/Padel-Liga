begin;

create table private.preferred_play_times (
  player_id text primary key references public.players(id) on delete cascade,
  preference text not null check (preference in ('morning', 'midday', 'evening'))
);

create function public.get_my_preferred_play_time()
returns text language sql stable security definer set search_path = '' as $$
  select preference.preference
  from public.profiles profile
  join private.preferred_play_times preference on preference.player_id = profile.player_id
  where profile.id = (select auth.uid()) and profile.app_role in ('player', 'admin');
$$;

create function public.set_my_preferred_play_time(p_preference text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  player text;
begin
  select profile.player_id into player from public.profiles profile
  where profile.id = (select auth.uid()) and profile.app_role in ('player', 'admin');
  if player is null or not private.user_email_is_confirmed((select auth.uid())) then
    raise exception 'Diese Einstellung ist nur für bestätigte Spielerkonten verfügbar.';
  end if;
  if p_preference is null then
    delete from private.preferred_play_times where player_id = player;
  else
    insert into private.preferred_play_times (player_id, preference) values (player, p_preference)
    on conflict (player_id) do update set preference = excluded.preference;
  end if;
  return p_preference;
end;
$$;

revoke all on function public.get_my_preferred_play_time(), public.set_my_preferred_play_time(text)
  from public, anon, authenticated;
grant execute on function public.get_my_preferred_play_time(), public.set_my_preferred_play_time(text) to authenticated;

create function private.padel_schedule_blocks(p_players text[], p_match text, p_training bigint,
  p_from timestamptz, p_until timestamptz)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select game.starts_at, game.ends_at
  from (
    select match.match_at as starts_at, coalesce(booking.ends_at, match.match_at + interval '1 hour') as ends_at
    from public.matches match
    left join private.court_bookings booking on booking.match_id = match.id
      and booking.cancelled_at is null and booking.starts_at = match.match_at
    where match.id is distinct from p_match and match.cancelled_at is null
      and match.actual_sets is null and match.result_details is null
      and match.match_at is not null
      and exists (
        select 1 from public.match_players member
        where member.match_id = match.id and member.player_id = any(p_players)
      )
    union all
    select timing.starts_at, coalesce(booking.ends_at, timing.starts_at + interval '1 hour')
    from public.training_sessions training
    cross join lateral (select private.training_session_at(training.played_on, training.display_time) as starts_at) timing
    left join private.court_bookings booking on booking.training_session_id = training.id
      and booking.cancelled_at is null and booking.starts_at = timing.starts_at
    where training.id is distinct from p_training and training.status = 'scheduled'
      and training.player_ids && p_players
  ) game
  where game.starts_at < p_until and game.ends_at > p_from;
$$;

create function public.get_court_planning_subject(p_user_id uuid, p_match_id text,
  p_from timestamptz, p_until timestamptz)
returns jsonb language sql stable security definer set search_path = '' as $$
  with members as (
    select member.player_id, member.team,
      lower(trim(account.email)) as email, preference.preference
    from public.match_players member
    left join public.profiles profile on profile.player_id = member.player_id
    left join auth.users account on account.id = profile.id and account.email_confirmed_at is not null
    left join private.preferred_play_times preference on preference.player_id = member.player_id
    where member.match_id = p_match_id
  ), permitted as (
    select match.id, array_agg(members.player_id order by members.player_id) as players
    from public.matches match
    join public.seasons season on season.id = match.season_id and season.results_entry_enabled
    cross join members
    where match.id = p_match_id and match.cancelled_at is null and match.actual_sets is null
      and match.result_details is null and p_until > p_from and p_until <= p_from + interval '17 days'
      and not exists (
        select 1 from public.result_proposals proposal
        where proposal.match_id = match.id and proposal.status = 'pending'
      )
      and exists (
        select 1 from public.profiles caller
        join members mine on mine.player_id = caller.player_id
        where caller.id = p_user_id and caller.app_role in ('player', 'admin')
          and private.user_email_is_confirmed(caller.id)
      )
    group by match.id
    having count(*) = 4 and count(*) filter (where members.team = 1) = 2
      and count(*) filter (where members.team = 2) = 2
  )
  select jsonb_build_object(
    'members', (select jsonb_agg(jsonb_build_object('email', email, 'preference', preference)) from members),
    'games', coalesce((
      select jsonb_agg(to_jsonb(game))
      from private.padel_schedule_blocks(permitted.players, p_match_id, null, p_from, p_until) game
    ), '[]'::jsonb),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object('court_resource_id', booking.court_resource_id, 'court_name', booking.court_name,
        'starts_at', booking.starts_at, 'ends_at', booking.ends_at))
      from private.court_bookings booking
      where booking.cancelled_at is null and booking.starts_at < p_until and booking.ends_at > p_from
    ), '[]'::jsonb)
  ) from permitted;
$$;

revoke all on function public.get_court_planning_subject(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.get_court_planning_subject(uuid, text, timestamptz, timestamptz) to service_role;

create function private.assert_manual_padel_schedule(p_match text, p_training bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  players text[];
  starts timestamptz;
  ends timestamptz;
begin
  if p_match is not null then
    select match.match_at, coalesce(booking.ends_at, match.match_at + interval '1 hour'),
      array(select member.player_id from public.match_players member where member.match_id = match.id)
    into starts, ends, players
    from public.matches match
    left join private.court_bookings booking on booking.match_id = match.id
      and booking.cancelled_at is null and booking.starts_at = match.match_at
    where match.id = p_match;
  else
    select timing.starts_at, coalesce(booking.ends_at, timing.starts_at + interval '1 hour'), training.player_ids
    into starts, ends, players
    from public.training_sessions training
    cross join lateral (select private.training_session_at(training.played_on, training.display_time) as starts_at) timing
    left join private.court_bookings booking on booking.training_session_id = training.id
      and booking.cancelled_at is null and booking.starts_at = timing.starts_at
    where training.id = p_training;
  end if;
  if starts is not null and ends > now() and exists (
    select 1 from private.padel_schedule_blocks(players, p_match, p_training, starts, ends)
  ) then
    raise exception 'Diese Spielzeit überschneidet sich mit einem anderen Padelspiel.';
  end if;
end;
$$;

-- Validate the final time and booking duration in the same transaction as the manual write.
-- The mail importer continues to use its own entry points.
alter function private.schedule_match_with_court_booking(text, timestamp without time zone, bigint)
  rename to schedule_match_before_overlap_check;
create function private.schedule_match_with_court_booking(p_match_id text,
  p_match_at timestamp without time zone, p_court_booking_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(20261127, 1600);
  perform private.schedule_match_before_overlap_check(p_match_id, p_match_at, p_court_booking_id);
  perform private.assert_manual_padel_schedule(p_match_id, null);
end;
$$;

alter function public.schedule_training_session(date, time, text[], jsonb) set schema private;
alter function public.update_scheduled_training(bigint, date, time, text[], jsonb) set schema private;
alter function public.save_training_with_court_booking(bigint, date, time, text[], jsonb, bigint) set schema private;

create function public.schedule_training_session(p_played_on date, p_display_time time,
  p_player_ids text[], p_guest_names jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  session_id bigint;
begin
  perform pg_advisory_xact_lock(20261127, 1600);
  session_id := private.schedule_training_session(p_played_on, p_display_time, p_player_ids, p_guest_names);
  perform private.assert_manual_padel_schedule(null, session_id);
  return session_id;
end;
$$;

create function public.update_scheduled_training(p_session_id bigint, p_played_on date, p_display_time time,
  p_player_ids text[], p_guest_names jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(20261127, 1600);
  perform private.update_scheduled_training(p_session_id, p_played_on, p_display_time, p_player_ids, p_guest_names);
  perform private.assert_manual_padel_schedule(null, p_session_id);
end;
$$;

create function public.save_training_with_court_booking(p_session_id bigint, p_played_on date,
  p_display_time time, p_player_ids text[], p_guest_names jsonb, p_court_booking_id bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  session_id bigint;
begin
  perform pg_advisory_xact_lock(20261127, 1600);
  session_id := private.save_training_with_court_booking(p_session_id, p_played_on, p_display_time,
    p_player_ids, p_guest_names, p_court_booking_id);
  perform private.assert_manual_padel_schedule(null, session_id);
  return session_id;
end;
$$;

revoke all on function private.padel_schedule_blocks(text[], text, bigint, timestamptz, timestamptz),
  private.assert_manual_padel_schedule(text, bigint),
  private.schedule_match_with_court_booking(text, timestamp without time zone, bigint),
  private.schedule_match_before_overlap_check(text, timestamp without time zone, bigint),
  private.schedule_training_session(date, time, text[], jsonb),
  private.update_scheduled_training(bigint, date, time, text[], jsonb),
  private.save_training_with_court_booking(bigint, date, time, text[], jsonb, bigint) from public, anon, authenticated;
revoke all on function public.schedule_training_session(date, time, text[], jsonb),
  public.update_scheduled_training(bigint, date, time, text[], jsonb),
  public.save_training_with_court_booking(bigint, date, time, text[], jsonb, bigint) from public, anon, authenticated;
grant execute on function public.schedule_training_session(date, time, text[], jsonb),
  public.update_scheduled_training(bigint, date, time, text[], jsonb),
  public.save_training_with_court_booking(bigint, date, time, text[], jsonb, bigint) to authenticated;

create table private.court_outlook_tokens (
  seed text primary key,
  refresh_token text not null
);

create table private.court_outlook_health (
  id boolean primary key default true check (id),
  status text not null check (status in ('ready', 'not_configured', 'reconnect', 'unavailable', 'calendar_unavailable')),
  checked_at timestamptz not null default now()
);

create function public.get_court_outlook_refresh_token(p_seed text)
returns text language sql stable security definer set search_path = '' as $$
  select refresh_token from private.court_outlook_tokens where seed = p_seed;
$$;

create function public.store_court_outlook_refresh_token(p_seed text, p_previous text, p_token text)
returns void language sql security definer set search_path = '' as $$
  insert into private.court_outlook_tokens (seed, refresh_token) values (p_seed, p_token)
  on conflict (seed) do update set refresh_token = excluded.refresh_token
  where private.court_outlook_tokens.refresh_token = p_previous;
$$;

create function public.record_court_outlook_health(p_status text)
returns void language sql security definer set search_path = '' as $$
  insert into private.court_outlook_health (id, status) values (true, p_status)
  on conflict (id) do update set status = excluded.status, checked_at = now();
$$;

revoke all on function public.get_court_outlook_refresh_token(text),
  public.store_court_outlook_refresh_token(text, text, text), public.record_court_outlook_health(text)
  from public, anon, authenticated;
grant execute on function public.get_court_outlook_refresh_token(text),
  public.store_court_outlook_refresh_token(text, text, text), public.record_court_outlook_health(text) to service_role;

commit;
