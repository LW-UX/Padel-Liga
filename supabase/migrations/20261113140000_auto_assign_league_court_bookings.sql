begin;

-- Mailimport und Terminierung reservieren in gleicher Reihenfolge, bevor sie
-- einzelne Buchungen/Partien sperren. Gleichzeitige Eingänge teilen keinen Slot.
create function private.auto_assign_league_court_booking(p_booking_id bigint, p_match_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking private.court_bookings%rowtype;
  selected_match public.matches%rowtype;
  sync_user_id uuid;
  already_linked boolean := false;
begin
  perform pg_advisory_xact_lock(20261113, 1400);
  select * into booking from private.court_bookings where id = p_booking_id for update;
  if not found or booking.cancelled_at is not null or booking.starts_at <= now()
    or booking.training_session_id is not null
    or extract(minute from booking.starts_at at time zone 'Europe/Berlin') not in (0, 30)
    or extract(second from booking.starts_at) <> 0
    or lower(regexp_replace(trim(booking.organizer), '\s+', ' ', 'g')) <> 'headsquare united' then
    return jsonb_build_object('assignment', 'not_requested');
  end if;

  if booking.match_id is not null then
    select match.* into selected_match from public.matches as match
    where match.id = booking.match_id and match.match_at = booking.starts_at
      and match.cancelled_at is null and match.actual_sets is null and match.result_details is null
      and not exists (select 1 from public.result_proposals as proposal
        where proposal.match_id = match.id and proposal.status = 'pending');
    if not found then return jsonb_build_object('assignment', 'not_requested'); end if;
    already_linked := true;
  else
  select match.* into selected_match
  from public.matches as match
  join public.seasons as season on season.id = match.season_id
  where season.results_entry_enabled
    and match.competition_stage = 'league'
    and (p_match_id is null or match.id = p_match_id)
    and match.cancelled_at is null and match.actual_sets is null and match.result_details is null
    and match.match_at > now()
    and (match.match_at at time zone 'Europe/Berlin')::date = (booking.starts_at at time zone 'Europe/Berlin')::date
    and match.match_at between booking.starts_at - interval '15 minutes' and booking.starts_at + interval '15 minutes'
    and (select count(distinct lineup.player_id) from public.match_players as lineup where lineup.match_id = match.id) = 4
    and not exists (select 1 from public.result_proposals as proposal where proposal.match_id = match.id and proposal.status = 'pending')
    and not exists (select 1 from private.court_bookings as assigned where assigned.match_id = match.id and assigned.cancelled_at is null)
  -- Nummern werden numerisch verglichen (2 vor 10), unabhängig vom Zeitabstand.
  order by coalesce(
    substring(match.display_label from '^Partie ([0-9]+)$')::integer,
    substring(match.id from '-partie-([0-9]+)$')::integer
  ) nulls last, match.season_id, match.league_id, match.id
  limit 1
  for update of match;
  if not found then return jsonb_build_object('assignment', 'not_requested'); end if;

  update private.court_bookings
  set match_id = selected_match.id, assigned_at = now(), assigned_by = null, updated_at = now()
  where id = booking.id;
  update private.court_bookings
  set cancellation_resolved_at = now(), cancellation_resolved_by = null,
      cancellation_resolution = 'replaced', updated_at = now()
  where match_id = selected_match.id and cancelled_at is not null and cancellation_resolved_at is null;
  update public.matches set match_at = booking.starts_at where id = selected_match.id;
  end if;

  -- Nur für den bestehenden internen Schlägerabgleich: Die Automatik ist
  -- unabhängig vom Mailweiterleiter, erhält aber keine zusätzlichen Kontorechte.
  select profile.id into sync_user_id
  from public.profiles as profile join auth.users as account on account.id = profile.id
  where account.email_confirmed_at is not null and (
    profile.app_role = 'admin' or exists (select 1 from public.match_players as member
      where member.match_id = selected_match.id and member.player_id = profile.player_id))
  order by case when profile.app_role = 'admin' then 1 else 0 end, profile.id limit 1;
  return jsonb_build_object('assignment', case when already_linked then 'already_assigned' else 'assigned' end,
    'matchId', selected_match.id, 'actorUserId', sync_user_id);
end;
$$;
revoke all on function private.auto_assign_league_court_booking(bigint, text) from public, anon, authenticated;

create or replace function public.record_court_booking_with_match(
  p_provider_booking_id text,
  p_court_resource_id text,
  p_court_name text,
  p_organizer text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_cancelled boolean,
  p_source_occurred_at timestamptz,
  p_source_precision_seconds integer,
  p_forwarder_email text,
  p_match_number integer,
  p_season_hint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  recorded jsonb;
  selected_booking private.court_bookings%rowtype;
  selected_match public.matches%rowtype;
  forwarder record;
  booking_id bigint;
  candidate_id text;
  candidate_count integer;
  normalized_hint text := nullif(lower(trim(p_season_hint)), '');
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Nicht erlaubt.';
  end if;

  perform pg_advisory_xact_lock(20261113, 1400);

  recorded := public.record_court_booking(
    p_provider_booking_id,
    p_court_resource_id,
    p_court_name,
    p_organizer,
    p_starts_at,
    p_ends_at,
    p_cancelled,
    p_source_occurred_at,
    p_source_precision_seconds
  );

  if p_match_number is null then
    if p_cancelled or recorded ->> 'status' <> 'active' then
      return recorded || jsonb_build_object('assignment', 'not_requested');
    end if;
    return recorded || private.auto_assign_league_court_booking((recorded ->> 'bookingId')::bigint);
  end if;
  if p_match_number < 1 or p_match_number > 999 then
    return recorded || jsonb_build_object('assignment', 'invalid_reference');
  end if;
  if p_cancelled or recorded ->> 'status' <> 'active' then
    return recorded || jsonb_build_object('assignment', 'booking_unavailable');
  end if;
  if nullif(trim(p_forwarder_email), '') is null then
    return recorded || jsonb_build_object('assignment', 'not_authorized');
  end if;

  select account.id, profile.player_id, profile.app_role::text as app_role
  into forwarder
  from auth.users as account
  join public.profiles as profile on profile.id = account.id
  where lower(account.email) = lower(trim(p_forwarder_email))
    and account.email_confirmed_at is not null
  limit 1;

  if not found or (forwarder.app_role is distinct from 'admin' and forwarder.player_id is null) then
    return recorded || jsonb_build_object('assignment', 'not_authorized');
  end if;

  booking_id := nullif(recorded ->> 'bookingId', '')::bigint;
  select booking.* into selected_booking
  from private.court_bookings as booking
  where booking.id = booking_id
  for update;

  if not found or selected_booking.cancelled_at is not null or selected_booking.starts_at <= now()
    or selected_booking.training_session_id is not null
    or extract(minute from selected_booking.starts_at at time zone 'Europe/Berlin') not in (0, 30)
    or extract(second from selected_booking.starts_at) <> 0 then
    return recorded || jsonb_build_object('assignment', 'booking_unavailable');
  end if;

  select count(*), min(match.id)
  into candidate_count, candidate_id
  from public.matches as match
  join public.seasons as season on season.id = match.season_id
  where season.results_entry_enabled
    and match.cancelled_at is null
    and match.actual_sets is null
    and match.result_details is null
    and not exists (
      select 1 from public.result_proposals as proposal
      where proposal.match_id = match.id and proposal.status = 'pending'
    )
    and (select count(*) from public.match_players as lineup where lineup.match_id = match.id) = 4
    and (
      lower(coalesce(
        nullif(trim(match.display_label), ''),
        case when match.id ~* '-partie-[0-9]+$'
          then 'Partie ' || substring(match.id from '([0-9]+)$')
        end
      )) = lower('Partie ' || p_match_number::text)
    )
    and (
      normalized_hint is null
      or lower(trim(season.id)) = normalized_hint
      or lower(trim(season.label)) = normalized_hint
    )
    and (
      forwarder.app_role = 'admin'
      or exists (
        select 1 from public.match_players as member
        where member.match_id = match.id and member.player_id = forwarder.player_id
      )
    );

  if candidate_count = 0 then
    return recorded || jsonb_build_object('assignment', 'match_not_found');
  elsif candidate_count > 1 then
    return recorded || jsonb_build_object('assignment', 'ambiguous_match');
  end if;

  select match.* into selected_match
  from public.matches as match
  where match.id = candidate_id
  for update;

  if selected_match.cancelled_at is not null
    or selected_match.actual_sets is not null
    or selected_match.result_details is not null
    or exists (
      select 1 from public.result_proposals as proposal
      where proposal.match_id = selected_match.id and proposal.status = 'pending'
    ) then
    return recorded || jsonb_build_object('assignment', 'match_unavailable');
  end if;

  if selected_booking.match_id is not null and selected_booking.match_id <> selected_match.id then
    return recorded || jsonb_build_object('assignment', 'booking_conflict');
  end if;

  if selected_booking.match_id = selected_match.id
    and selected_match.match_at = selected_booking.starts_at then
    return recorded || jsonb_build_object(
      'assignment', 'already_assigned',
      'matchId', selected_match.id,
      'actorUserId', forwarder.id
    );
  end if;

  -- This mirrors the existing manual scheduling action: an older active court
  -- booking becomes available again when the explicit mail assigns a new one.
  update private.court_bookings as booking
  set match_id = null, assigned_at = null, assigned_by = null, updated_at = now()
  where booking.match_id = selected_match.id
    and booking.cancelled_at is null
    and booking.id <> selected_booking.id;

  update private.court_bookings as booking
  set match_id = selected_match.id,
      assigned_at = now(),
      assigned_by = forwarder.id,
      updated_at = now()
  where booking.id = selected_booking.id;

  update private.court_bookings as booking
  set cancellation_resolved_at = now(),
      cancellation_resolved_by = forwarder.id,
      cancellation_resolution = 'replaced',
      updated_at = now()
  where booking.match_id = selected_match.id
    and booking.cancelled_at is not null
    and booking.cancellation_resolved_at is null;

  update public.matches
  set match_at = selected_booking.starts_at
  where id = selected_match.id;

  return recorded || jsonb_build_object(
    'assignment', 'assigned',
    'matchId', selected_match.id,
    'actorUserId', forwarder.id
  );
end;
$$;

revoke all on function public.record_court_booking_with_match(
  text, text, text, text, timestamptz, timestamptz, boolean, timestamptz, integer, text, integer, text
) from public, anon, authenticated;
grant execute on function public.record_court_booking_with_match(
  text, text, text, text, timestamptz, timestamptz, boolean, timestamptz, integer, text, integer, text
) to service_role;

create or replace function private.schedule_match_with_court_booking(
  p_match_id text,
  p_match_at timestamp without time zone,
  p_court_booking_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_profile record;
  selected_match record;
  selected_booking private.court_bookings%rowtype;
  user_team smallint;
  scheduled_at timestamptz;
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  if not private.user_email_is_confirmed(current_user_id) then
    raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen.';
  end if;
  if p_match_at is null then raise exception 'Bitte Datum und Uhrzeit angeben.'; end if;
  if extract(minute from p_match_at) not in (0, 30) or extract(second from p_match_at) <> 0 then
    raise exception 'Bitte eine volle oder halbe Stunde auswählen.';
  end if;
  perform pg_advisory_xact_lock(20261113, 1400);

  select profile.* into current_profile
  from public.profiles as profile
  where profile.id = current_user_id;
  if not found then raise exception 'Kein Profil für dieses Konto gefunden.'; end if;

  select match.* into selected_match
  from public.matches as match
  join public.seasons as season on season.id = match.season_id
  where match.id = p_match_id and season.results_entry_enabled
  for update of match;
  if not found then raise exception 'Partie nicht gefunden.'; end if;
  if selected_match.cancelled_at is not null then raise exception 'Diese Partie wird nicht gewertet.'; end if;
  if selected_match.actual_sets is not null or selected_match.result_details is not null then
    raise exception 'Die Partie besitzt bereits ein offizielles Ergebnis.';
  end if;
  if exists (
    select 1 from public.result_proposals as proposal
    where proposal.match_id = p_match_id and proposal.status = 'pending'
  ) then
    raise exception 'Für diese Partie wartet bereits ein Ergebnis auf Bestätigung.';
  end if;

  select member.team into user_team
  from public.match_players as member
  where member.match_id = p_match_id and member.player_id = current_profile.player_id;
  if current_profile.app_role is distinct from 'admin' and user_team is null then
    raise exception 'Nur beteiligte Spieler dürfen die Partie terminieren.';
  end if;

  scheduled_at := p_match_at at time zone 'Europe/Berlin';

  if p_court_booking_id is not null then
    select booking.* into selected_booking
    from private.court_bookings as booking
    where booking.id = p_court_booking_id
    for update;
    if not found or selected_booking.cancelled_at is not null or selected_booking.starts_at <= now()
      or selected_booking.training_session_id is not null then
      raise exception 'Diese Platzbuchung ist nicht mehr verfügbar.';
    end if;
    if selected_booking.starts_at <> scheduled_at then
      raise exception 'Termin und Platzbuchung stimmen nicht überein.';
    end if;
    if selected_booking.match_id is not null and selected_booking.match_id <> p_match_id then
      raise exception 'Diese Platzbuchung wurde bereits einer anderen Partie zugeordnet.';
    end if;
  elsif exists (
    select 1 from private.court_bookings as booking
    where booking.match_id = p_match_id
      and booking.cancelled_at is not null
      and booking.cancellation_resolved_at is null
      and selected_match.match_at = booking.starts_at
  ) then
    raise exception 'Bitte zuerst eine neue Platzbuchung zuordnen oder den Termin aufheben.';
  end if;

  -- Eine weiterhin aktive alte Buchung bleibt nur verknüpft, wenn derselbe
  -- Zeitpunkt gespeichert wird. Andernfalls wird sie wieder frei zuordenbar.
  update private.court_bookings as booking
  set match_id = null, assigned_at = null, assigned_by = null, updated_at = now()
  where booking.match_id = p_match_id
    and booking.cancelled_at is null
    and (
      p_court_booking_id is not null and booking.id <> p_court_booking_id
      or p_court_booking_id is null and booking.starts_at <> scheduled_at
    );

  if p_court_booking_id is not null then
    update private.court_bookings as booking
    set match_id = p_match_id,
        assigned_at = now(),
        assigned_by = current_user_id,
        updated_at = now()
    where booking.id = p_court_booking_id;

    update private.court_bookings as booking
    set cancellation_resolved_at = now(),
        cancellation_resolved_by = current_user_id,
        cancellation_resolution = 'replaced',
        updated_at = now()
    where booking.match_id = p_match_id
      and booking.cancelled_at is not null
      and booking.cancellation_resolved_at is null;
  end if;

  update public.matches set match_at = scheduled_at where id = p_match_id;

  if p_court_booking_id is null then
    -- Bereits importierte Buchungen werden beim Terminieren mit berücksichtigt.
    select booking.* into selected_booking from private.court_bookings as booking
    where booking.match_id is null and booking.training_session_id is null
      and booking.cancelled_at is null and booking.starts_at > now()
      and lower(regexp_replace(trim(booking.organizer), '\s+', ' ', 'g')) = 'headsquare united'
      and (booking.starts_at at time zone 'Europe/Berlin')::date = p_match_at::date
      and booking.starts_at between scheduled_at - interval '15 minutes' and scheduled_at + interval '15 minutes'
    order by booking.received_at, booking.id limit 1 for update;
    if found then
      perform private.auto_assign_league_court_booking(selected_booking.id, p_match_id);
    end if;
  end if;
end;
$$;


-- Ergebniszeiten bleiben frei; ausschließlich geplante Trainings folgen dem Platzraster.
create function private.enforce_training_half_hour_schedule()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'scheduled' and (extract(minute from new.display_time) not in (0, 30)
    or extract(second from new.display_time) <> 0) then
    raise exception 'Bitte eine volle oder halbe Stunde auswählen.';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_training_half_hour_schedule() from public, anon, authenticated;
create trigger enforce_training_half_hour_schedule
before insert or update of played_on, display_time, status on public.training_sessions
for each row execute function private.enforce_training_half_hour_schedule();

notify pgrst, 'reload schema';
commit;
