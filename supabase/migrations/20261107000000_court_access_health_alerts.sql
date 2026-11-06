begin;

-- One shared incident for the read-only Playtomic integration. No cookies,
-- booking IDs, access codes or upstream response bodies are stored here.
create table private.court_access_health (
  singleton boolean primary key default true check (singleton),
  incident_id bigint not null default 0,
  active boolean not null default false,
  reason text check (reason in ('login_required', 'configuration', 'unavailable', 'code_unavailable')),
  since timestamptz,
  checked_at timestamptz
);
insert into private.court_access_health(singleton) values (true);
create table private.court_access_alert_deliveries (
  incident_id bigint not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  cancelled_at timestamptz,
  attempts integer not null default 0,
  retry_at timestamptz not null default now(),
  claim_token uuid,
  claim_until timestamptz,
  primary key (incident_id, user_id)
);
revoke all on private.court_access_health, private.court_access_alert_deliveries from public, anon, authenticated;

-- Finish and health recording are atomic and use the existing authorized
-- booking lease. An old or forged completion cannot create/resolve incidents.
create function public.finish_court_access_code_read_with_health(
  p_match_id text, p_user_id uuid, p_claim_id uuid, p_booking_id bigint,
  p_code text, p_failure_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cached private.court_access_codes%rowtype;
  health private.court_access_health%rowtype;
  result jsonb;
  started_at timestamptz;
  failure text;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    return jsonb_build_object('state', 'none');
  end if;
  select * into cached from private.court_access_codes
    where booking_id = p_booking_id and claim_id = p_claim_id for update;
  if not found then return jsonb_build_object('state', 'none'); end if;
  started_at := cached.claim_until - interval '30 seconds';
  result := public.finish_court_access_code_read(p_match_id, p_user_id, p_claim_id, p_booking_id, p_code);
  if result ->> 'state' = 'none' then return result; end if;
  select * into health from private.court_access_health where singleton for update;
  -- Compare request start times: a slow earlier read cannot overwrite a newer
  -- failure or recovery from a different booking.
  if health.checked_at is not null and started_at < health.checked_at then return result; end if;
  if p_code ~ '^[0-9]{4}#$' then
    update private.court_access_health set active = false, reason = null, since = null,
      checked_at = started_at where singleton;
    update private.court_access_alert_deliveries set cancelled_at = now()
      where incident_id = health.incident_id and sent_at is null and cancelled_at is null;
  else
    failure := case when p_failure_reason in ('login_required', 'configuration', 'code_unavailable')
      then p_failure_reason else 'unavailable' end;
    if not health.active then
      health.incident_id := health.incident_id + 1;
      update private.court_access_health set incident_id = health.incident_id, active = true,
        reason = failure, since = now(), checked_at = started_at where singleton;
      insert into private.court_access_alert_deliveries(incident_id, user_id)
        select health.incident_id, profile.id from public.profiles as profile
        join auth.users as account on account.id = profile.id
        where profile.app_role = 'admin' and account.email_confirmed_at is not null
          and account.email is not null
        on conflict do nothing;
    else
      update private.court_access_health set reason = failure, checked_at = started_at where singleton;
    end if;
  end if;
  return result;
end;
$$;

create function public.get_my_court_access_health() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.user_email_is_confirmed((select auth.uid())) or not exists (
    select 1 from public.profiles where id = (select auth.uid()) and app_role = 'admin'
  ) then raise exception 'Nur für bestätigte Admin-Konten.' using errcode = '42501'; end if;
  return (select jsonb_build_object('active', active, 'reason', reason, 'since', since)
    from private.court_access_health where singleton);
end;
$$;

create function public.claim_court_access_alerts(p_claim_token uuid, p_limit integer default 25)
returns table(incident_id bigint, user_id uuid, recipient_email text, reason text, idempotency_key text)
language plpgsql security definer set search_path = '' as $$
declare health private.court_access_health%rowtype;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' or p_claim_token is null then return; end if;
  select * into health from private.court_access_health where singleton for update;
  delete from private.court_access_alert_deliveries where created_at < now() - interval '30 days';
  if not health.active then return; end if;
  return query
    with due as (
      select delivery.incident_id, delivery.user_id from private.court_access_alert_deliveries as delivery
      join public.profiles as profile on profile.id = delivery.user_id and profile.app_role = 'admin'
      join auth.users as account on account.id = profile.id and account.email_confirmed_at is not null
      where delivery.incident_id = health.incident_id and delivery.sent_at is null
        and delivery.cancelled_at is null and delivery.retry_at <= now()
        and delivery.attempts < 5 and delivery.created_at > now() - interval '23 hours'
        and (delivery.claim_until is null or delivery.claim_until <= now())
      order by delivery.user_id limit greatest(0, least(coalesce(p_limit, 25), 25))
      for update of delivery skip locked
    ), claimed as (
      update private.court_access_alert_deliveries as delivery set claim_token = p_claim_token,
        claim_until = now() + interval '5 minutes', attempts = attempts + 1
      from due where delivery.incident_id = due.incident_id and delivery.user_id = due.user_id
      returning delivery.incident_id, delivery.user_id
    )
    select claimed.incident_id, claimed.user_id, account.email::text, health.reason,
      'court-access-' || claimed.incident_id || '-' || claimed.user_id
    from claimed join auth.users as account on account.id = claimed.user_id;
end;
$$;

create function public.court_access_alert_is_current(p_incident_id bigint, p_user_id uuid, p_claim_token uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt() ->> 'role'), '') = 'service_role' and exists (
    select 1 from private.court_access_health as health
    join private.court_access_alert_deliveries as delivery on delivery.incident_id = health.incident_id
    join public.profiles as profile on profile.id = delivery.user_id and profile.app_role = 'admin'
    join auth.users as account on account.id = profile.id and account.email_confirmed_at is not null
    where health.singleton and health.active and delivery.incident_id = p_incident_id
      and delivery.user_id = p_user_id and delivery.claim_token = p_claim_token
      and delivery.claim_until > now() and delivery.cancelled_at is null and delivery.sent_at is null
  );
$$;

create function public.complete_court_access_alert(
  p_incident_id bigint, p_user_id uuid, p_claim_token uuid, p_success boolean
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then return; end if;
  update private.court_access_alert_deliveries set sent_at = case when p_success then now() else null end,
    claim_token = null, claim_until = null, retry_at = now() + interval '5 minutes'
    where incident_id = p_incident_id and user_id = p_user_id and claim_token = p_claim_token;
end;
$$;

revoke all on function public.finish_court_access_code_read_with_health(text,uuid,uuid,bigint,text,text),
  public.get_my_court_access_health(), public.claim_court_access_alerts(uuid,integer),
  public.court_access_alert_is_current(bigint,uuid,uuid),
  public.complete_court_access_alert(bigint,uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.get_my_court_access_health() to authenticated;
grant execute on function public.finish_court_access_code_read_with_health(text,uuid,uuid,bigint,text,text),
  public.claim_court_access_alerts(uuid,integer), public.complete_court_access_alert(bigint,uuid,uuid,boolean) to service_role;
grant execute on function public.court_access_alert_is_current(bigint,uuid,uuid) to service_role;

commit;
