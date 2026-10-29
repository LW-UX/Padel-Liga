begin;

create table private.email_notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  result_entry_enabled boolean not null default true,
  result_confirmation_enabled boolean not null default true,
  prediction_reminder_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.email_notification_queue (
  id bigint generated always as identity primary key,
  notification_type text not null check (notification_type in (
    'result_entry',
    'result_confirmation',
    'prediction_reminder'
  )),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  match_id text not null references public.matches(id) on delete cascade,
  proposal_id bigint references public.result_proposals(id) on delete cascade,
  source_match_at timestamptz not null,
  scheduled_for timestamptz not null,
  dedupe_key text not null unique,
  status text not null default 'pending' check (status in (
    'pending',
    'processing',
    'sent',
    'failed',
    'cancelled'
  )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  claim_token uuid,
  claimed_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index email_notification_queue_pending_idx
  on private.email_notification_queue (scheduled_for, id)
  where status = 'pending';

create index email_notification_queue_match_idx
  on private.email_notification_queue (match_id, notification_type, recipient_user_id);

revoke all on private.email_notification_preferences, private.email_notification_queue
  from public, anon, authenticated;

-- Do not turn already overdue matches or proposals into a mail burst when the
-- feature is activated for the first time. Their dedupe keys remain reserved;
-- newly scheduled matches and newly created proposals are unaffected.
insert into private.email_notification_queue (
  notification_type,
  recipient_user_id,
  match_id,
  source_match_at,
  scheduled_for,
  dedupe_key,
  status,
  last_error
)
select
  'result_entry',
  profile.id,
  match.id,
  match.match_at,
  match.match_at + interval '5 hours',
  concat('result-entry:', match.id, ':', extract(epoch from match.match_at)::bigint, ':', profile.id),
  'cancelled',
  'Bei der Erstaktivierung bereits überfällig.'
from public.matches as match
join public.match_players as member on member.match_id = match.id
join public.profiles as profile on profile.player_id = member.player_id
where match.match_at is not null
  and match.match_at + interval '5 hours' <= now()
  and match.actual_sets is null
  and match.winner is null
  and match.cancelled_at is null
  and match.match_type in ('season', 'final')
  and match.format <> 'single-set'
  and (select count(*) from public.match_players as lineup where lineup.match_id = match.id) = 4
  and not exists (
    select 1
    from public.result_proposals as proposal
    where proposal.match_id = match.id
      and proposal.status = 'pending'
  );

insert into private.email_notification_queue (
  notification_type,
  recipient_user_id,
  match_id,
  proposal_id,
  source_match_at,
  scheduled_for,
  dedupe_key,
  status,
  last_error
)
select
  'result_confirmation',
  profile.id,
  match.id,
  proposal.id,
  coalesce(proposal.match_at, match.match_at),
  proposal.created_at + interval '4 hours',
  concat('result-confirmation:', proposal.id, ':', profile.id),
  'cancelled',
  'Bei der Erstaktivierung bereits überfällig.'
from public.result_proposals as proposal
join public.matches as match on match.id = proposal.match_id
join public.match_players as member
  on member.match_id = match.id
 and member.team <> proposal.proposed_by_team
join public.profiles as profile on profile.player_id = member.player_id
where proposal.status = 'pending'
  and proposal.created_at + interval '4 hours' <= now()
  and match.actual_sets is null
  and match.cancelled_at is null;

create or replace function private.email_notification_enabled(
  p_user_id uuid,
  p_notification_type text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_notification_type
    when 'result_entry' then coalesce(preference.result_entry_enabled, true)
    when 'result_confirmation' then coalesce(preference.result_confirmation_enabled, true)
    when 'prediction_reminder' then coalesce(preference.prediction_reminder_enabled, true)
    else false
  end
  from (select 1) as fallback
  left join private.email_notification_preferences as preference
    on preference.user_id = p_user_id;
$$;

create or replace function public.get_my_email_notification_preferences()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then null
    else jsonb_build_object(
      'resultEntry', private.email_notification_enabled((select auth.uid()), 'result_entry'),
      'resultConfirmation', private.email_notification_enabled((select auth.uid()), 'result_confirmation'),
      'predictionReminder', private.email_notification_enabled((select auth.uid()), 'prediction_reminder')
    )
  end;
$$;

create or replace function public.update_my_email_notification_preferences(
  p_result_entry boolean,
  p_result_confirmation boolean,
  p_prediction_reminder boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Nicht angemeldet.';
  end if;

  insert into private.email_notification_preferences (
    user_id,
    result_entry_enabled,
    result_confirmation_enabled,
    prediction_reminder_enabled
  ) values (
    current_user_id,
    coalesce(p_result_entry, true),
    coalesce(p_result_confirmation, true),
    coalesce(p_prediction_reminder, true)
  )
  on conflict (user_id) do update set
    result_entry_enabled = excluded.result_entry_enabled,
    result_confirmation_enabled = excluded.result_confirmation_enabled,
    prediction_reminder_enabled = excluded.prediction_reminder_enabled,
    updated_at = now();

  return public.get_my_email_notification_preferences();
end;
$$;

create or replace function private.queue_due_email_notifications()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_entry_count integer := 0;
  result_confirmation_count integer := 0;
  prediction_reminder_count integer := 0;
begin
  insert into private.email_notification_queue (
    notification_type,
    recipient_user_id,
    match_id,
    source_match_at,
    scheduled_for,
    dedupe_key
  )
  select
    'result_entry',
    profile.id,
    match.id,
    match.match_at,
    match.match_at + interval '5 hours',
    concat('result-entry:', match.id, ':', extract(epoch from match.match_at)::bigint, ':', profile.id)
  from public.matches as match
  join public.match_players as member on member.match_id = match.id
  join public.profiles as profile on profile.player_id = member.player_id
  join auth.users as auth_user on auth_user.id = profile.id
  where match.match_at is not null
    and match.match_at + interval '5 hours' <= now()
    and match.actual_sets is null
    and match.winner is null
    and match.cancelled_at is null
    and match.match_type in ('season', 'final')
    and match.format <> 'single-set'
    and auth_user.email is not null
    and auth_user.email_confirmed_at is not null
    and private.email_notification_enabled(profile.id, 'result_entry')
    and (select count(*) from public.match_players as lineup where lineup.match_id = match.id) = 4
    and not exists (
      select 1
      from public.result_proposals as proposal
      where proposal.match_id = match.id
        and proposal.status = 'pending'
    )
  on conflict (dedupe_key) do nothing;

  get diagnostics result_entry_count = row_count;

  insert into private.email_notification_queue (
    notification_type,
    recipient_user_id,
    match_id,
    proposal_id,
    source_match_at,
    scheduled_for,
    dedupe_key
  )
  select
    'result_confirmation',
    profile.id,
    match.id,
    proposal.id,
    coalesce(proposal.match_at, match.match_at),
    proposal.created_at + interval '4 hours',
    concat('result-confirmation:', proposal.id, ':', profile.id)
  from public.result_proposals as proposal
  join public.matches as match on match.id = proposal.match_id
  join public.match_players as member
    on member.match_id = match.id
   and member.team <> proposal.proposed_by_team
  join public.profiles as profile on profile.player_id = member.player_id
  join auth.users as auth_user on auth_user.id = profile.id
  where proposal.status = 'pending'
    and proposal.created_at + interval '4 hours' <= now()
    and match.actual_sets is null
    and match.cancelled_at is null
    and auth_user.email is not null
    and auth_user.email_confirmed_at is not null
    and private.email_notification_enabled(profile.id, 'result_confirmation')
  on conflict (dedupe_key) do nothing;

  get diagnostics result_confirmation_count = row_count;

  insert into private.email_notification_queue (
    notification_type,
    recipient_user_id,
    match_id,
    source_match_at,
    scheduled_for,
    dedupe_key
  )
  select
    'prediction_reminder',
    profile.id,
    match.id,
    match.match_at,
    match.match_at - interval '24 hours',
    concat('prediction-reminder:', match.id, ':', extract(epoch from match.match_at)::bigint, ':', profile.id)
  from public.matches as match
  join public.seasons as season on season.id = match.season_id
  cross join public.profiles as profile
  join auth.users as auth_user on auth_user.id = profile.id
  where match.match_at is not null
    and match.match_at > now()
    and match.match_at <= now() + interval '24 hours'
    and match.betting_open
    and match.actual_sets is null
    and match.winner is null
    and match.cancelled_at is null
    and private.match_forecast_mode(match.id) = 'preview'
    and (
      season.predictions_enabled
      or (
        not season.counts_for_profile
        and season.id in ('2026-test', 'test-2026')
      )
    )
    and auth_user.email is not null
    and auth_user.email_confirmed_at is not null
    and private.email_notification_enabled(profile.id, 'prediction_reminder')
    and not exists (
      select 1
      from public.predictions as prediction
      where prediction.user_id = profile.id
        and prediction.match_id = match.id
    )
    and not exists (
      select 1
      from public.match_players as own_match
      where own_match.match_id = match.id
        and own_match.player_id = profile.player_id
    )
  on conflict (dedupe_key) do nothing;

  get diagnostics prediction_reminder_count = row_count;

  return jsonb_build_object(
    'resultEntry', result_entry_count,
    'resultConfirmation', result_confirmation_count,
    'predictionReminder', prediction_reminder_count
  );
end;
$$;

create or replace function public.claim_due_email_notifications(
  p_claim_token uuid,
  p_limit integer default 25
)
returns table (
  job_id bigint,
  notification_type text,
  recipient_email text,
  recipient_name text,
  season_id text,
  season_label text,
  match_id text,
  match_label text,
  team_one_label text,
  team_two_label text,
  match_at timestamptz,
  actual_sets text,
  result_details text,
  idempotency_key text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Nicht erlaubt.';
  end if;
  if p_claim_token is null then raise exception 'Claim-Token fehlt.'; end if;

  perform private.queue_due_email_notifications();

  update private.email_notification_queue as queue
  set status = 'pending',
      claim_token = null,
      claimed_at = null,
      updated_at = now(),
      last_error = coalesce(queue.last_error, 'Abgebrochener Versand wird erneut versucht.')
  where queue.status = 'processing'
    and queue.claimed_at < now() - interval '15 minutes';

  update private.email_notification_queue as queue
  set status = 'cancelled',
      claim_token = null,
      claimed_at = null,
      updated_at = now()
  where queue.status = 'pending'
    and (
      not private.email_notification_enabled(queue.recipient_user_id, queue.notification_type)
      or (
        queue.notification_type = 'result_entry'
        and not exists (
          select 1
          from public.matches as match
          where match.id = queue.match_id
            and match.match_at = queue.source_match_at
            and match.actual_sets is null
            and match.winner is null
            and match.cancelled_at is null
            and exists (
              select 1
              from public.profiles as profile
              join public.match_players as member on member.player_id = profile.player_id
              where profile.id = queue.recipient_user_id
                and member.match_id = match.id
            )
            and not exists (
              select 1
              from public.result_proposals as proposal
              where proposal.match_id = match.id
                and proposal.status = 'pending'
            )
        )
      )
      or (
        queue.notification_type = 'result_confirmation'
        and not exists (
          select 1
          from public.result_proposals as proposal
          join public.matches as match on match.id = proposal.match_id
          join public.match_players as member
            on member.match_id = match.id
           and member.team <> proposal.proposed_by_team
          join public.profiles as profile
            on profile.player_id = member.player_id
           and profile.id = queue.recipient_user_id
          where proposal.id = queue.proposal_id
            and proposal.status = 'pending'
            and match.actual_sets is null
            and match.cancelled_at is null
        )
      )
      or (
        queue.notification_type = 'prediction_reminder'
        and not exists (
          select 1
          from public.matches as match
          join public.seasons as season on season.id = match.season_id
          where match.id = queue.match_id
            and match.match_at = queue.source_match_at
            and match.match_at > now()
            and match.betting_open
            and match.actual_sets is null
            and match.winner is null
            and match.cancelled_at is null
            and private.match_forecast_mode(match.id) = 'preview'
            and (
              season.predictions_enabled
              or (not season.counts_for_profile and season.id in ('2026-test', 'test-2026'))
            )
            and not exists (
              select 1
              from public.profiles as profile
              join public.match_players as own_match on own_match.player_id = profile.player_id
              where profile.id = queue.recipient_user_id
                and own_match.match_id = match.id
            )
            and not exists (
              select 1
              from public.predictions as prediction
              where prediction.user_id = queue.recipient_user_id
                and prediction.match_id = match.id
            )
        )
      )
    );

  return query
  with candidates as (
    select queue.id
    from private.email_notification_queue as queue
    where queue.status = 'pending'
      and queue.scheduled_for <= now()
    order by queue.scheduled_for, queue.id
    limit greatest(1, least(coalesce(p_limit, 25), 100))
    for update skip locked
  ), claimed as (
    update private.email_notification_queue as queue
    set status = 'processing',
        attempt_count = queue.attempt_count + 1,
        claim_token = p_claim_token,
        claimed_at = now(),
        updated_at = now(),
        last_error = null
    where queue.id in (select candidate.id from candidates as candidate)
    returning queue.*
  )
  select
    claimed.id,
    claimed.notification_type,
    auth_user.email::text,
    profile.display_name,
    match.season_id,
    season.label,
    match.id,
    coalesce(
      match.display_label,
      'Partie ' || coalesce(substring(match.id from '([0-9]+)$'), match.matchday::text)
    ),
    match.team_one_label,
    match.team_two_label,
    coalesce(proposal.match_at, match.match_at),
    proposal.actual_sets,
    proposal.result_details,
    claimed.dedupe_key
  from claimed
  join auth.users as auth_user on auth_user.id = claimed.recipient_user_id
  join public.profiles as profile on profile.id = claimed.recipient_user_id
  join public.matches as match on match.id = claimed.match_id
  join public.seasons as season on season.id = match.season_id
  left join public.result_proposals as proposal on proposal.id = claimed.proposal_id
  order by claimed.scheduled_for, claimed.id;
end;
$$;

create or replace function public.complete_email_notification(
  p_job_id bigint,
  p_claim_token uuid,
  p_success boolean,
  p_provider_message_id text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_job private.email_notification_queue%rowtype;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Nicht erlaubt.';
  end if;

  select queue.* into selected_job
  from private.email_notification_queue as queue
  where queue.id = p_job_id
    and queue.status = 'processing'
    and queue.claim_token = p_claim_token
  for update;

  if not found then raise exception 'Versandauftrag nicht gefunden oder nicht mehr beansprucht.'; end if;

  if coalesce(p_success, false) then
    update private.email_notification_queue
    set status = 'sent',
        sent_at = now(),
        provider_message_id = nullif(trim(p_provider_message_id), ''),
        last_error = null,
        claim_token = null,
        claimed_at = null,
        updated_at = now()
    where id = selected_job.id;
  else
    update private.email_notification_queue
    set status = case when selected_job.attempt_count >= 5 then 'failed' else 'pending' end,
        scheduled_for = case
          when selected_job.attempt_count >= 5 then selected_job.scheduled_for
          else now() + least(selected_job.attempt_count, 5) * interval '5 minutes'
        end,
        last_error = left(coalesce(nullif(trim(p_error), ''), 'Unbekannter Versandfehler.'), 1000),
        claim_token = null,
        claimed_at = null,
        updated_at = now()
    where id = selected_job.id;
  end if;
end;
$$;

revoke all on function public.get_my_email_notification_preferences() from public, anon;
revoke all on function public.update_my_email_notification_preferences(boolean, boolean, boolean) from public, anon;
revoke all on function public.claim_due_email_notifications(uuid, integer) from public, anon, authenticated;
revoke all on function public.complete_email_notification(bigint, uuid, boolean, text, text) from public, anon, authenticated;
revoke all on function private.email_notification_enabled(uuid, text) from public, anon, authenticated;
revoke all on function private.queue_due_email_notifications() from public, anon, authenticated;

grant execute on function public.get_my_email_notification_preferences() to authenticated;
grant execute on function public.update_my_email_notification_preferences(boolean, boolean, boolean) to authenticated;
grant execute on function public.claim_due_email_notifications(uuid, integer) to service_role;
grant execute on function public.complete_email_notification(bigint, uuid, boolean, text, text) to service_role;

notify pgrst, 'reload schema';

commit;
