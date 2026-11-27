begin;

alter table private.court_outlook_health add column incident_id bigint not null default 0;

create table private.court_outlook_match_health (
  match_id text primary key references public.matches(id) on delete cascade,
  unavailable boolean not null,
  checked_at timestamptz not null
);

create table private.court_outlook_alert_deliveries (
  incident_id bigint not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts integer not null default 0,
  retry_at timestamptz not null default now(),
  claim_token uuid,
  claim_until timestamptz,
  primary key (incident_id, user_id)
);
revoke all on private.court_outlook_health, private.court_outlook_match_health,
  private.court_outlook_alert_deliveries from public, anon, authenticated;

-- A working calendar group must not clear another group's failed calendar.
-- Mail is nevertheless shared across all unresolved failures.
create function private.court_outlook_alert_reason()
returns text language sql stable security definer set search_path = '' as $$
  select case
    when health.status = 'not_configured' then null
    when health.status in ('reconnect', 'unavailable') then health.status
    when exists (
      select 1 from private.court_outlook_match_health as check_result
      join public.matches as match on match.id = check_result.match_id
      join public.seasons as season on season.id = match.season_id
      where check_result.unavailable and season.results_entry_enabled and match.cancelled_at is null
        and match.actual_sets is null and match.result_details is null
        and not exists (
          select 1 from public.result_proposals as proposal
          where proposal.match_id = match.id and proposal.status = 'pending'
        )
    ) then 'calendar_unavailable'
  end
  from private.court_outlook_health as health where health.id;
$$;

drop function public.record_court_outlook_health(text);
create function public.record_court_outlook_health(p_match_id text, p_started_at timestamptz, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  old_reason text;
  new_incident bigint;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' or p_started_at is null then return; end if;
  insert into private.court_outlook_health (id, status, checked_at)
    values (true, 'not_configured', '-infinity') on conflict do nothing;
  perform 1 from private.court_outlook_health where id for update;
  old_reason := private.court_outlook_alert_reason();

  -- Record the latest outcome globally and the latest calendar check for each match.
  -- Responses can complete out of order when different parties open the modal.
  update private.court_outlook_health set status = p_status, checked_at = p_started_at
    where id and checked_at <= p_started_at;
  if p_status in ('ready', 'calendar_unavailable') then
    insert into private.court_outlook_match_health as match_health (match_id, unavailable, checked_at)
      values (p_match_id, p_status = 'calendar_unavailable', p_started_at)
    on conflict (match_id) do update
      set unavailable = excluded.unavailable, checked_at = excluded.checked_at
      where match_health.checked_at <= excluded.checked_at;
  end if;

  if old_reason is null and private.court_outlook_alert_reason() is not null then
    update private.court_outlook_health set incident_id = incident_id + 1 where id
      returning incident_id into new_incident;
    insert into private.court_outlook_alert_deliveries (incident_id, user_id)
      select new_incident, profile.id from public.profiles as profile
      join auth.users as account on account.id = profile.id
      where profile.app_role = 'admin' and account.email_confirmed_at is not null and account.email is not null;
  end if;
end;
$$;

create function public.get_my_court_outlook_health()
returns text language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.user_email_is_confirmed((select auth.uid())) or not exists (
    select 1 from public.profiles where id = (select auth.uid()) and app_role = 'admin'
  ) then raise exception 'Nur für bestätigte Admin-Konten.' using errcode = '42501'; end if;
  return private.court_outlook_alert_reason();
end;
$$;

create function public.claim_court_outlook_alerts(p_claim_token uuid, p_limit integer default 25)
returns table(incident_id bigint, user_id uuid, recipient_email text, reason text, idempotency_key text)
language plpgsql security definer set search_path = '' as $$
declare
  current_incident bigint;
  current_reason text;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' or p_claim_token is null then return; end if;
  select health.incident_id into current_incident from private.court_outlook_health as health where id for update;
  delete from private.court_outlook_alert_deliveries where created_at < now() - interval '30 days';
  current_reason := private.court_outlook_alert_reason();
  if current_reason is null then return; end if;

  return query
    with due as (
      select delivery.incident_id, delivery.user_id from private.court_outlook_alert_deliveries as delivery
      join public.profiles as profile on profile.id = delivery.user_id and profile.app_role = 'admin'
      join auth.users as account on account.id = delivery.user_id and account.email_confirmed_at is not null
      where delivery.incident_id = current_incident and delivery.sent_at is null
        and account.email is not null and delivery.retry_at <= now()
        and delivery.attempts < 5 and delivery.created_at > now() - interval '23 hours'
        and (delivery.claim_until is null or delivery.claim_until <= now())
      order by delivery.user_id limit greatest(0, least(coalesce(p_limit, 25), 25))
      for update of delivery skip locked
    ), claimed as (
      update private.court_outlook_alert_deliveries as delivery set claim_token = p_claim_token,
        claim_until = now() + interval '5 minutes', attempts = attempts + 1
      from due where delivery.incident_id = due.incident_id and delivery.user_id = due.user_id
      returning delivery.incident_id, delivery.user_id
    )
    select claimed.incident_id, claimed.user_id, account.email::text, current_reason,
      'court-outlook-' || claimed.incident_id || '-' || claimed.user_id
    from claimed join auth.users as account on account.id = claimed.user_id;
end;
$$;

create function public.court_outlook_alert_is_current(p_incident_id bigint, p_user_id uuid, p_claim_token uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt() ->> 'role'), '') = 'service_role'
    and private.court_outlook_alert_reason() is not null and exists (
      select 1 from private.court_outlook_health as health
      join private.court_outlook_alert_deliveries as delivery on delivery.incident_id = health.incident_id
      join public.profiles as profile on profile.id = delivery.user_id and profile.app_role = 'admin'
      join auth.users as account on account.id = delivery.user_id and account.email_confirmed_at is not null
      where health.id and delivery.incident_id = p_incident_id and delivery.user_id = p_user_id
        and account.email is not null and delivery.claim_token = p_claim_token
        and delivery.claim_until > now() and delivery.sent_at is null
    );
$$;

create function public.complete_court_outlook_alert(
  p_incident_id bigint, p_user_id uuid, p_claim_token uuid, p_success boolean
)
returns void language sql security definer set search_path = '' as $$
  update private.court_outlook_alert_deliveries set sent_at = case when p_success then now() else null end,
    claim_token = null, claim_until = null, retry_at = now() + interval '5 minutes'
  where incident_id = p_incident_id and user_id = p_user_id and claim_token = p_claim_token
    and coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';
$$;

revoke all on function private.court_outlook_alert_reason(),
  public.record_court_outlook_health(text,timestamptz,text), public.get_my_court_outlook_health(),
  public.claim_court_outlook_alerts(uuid,integer), public.court_outlook_alert_is_current(bigint,uuid,uuid),
  public.complete_court_outlook_alert(bigint,uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.get_my_court_outlook_health() to authenticated;
grant execute on function public.record_court_outlook_health(text,timestamptz,text),
  public.claim_court_outlook_alerts(uuid,integer), public.court_outlook_alert_is_current(bigint,uuid,uuid),
  public.complete_court_outlook_alert(bigint,uuid,uuid,boolean) to service_role;

commit;
