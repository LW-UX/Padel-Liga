begin;

-- Buchungsmails liefern einen privaten Nachweis für bereits reservierte Plätze.
-- Die öffentliche Playtomic-Abfrage bleibt davon unabhängig und kennt weiterhin
-- nur frei oder nicht frei. Stornierte Buchungen bleiben intern als Tombstone
-- erhalten, erscheinen aber in keiner Buchungsauswahl.
create table private.court_bookings (
  id bigint generated always as identity primary key,
  provider_booking_id text unique,
  court_resource_id text,
  court_name text not null,
  organizer text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  match_id text references public.matches(id) on delete set null,
  assigned_at timestamptz,
  assigned_by uuid references auth.users(id) on delete set null,
  source_occurred_at timestamptz not null,
  source_precision_seconds integer not null default 1 check (source_precision_seconds in (1, 60)),
  received_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancellation_resolved_at timestamptz,
  cancellation_resolved_by uuid references auth.users(id) on delete set null,
  cancellation_resolution text check (cancellation_resolution in ('unscheduled', 'replaced', 'no_action')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (provider_booking_id is null or length(trim(provider_booking_id)) > 0),
  check (length(trim(court_name)) > 0),
  check (length(trim(organizer)) > 0),
  check (ends_at - starts_at in (interval '60 minutes', interval '90 minutes')),
  check ((cancellation_resolved_at is null) = (cancellation_resolution is null))
);

create index court_bookings_active_start_idx
  on private.court_bookings (starts_at)
  where cancelled_at is null;

create unique index court_bookings_one_active_per_match_idx
  on private.court_bookings (match_id)
  where match_id is not null and cancelled_at is null;

create unique index court_bookings_one_active_per_slot_idx
  on private.court_bookings (lower(trim(court_name)), starts_at, ends_at)
  where cancelled_at is null;

revoke all on private.court_bookings from public, anon, authenticated;

-- Stabile Übergabe für die separat eingerichtete Mailverarbeitung. Nur eine
-- service_role darf Bestätigungen oder Stornierungen verbuchen. Die originale
-- Ereigniszeit verhindert, dass eine verspätet weitergeleitete Bestätigung eine
-- neuere Stornierung wieder aktiviert.
create function public.record_court_booking(
  p_provider_booking_id text,
  p_court_resource_id text,
  p_court_name text,
  p_organizer text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_cancelled boolean,
  p_source_occurred_at timestamptz,
  p_source_precision_seconds integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_booking private.court_bookings%rowtype;
  booking_id bigint;
  candidate_count integer;
  effective_cancelled boolean;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Nicht erlaubt.';
  end if;
  if nullif(trim(p_court_name), '') is null
    or nullif(trim(p_organizer), '') is null
    or p_starts_at is null
    or p_ends_at is null
    or p_source_occurred_at is null
    or p_cancelled is null
    or p_source_precision_seconds is null
    or p_source_precision_seconds not in (1, 60) then
    raise exception 'Unvollständige Buchungsdaten.';
  end if;
  if p_ends_at - p_starts_at not in (interval '60 minutes', interval '90 minutes') then
    raise exception 'Eine Platzbuchung muss 60 oder 90 Minuten umfassen.';
  end if;

  -- Serialize matching imports, including the first event for a slot. Row
  -- locks alone cannot protect a booking that has not been inserted yet.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    lower(trim(p_court_name)) || '|' || p_starts_at::text || '|' || p_ends_at::text, 0));
  if nullif(trim(p_provider_booking_id), '') is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(trim(p_provider_booking_id), 1));
  end if;

  if nullif(trim(p_provider_booking_id), '') is not null then
    select booking.* into existing_booking
    from private.court_bookings as booking
    where booking.provider_booking_id = trim(p_provider_booking_id)
    for update;
  end if;

  if existing_booking.id is not null and (
    lower(trim(existing_booking.court_name)) <> lower(trim(p_court_name))
    or lower(trim(existing_booking.organizer)) <> lower(trim(p_organizer))
    or existing_booking.starts_at <> p_starts_at or existing_booking.ends_at <> p_ends_at
  ) then
    return jsonb_build_object('status', 'needs_review');
  end if;

  -- Deutsche Stornierungsmails enthalten keine Playtomic-ID. Ohne direkten
  -- Treffer ist deshalb nur genau eine aktive Buchung desselben Platzes und
  -- absoluten Zeitfensters ein zulässiger Kandidat.
  if existing_booking.id is null then
    select count(*), min(booking.id) into candidate_count, booking_id
    from private.court_bookings as booking
    where booking.cancelled_at is null
      and lower(trim(booking.court_name)) = lower(trim(p_court_name))
      and lower(trim(booking.organizer)) = lower(trim(p_organizer))
      and booking.starts_at = p_starts_at
      and booking.ends_at = p_ends_at;

    if candidate_count > 1 then
      return jsonb_build_object('status', 'needs_review');
    elsif candidate_count = 1 then
      select booking.* into existing_booking
      from private.court_bookings as booking
      where booking.id = booking_id
      for update;
    end if;
  end if;

  -- A new provider ID denotes a different booking, never an update to the
  -- active occupant of this slot. Missing cancellation requires review.
  if existing_booking.id is not null
    and existing_booking.provider_booking_id is not null
    and nullif(trim(p_provider_booking_id), '') is not null
    and existing_booking.provider_booking_id <> trim(p_provider_booking_id) then
    return jsonb_build_object('status', 'needs_review');
  end if;

  if existing_booking.id is null and p_cancelled then
    select booking.id into booking_id
    from private.court_bookings as booking
    where booking.cancelled_at is not null
      and lower(trim(booking.court_name)) = lower(trim(p_court_name))
      and lower(trim(booking.organizer)) = lower(trim(p_organizer))
      and booking.starts_at = p_starts_at
      and booking.ends_at = p_ends_at
      and booking.source_occurred_at + booking.source_precision_seconds * interval '1 second' > p_source_occurred_at
    order by booking.source_occurred_at desc
    limit 1;
    if booking_id is not null then
      return jsonb_build_object('bookingId', booking_id, 'status', 'cancelled');
    end if;
    -- Keep an invisible tombstone even when cancellation arrives first.
    -- Otherwise a delayed older confirmation would create an active slot.
  end if;

  -- Eine verspätet weitergeleitete Bestätigung ohne Kalender-ID darf eine
  -- zeitlich neuere Stornierung desselben Buchenden und Slots nicht umgehen.
  if existing_booking.id is null and not p_cancelled then
    select booking.id into booking_id
    from private.court_bookings as booking
    where booking.cancelled_at is not null
      and lower(trim(booking.court_name)) = lower(trim(p_court_name))
      and lower(trim(booking.organizer)) = lower(trim(p_organizer))
      and booking.starts_at = p_starts_at
      and booking.ends_at = p_ends_at
      and booking.source_occurred_at + booking.source_precision_seconds * interval '1 second' > p_source_occurred_at
    order by booking.source_occurred_at desc
    limit 1;
    if booking_id is not null then
      return jsonb_build_object('bookingId', booking_id, 'status', 'cancelled');
    end if;
  end if;

  if existing_booking.id is null then
    insert into private.court_bookings (
      provider_booking_id, court_resource_id, court_name, organizer, starts_at, ends_at,
      source_occurred_at, source_precision_seconds, cancelled_at
    ) values (
      nullif(trim(p_provider_booking_id), ''), nullif(trim(p_court_resource_id), ''), trim(p_court_name), trim(p_organizer),
      p_starts_at, p_ends_at, p_source_occurred_at, p_source_precision_seconds,
      case when p_cancelled then p_source_occurred_at else null end
    ) returning id into booking_id;
  elsif existing_booking.cancelled_at is not null and not p_cancelled then
    -- A confirmation cannot uncancel a known provider booking. A genuine
    -- rebooking needs a different provider ID and a clearly later event.
    booking_id := existing_booking.id;
  elsif p_source_occurred_at < existing_booking.source_occurred_at + existing_booking.source_precision_seconds * interval '1 second'
    and existing_booking.source_occurred_at < p_source_occurred_at + p_source_precision_seconds * interval '1 second'
    and p_cancelled <> (existing_booking.cancelled_at is not null) then
    return jsonb_build_object('bookingId', existing_booking.id, 'status', 'needs_review');
  elsif p_source_occurred_at <= existing_booking.source_occurred_at then
    booking_id := existing_booking.id;
  else
    update private.court_bookings as booking
    set provider_booking_id = coalesce(nullif(trim(p_provider_booking_id), ''), booking.provider_booking_id),
        court_resource_id = coalesce(nullif(trim(p_court_resource_id), ''), booking.court_resource_id),
        court_name = trim(p_court_name),
        organizer = trim(p_organizer),
        starts_at = p_starts_at,
        ends_at = p_ends_at,
        source_occurred_at = p_source_occurred_at,
        source_precision_seconds = p_source_precision_seconds,
        received_at = now(),
        cancelled_at = case when p_cancelled then p_source_occurred_at else null end,
        match_id = case
          when not p_cancelled and booking.cancelled_at is not null then null
          else booking.match_id
        end,
        assigned_at = case
          when not p_cancelled and booking.cancelled_at is not null then null
          else booking.assigned_at
        end,
        assigned_by = case
          when not p_cancelled and booking.cancelled_at is not null then null
          else booking.assigned_by
        end,
        cancellation_resolved_at = null,
        cancellation_resolved_by = null,
        cancellation_resolution = null,
        updated_at = now()
    where booking.id = existing_booking.id
    returning booking.id into booking_id;
  end if;

  select booking.cancelled_at is not null into effective_cancelled
  from private.court_bookings as booking where booking.id = booking_id;
  return jsonb_build_object(
    'bookingId', booking_id,
    'status', case when effective_cancelled then 'cancelled' else 'active' end
  );
