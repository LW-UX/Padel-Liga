begin;

-- Authentifizierte freigegebene Absender dürfen Buchungen unabhängig vom
-- angezeigten Buchernamen importieren. Identität: Anbieter-ID bzw. Platz und
-- absolutes Zeitfenster; Ereignisreihenfolge und Rechte bleiben unverändert.
create or replace function public.record_court_booking(
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
  -- zeitlich neuere Stornierung desselben Slots nicht umgehen.
  if existing_booking.id is null and not p_cancelled then
    select booking.id into booking_id
    from private.court_bookings as booking
    where booking.cancelled_at is not null
      and lower(trim(booking.court_name)) = lower(trim(p_court_name))
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

commit;
