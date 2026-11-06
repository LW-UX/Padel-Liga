begin;

-- The caller is a verified user resolved by the Edge Function, never a user ID
-- supplied by its HTTP client. Provider IDs remain private to the server.
create function public.get_court_access_code_subject(p_match_id text, p_user_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case
    when coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then null
    else (
      select jsonb_build_object('bookingId', booking.id, 'providerId', booking.provider_booking_id,
        'startsAt', booking.starts_at, 'endsAt', booking.ends_at,
        'courtNumber', upper(substring(trim(booking.court_name) from '([Hh][1-4])$')))
      from private.court_bookings as booking
      join public.matches as match on match.id = booking.match_id
      join public.profiles as profile on profile.id = p_user_id
      where booking.match_id = p_match_id
        and booking.cancelled_at is null
        and match.cancelled_at is null
        and match.match_at = booking.starts_at
        and match.actual_sets is null and match.result_details is null
        and not exists (select 1 from public.result_proposals as proposal
          where proposal.match_id = match.id and proposal.status = 'pending')
        and booking.ends_at > now()
        and booking.provider_booking_id is not null
        -- Only the four hall courts have an entrance code. Outdoor bookings
        -- must not trigger a code lookup or an unavailable-code message.
        and upper(trim(booking.court_name)) ~ '(^|[[:space:]])H[1-4]$'
        and (profile.app_role = 'admin' or (
          profile.app_role = 'player' and exists (
            select 1 from public.match_players as member
            where member.match_id = match.id and member.player_id = profile.player_id
          )
        ))
    )
  end;
$$;

revoke all on function public.get_court_access_code_subject(text, uuid) from public, anon, authenticated;
grant execute on function public.get_court_access_code_subject(text, uuid) to service_role;

create table private.court_access_codes (
  booking_id bigint primary key references private.court_bookings(id) on delete cascade,
  code text check (code ~ '^[0-9]{4}#$'),
  phase smallint not null default -1 check (phase between -1 and 1),
  claim_id uuid,
  claim_phase smallint,
  claim_until timestamptz,
  retry_after timestamptz
);
revoke all on private.court_access_codes from public, anon, authenticated;

create function public.claim_court_access_code_read(p_match_id text, p_user_id uuid, p_claim_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  subject jsonb;
  cached private.court_access_codes%rowtype;
  expected_phase integer;
  refresh_at timestamptz;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then return jsonb_build_object('state', 'none'); end if;
  subject := public.get_court_access_code_subject(p_match_id, p_user_id);
  if subject is null then return jsonb_build_object('state', 'none'); end if;
  -- Opportunistic cleanup never contacts Playtomic and needs no background job.
  delete from private.court_access_codes as cache using private.court_bookings as booking
    where cache.booking_id = booking.id and (booking.ends_at <= now() or booking.cancelled_at is not null);
  refresh_at := (subject ->> 'startsAt')::timestamptz - interval '8 minutes';
  expected_phase := case when now() >= refresh_at then 1 else 0 end;
  insert into private.court_access_codes(booking_id) values ((subject ->> 'bookingId')::bigint) on conflict do nothing;
  select * into cached from private.court_access_codes where booking_id = (subject ->> 'bookingId')::bigint for update;
  if cached.code is not null and cached.phase >= expected_phase then
    return jsonb_build_object('state', 'available', 'code', cached.code, 'endsAt', subject ->> 'endsAt',
      'refreshAt', case when expected_phase = 0 then refresh_at else (subject ->> 'endsAt')::timestamptz end);
  end if;
  if cached.retry_after > now() then
    return jsonb_build_object('state', 'unavailable', 'retryAt', cached.retry_after);
  end if;
  if cached.claim_until > now() then
    return jsonb_build_object('state', 'pending', 'retryAt', now() + interval '1 second');
  end if;
  update private.court_access_codes set claim_id = p_claim_id, claim_phase = expected_phase,
    claim_until = now() + interval '30 seconds', retry_after = null
    where booking_id = cached.booking_id;
  return jsonb_build_object('state', 'read', 'subject', subject);
end;
$$;

create function public.finish_court_access_code_read(p_match_id text, p_user_id uuid, p_claim_id uuid, p_booking_id bigint, p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  subject jsonb;
  cached private.court_access_codes%rowtype;
  refresh_at timestamptz;
  expected_phase integer;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then return jsonb_build_object('state', 'none'); end if;
  subject := public.get_court_access_code_subject(p_match_id, p_user_id);
  if subject is null or (subject ->> 'bookingId')::bigint <> p_booking_id then return jsonb_build_object('state', 'none'); end if;
  select * into cached from private.court_access_codes where booking_id = p_booking_id and claim_id = p_claim_id for update;
  if not found then return jsonb_build_object('state', 'pending', 'retryAt', now() + interval '1 second'); end if;
  if p_code is null or p_code !~ '^[0-9]{4}#$' then
    update private.court_access_codes set code = null, phase = -1, claim_id = null, claim_until = null,
      retry_after = now() + interval '1 minute' where booking_id = p_booking_id;
    return jsonb_build_object('state', 'unavailable', 'retryAt', now() + interval '1 minute');
  end if;
  update private.court_access_codes set code = p_code, phase = cached.claim_phase,
    claim_id = null, claim_until = null, retry_after = null where booking_id = p_booking_id;
  refresh_at := (subject ->> 'startsAt')::timestamptz - interval '8 minutes';
  expected_phase := case when now() >= refresh_at then 1 else 0 end;
  if cached.claim_phase < expected_phase then
    return jsonb_build_object('state', 'pending', 'retryAt', now() + interval '1 second');
  end if;
  return jsonb_build_object('state', 'available', 'code', p_code, 'endsAt', subject ->> 'endsAt',
    'refreshAt', case when expected_phase = 0 then refresh_at else (subject ->> 'endsAt')::timestamptz end);
end;
$$;

create function private.invalidate_court_access_code() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.cancelled_at is not null or new.provider_booking_id is distinct from old.provider_booking_id
    or new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at
    or new.court_name is distinct from old.court_name then
    delete from private.court_access_codes where booking_id = new.id;
  end if;
  return new;
end;
$$;
create trigger invalidate_court_access_code after update on private.court_bookings
for each row execute function private.invalidate_court_access_code();
revoke all on function private.invalidate_court_access_code() from public, anon, authenticated;
revoke all on function public.claim_court_access_code_read(text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.finish_court_access_code_read(text, uuid, uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.claim_court_access_code_read(text, uuid, uuid) to service_role;
grant execute on function public.finish_court_access_code_read(text, uuid, uuid, bigint, text) to service_role;

commit;