end;
$$;

-- Spieler sehen aktive gemeinsame Buchungen zur Zuordnung. Bereits zugeordnete
-- Buchungen sehen nur die Beteiligten; Admins dürfen den gesamten Bestand sehen.
create function public.get_my_court_bookings(p_date date default null)
returns table (
  booking_id bigint,
  court_resource_id text,
  court_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  match_id text,
  match_label text
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select profile.player_id, profile.app_role
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.app_role in ('player', 'admin')
  )
  select booking.id, booking.court_resource_id, booking.court_name,
    booking.starts_at, booking.ends_at, booking.match_id, match.display_label
  from private.court_bookings as booking
  cross join me
  left join public.matches as match on match.id = booking.match_id
  where booking.cancelled_at is null
    and booking.ends_at > now()
    and (
      p_date is null
      or (booking.starts_at at time zone 'Europe/Berlin')::date = p_date
    )
    and (
      booking.match_id is null
      or me.app_role = 'admin'
      or exists (
        select 1 from public.match_players as member
        where member.match_id = booking.match_id
          and member.player_id = me.player_id
      )
    )
  order by booking.starts_at, booking.court_name, booking.id;
$$;

-- Eine stornierte, weiterhin terminierte Buchung ist genau eine gemeinsame
-- Aufgabe der vier Beteiligten. Sobald einer reagiert, verschwindet sie für alle.
create function public.get_my_court_booking_cancellation_tasks()
returns table (
  booking_id bigint,
  match_id text,
  season_id text,
  league_label text,
  display_label text,
  court_name text,
  starts_at timestamptz,
  team_one_label text,
  team_two_label text
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select profile.player_id
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.app_role in ('player', 'admin')
  )
  select booking.id, match.id, match.season_id, league.label, match.display_label,
    booking.court_name, booking.starts_at, match.team_one_label, match.team_two_label
  from private.court_bookings as booking
  join public.matches as match on match.id = booking.match_id
  join public.leagues as league
    on league.season_id = match.season_id and league.id = match.league_id
  cross join me
  join public.match_players as member
    on member.match_id = match.id and member.player_id = me.player_id
  where booking.cancelled_at is not null
    and booking.cancellation_resolved_at is null
    and match.match_at = booking.starts_at
    and match.match_at > now()
    and match.actual_sets is null
    and match.result_details is null
    and match.cancelled_at is null
    and not exists (
      select 1 from public.result_proposals as proposal
      where proposal.match_id = match.id and proposal.status = 'pending'
    )
  order by booking.starts_at, booking.id;
