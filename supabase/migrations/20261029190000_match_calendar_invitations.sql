begin;

alter table private.email_notification_preferences
  add column calendar_invitation_enabled boolean not null default true;

alter table private.email_notification_queue
  drop constraint email_notification_queue_notification_type_check;

alter table private.email_notification_queue
  add constraint email_notification_queue_notification_type_check check (notification_type in (
    'result_entry',
    'result_confirmation',
    'prediction_reminder',
    'calendar_invitation',
    'calendar_cancellation'
  ));

-- Outlook only replaces an existing appointment when the same UID arrives with
-- a higher SEQUENCE, so every calendar mail stores its own sequence number.
alter table private.email_notification_queue
  add column calendar_sequence integer check (calendar_sequence >= 0);

alter table private.email_notification_queue
  add constraint email_notification_queue_calendar_fields_check check (
    (notification_type in ('calendar_invitation', 'calendar_cancellation')) = (calendar_sequence is not null)
  );

create index email_notification_queue_calendar_idx
  on private.email_notification_queue (match_id, recipient_user_id, id desc)
  where notification_type in ('calendar_invitation', 'calendar_cancellation');

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
  select case
    when p_notification_type = 'result_entry' then coalesce(preference.result_entry_enabled, true)
    when p_notification_type = 'result_confirmation' then coalesce(preference.result_confirmation_enabled, true)
    when p_notification_type = 'prediction_reminder' then coalesce(preference.prediction_reminder_enabled, true)
    when p_notification_type in ('calendar_invitation', 'calendar_cancellation')
      then coalesce(preference.calendar_invitation_enabled, true)
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
      'predictionReminder', private.email_notification_enabled((select auth.uid()), 'prediction_reminder'),
      'calendarInvitation', private.email_notification_enabled((select auth.uid()), 'calendar_invitation')
    )
  end;
$$;

-- The three-argument variant stays for already published pages and leaves the
-- calendar setting untouched.
create or replace function public.update_my_email_notification_preferences(
  p_result_entry boolean,
  p_result_confirmation boolean,
  p_prediction_reminder boolean,
  p_calendar_invitation boolean
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
    prediction_reminder_enabled,
    calendar_invitation_enabled
  ) values (
    current_user_id,
    coalesce(p_result_entry, true),
    coalesce(p_result_confirmation, true),
    coalesce(p_prediction_reminder, true),
    coalesce(p_calendar_invitation, true)
  )
  on conflict (user_id) do update set
    result_entry_enabled = excluded.result_entry_enabled,
    result_confirmation_enabled = excluded.result_confirmation_enabled,
    prediction_reminder_enabled = excluded.prediction_reminder_enabled,
    calendar_invitation_enabled = excluded.calendar_invitation_enabled,
    updated_at = now();

  return public.get_my_email_notification_preferences();
end;
$$;

-- Compares the current schedule of every official match with the last calendar
-- mail each participant received and queues the difference: a new or moved
-- appointment as invitation, a removed appointment as cancellation. Only future
-- appointments are touched, and a match with a result never sends a
-- cancellation, so playing earlier than planned keeps the calendar entry.
create or replace function private.queue_calendar_notifications()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pair record;
  delivered_type text;
  delivered_match_at timestamptz;
  needed_type text;
  needed_match_at timestamptz;
  next_sequence integer;
  invitation_count integer := 0;
  cancellation_count integer := 0;
