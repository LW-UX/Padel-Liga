-- Explicitly approved by the user: import the two inspected confirmations and
-- attach them to their existing matches. No update to public.matches, so no
-- rescheduling, calendar notification or other match-trigger side effect.
begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare
  actor uuid;
  item record;
  selected_match public.matches%rowtype;
  selected_booking private.court_bookings%rowtype;
  imported jsonb;
begin
  select profile.id into strict actor
  from public.profiles profile
  join auth.users account on account.id = profile.id
  where lower(account.email) = 'ludwig.wagner@envidual.com'
    and profile.app_role = 'admin';

  for item in select * from (values
    ('winter-2026-partie-2', '1fd30e21-501d-4126-a8fa-5d84ba3bb9d8',
      '2026-11-11T11:00:00Z'::timestamptz, '2026-11-11T12:00:00Z'::timestamptz, '2026-10-28T13:39:00Z'::timestamptz),
    ('winter-2026-partie-1', 'e9121499-15c7-43e3-b4a3-e21bc36f02b3',
      '2026-11-12T11:00:00Z'::timestamptz, '2026-11-12T12:00:00Z'::timestamptz, '2026-10-29T13:13:00Z'::timestamptz)
  ) as approved(match_id, provider_id, starts_at, ends_at, source_at)
  loop
    select * into strict selected_match from public.matches where id = item.match_id for update;
    if selected_match.match_at is distinct from item.starts_at
      or selected_match.actual_sets is not null or selected_match.result_details is not null
      or selected_match.cancelled_at is not null
      or exists (select 1 from public.result_proposals where match_id = item.match_id and status = 'pending') then
      raise exception 'Die bestätigte Zuordnung stimmt nicht mehr mit dem Partiezustand überein: %', item.match_id;
    end if;

    imported := public.record_court_booking(item.provider_id, null, 'CUPRA Indoor H1', 'Headsquare United',
      item.starts_at, item.ends_at, false, item.source_at, 60);
    if imported->>'status' is distinct from 'active' then
      raise exception 'Buchung nicht aktiv: %', imported->>'status';
    end if;

    select * into strict selected_booking from private.court_bookings
      where id = (imported->>'bookingId')::bigint for update;
    if selected_booking.starts_at is distinct from item.starts_at
      or selected_booking.ends_at is distinct from item.ends_at
      or selected_booking.cancelled_at is not null
      or selected_booking.match_id is not null and selected_booking.match_id <> item.match_id
      or exists (select 1 from private.court_bookings
        where match_id = item.match_id and cancelled_at is null and id <> selected_booking.id) then
      raise exception 'Buchung kann nicht der bestätigten Partie zugeordnet werden.';
    end if;

    update private.court_bookings
      set match_id = item.match_id, assigned_at = now(), assigned_by = actor, updated_at = now()
      where id = selected_booking.id and match_id is distinct from item.match_id;
  end loop;
end;
$$;
commit;