$$;

-- Gemeinsame Implementierung für alte Clients ohne Buchungs-ID und die neue
-- Terminierung mit einer bestätigten Platzbuchung.
create function private.schedule_match_with_court_booking(
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
    if not found or selected_booking.cancelled_at is not null then
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
end;
$$;

create or replace function public.schedule_match(
  p_match_id text,
  p_match_at timestamp without time zone
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.schedule_match_with_court_booking(p_match_id, p_match_at, null);
end;
$$;

create function public.schedule_match(
  p_match_id text,
  p_match_at timestamp without time zone,
  p_court_booking_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.schedule_match_with_court_booking(p_match_id, p_match_at, p_court_booking_id);
end;
$$;

-- Die erste Bestätigung eines beteiligten Spielers hebt den Termin für alle auf.
-- Parallele oder verspätete Bestätigungen sind durch die gesperrte Buchungszeile
-- idempotent und verändern den Termin nicht erneut.
create function public.confirm_court_booking_cancellation(p_booking_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_profile record;
  booking private.court_bookings%rowtype;
  selected_match record;
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  if not private.user_email_is_confirmed(current_user_id) then
    raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen.';
  end if;

  select profile.* into current_profile
  from public.profiles as profile
  where profile.id = current_user_id;
  if not found or current_profile.player_id is null then
    raise exception 'Kein Spielerprofil für dieses Konto gefunden.';
  end if;

  select entry.* into booking
  from private.court_bookings as entry
  where entry.id = p_booking_id
  for update;
  if not found or booking.cancelled_at is null or booking.match_id is null then
    raise exception 'Die stornierte Platzbuchung wurde nicht gefunden.';
  end if;

  if not exists (
    select 1 from public.match_players as member
    where member.match_id = booking.match_id
      and member.player_id = current_profile.player_id
  ) then
    raise exception 'Nur beteiligte Spieler dürfen den Termin aufheben.';
  end if;

  if booking.cancellation_resolved_at is not null then
    return jsonb_build_object('status', 'already_resolved', 'matchId', booking.match_id);
  end if;

  select match.* into selected_match
  from public.matches as match
  where match.id = booking.match_id
  for update;

  if not found
    or selected_match.match_at is distinct from booking.starts_at
    or selected_match.actual_sets is not null
    or selected_match.result_details is not null
    or selected_match.cancelled_at is not null
    or exists (
      select 1 from private.court_bookings as replacement
      where replacement.match_id = booking.match_id
        and replacement.cancelled_at is null
    ) then
    update private.court_bookings
    set cancellation_resolved_at = now(), cancellation_resolved_by = current_user_id,
        cancellation_resolution = 'no_action', updated_at = now()
    where id = booking.id;
    return jsonb_build_object('status', 'already_resolved', 'matchId', booking.match_id);
  end if;

  if exists (
    select 1 from public.result_proposals as proposal
    where proposal.match_id = booking.match_id and proposal.status = 'pending'
  ) then
    raise exception 'Für diese Partie wartet bereits ein Ergebnis auf Bestätigung.';
  end if;

  update public.matches set match_at = null where id = booking.match_id;
  update private.court_bookings
  set cancellation_resolved_at = now(), cancellation_resolved_by = current_user_id,
      cancellation_resolution = 'unscheduled', updated_at = now()
  where id = booking.id;

  return jsonb_build_object('status', 'unscheduled', 'matchId', booking.match_id);
end;
$$;

-- Auch die bestehende manuelle Aktion räumt Verknüpfungen und eine eventuell
-- offene Stornierungsaufgabe konsistent auf.
create or replace function public.unschedule_match(p_match_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_profile record;
  selected_match record;
  user_team smallint;
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  if not private.user_email_is_confirmed(current_user_id) then
    raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen.';
  end if;

  select profile.* into current_profile from public.profiles as profile where profile.id = current_user_id;
  if not found then raise exception 'Kein Profil für dieses Konto gefunden.'; end if;

  select match.* into selected_match
  from public.matches as match
  join public.seasons as season on season.id = match.season_id
  where match.id = p_match_id and season.results_entry_enabled
  for update of match;
  if not found then raise exception 'Partie nicht gefunden.'; end if;
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
    raise exception 'Nur beteiligte Spieler dürfen die Terminierung aufheben.';
  end if;

  update public.matches set match_at = null where id = p_match_id;
  update private.court_bookings
  set match_id = null, assigned_at = null, assigned_by = null, updated_at = now()
  where match_id = p_match_id and cancelled_at is null;
  update private.court_bookings
  set cancellation_resolved_at = now(), cancellation_resolved_by = current_user_id,
      cancellation_resolution = 'unscheduled', updated_at = now()
  where match_id = p_match_id
    and cancelled_at is not null
    and cancellation_resolved_at is null;
end;
$$;

revoke all on function public.record_court_booking(text, text, text, text, timestamptz, timestamptz, boolean, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.get_my_court_bookings(date) from public, anon;
revoke all on function public.get_my_court_booking_cancellation_tasks() from public, anon;
revoke all on function public.schedule_match(text, timestamp without time zone, bigint) from public, anon;
revoke all on function public.confirm_court_booking_cancellation(bigint) from public, anon;
revoke all on function private.schedule_match_with_court_booking(text, timestamp without time zone, bigint) from public, anon, authenticated;

grant execute on function public.record_court_booking(text, text, text, text, timestamptz, timestamptz, boolean, timestamptz, integer) to service_role;
grant execute on function public.get_my_court_bookings(date) to authenticated;
grant execute on function public.get_my_court_booking_cancellation_tasks() to authenticated;
grant execute on function public.schedule_match(text, timestamp without time zone, bigint) to authenticated;
grant execute on function public.confirm_court_booking_cancellation(bigint) to authenticated;

notify pgrst, 'reload schema';

commit;
