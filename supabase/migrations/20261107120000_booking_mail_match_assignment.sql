begin;

-- A repeated, authenticated forwarding may explicitly connect an already
-- imported Playtomic booking to an official match. Recording and assignment
-- share one transaction; expected conflicts keep the booking in the inbox.
create function public.record_court_booking_with_match(
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
    return recorded || jsonb_build_object('assignment', 'not_requested');
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

  if not found or selected_booking.cancelled_at is not null or selected_booking.starts_at <= now() then
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

notify pgrst, 'reload schema';

commit;