begin
  for pair in
    with desired as (
      select match.id as match_id, profile.id as user_id, match.match_at
      from public.matches as match
      join public.match_players as member on member.match_id = match.id
      join public.profiles as profile on profile.player_id = member.player_id
      join auth.users as auth_user on auth_user.id = profile.id
      where match.match_at is not null
        and match.match_at > now()
        and match.actual_sets is null
        and match.winner is null
        and match.cancelled_at is null
        and match.match_type in ('season', 'final')
        and (select count(*) from public.match_players as lineup where lineup.match_id = match.id) = 4
        and auth_user.email is not null
        and auth_user.email_confirmed_at is not null
    ), known as (
      select distinct queue.match_id, queue.recipient_user_id as user_id
      from private.email_notification_queue as queue
      where queue.notification_type = 'calendar_invitation'
        and queue.status <> 'cancelled'
        and queue.source_match_at > now()
    )
    select
      coalesce(desired.match_id, known.match_id) as match_id,
      coalesce(desired.user_id, known.user_id) as user_id,
      desired.match_at as desired_match_at,
      (match.actual_sets is not null or match.winner is not null) as has_result
    from desired
    full join known
      on known.match_id = desired.match_id
     and known.user_id = desired.user_id
    join public.matches as match on match.id = coalesce(desired.match_id, known.match_id)
  loop
    if not private.email_notification_enabled(pair.user_id, 'calendar_invitation') then
      continue;
    end if;

    -- What the participant's calendar already shows: the newest mail that left
    -- or is leaving the queue.
    delivered_type := null;
    delivered_match_at := null;
    select queue.notification_type, queue.source_match_at
    into delivered_type, delivered_match_at
    from private.email_notification_queue as queue
    where queue.match_id = pair.match_id
      and queue.recipient_user_id = pair.user_id
      and queue.notification_type in ('calendar_invitation', 'calendar_cancellation')
      and queue.status in ('processing', 'sent', 'failed')
    order by queue.id desc
    limit 1;

    needed_type := null;
    needed_match_at := null;
    if pair.desired_match_at is not null then
      if delivered_type is distinct from 'calendar_invitation'
        or delivered_match_at <> pair.desired_match_at then
        needed_type := 'calendar_invitation';
        needed_match_at := pair.desired_match_at;
      end if;
    elsif not pair.has_result
      and delivered_type = 'calendar_invitation'
      and delivered_match_at > now() then
      needed_type := 'calendar_cancellation';
      needed_match_at := delivered_match_at;
    end if;

    if exists (
      select 1
      from private.email_notification_queue as queue
      where queue.match_id = pair.match_id
        and queue.recipient_user_id = pair.user_id
        and queue.notification_type = needed_type
        and queue.source_match_at = needed_match_at
        and queue.status = 'pending'
    ) then
      continue;
    end if;

    -- A newer state replaces mail that has not left the queue yet.
    update private.email_notification_queue as queue
    set status = 'cancelled',
        last_error = 'Durch eine neuere Terminänderung ersetzt.',
        updated_at = now()
    where queue.match_id = pair.match_id
      and queue.recipient_user_id = pair.user_id
      and queue.notification_type in ('calendar_invitation', 'calendar_cancellation')
      and queue.status = 'pending';

    if needed_type is null then
      continue;
    end if;

    select coalesce(max(queue.calendar_sequence), -1) + 1 into next_sequence
    from private.email_notification_queue as queue
    where queue.match_id = pair.match_id
      and queue.recipient_user_id = pair.user_id
      and queue.notification_type in ('calendar_invitation', 'calendar_cancellation');

    insert into private.email_notification_queue (
      notification_type,
      recipient_user_id,
      match_id,
      source_match_at,
      scheduled_for,
      dedupe_key,
      calendar_sequence
    ) values (
      needed_type,
      pair.user_id,
      pair.match_id,
      needed_match_at,
      now(),
      concat('calendar:', pair.match_id, ':', pair.user_id, ':', next_sequence),
      next_sequence
    )
    on conflict (dedupe_key) do nothing;

    if needed_type = 'calendar_cancellation' then
      cancellation_count := cancellation_count + 1;
    else
      invitation_count := invitation_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'calendarInvitation', invitation_count,
    'calendarCancellation', cancellation_count
  );
end;
$$;

-- claim_due_email_notifications calls private.queue_due_email_notifications()
-- by name. The reminder logic keeps its body under a new name and the old name
-- now runs reminders and calendar mails together.
alter function private.queue_due_email_notifications() rename to queue_due_reminder_notifications;

create function private.queue_due_email_notifications()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.queue_due_reminder_notifications() || private.queue_calendar_notifications();
$$;

-- The claim result carries the current match time, which no longer exists for
-- a removed appointment. Calendar mails read their own time and sequence here.
create or replace function public.get_claimed_calendar_notifications(p_claim_token uuid)
returns table (
  job_id bigint,
  calendar_uid text,
  calendar_sequence integer,
  event_start timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Nicht erlaubt.';
  end if;

  return query
  select
    queue.id,
    concat('match-', queue.match_id, '-', queue.recipient_user_id, '@padelliga'),
    queue.calendar_sequence,
    queue.source_match_at
  from private.email_notification_queue as queue
  where queue.claim_token = p_claim_token
    and queue.status = 'processing'
    and queue.notification_type in ('calendar_invitation', 'calendar_cancellation');
end;
$$;

revoke all on function public.update_my_email_notification_preferences(boolean, boolean, boolean, boolean) from public, anon;
revoke all on function public.get_claimed_calendar_notifications(uuid) from public, anon, authenticated;
revoke all on function private.queue_calendar_notifications() from public, anon, authenticated;
revoke all on function private.queue_due_reminder_notifications() from public, anon, authenticated;
revoke all on function private.queue_due_email_notifications() from public, anon, authenticated;

grant execute on function public.update_my_email_notification_preferences(boolean, boolean, boolean, boolean) to authenticated;
grant execute on function public.get_claimed_calendar_notifications(uuid) to service_role;

notify pgrst, 'reload schema';

commit;
