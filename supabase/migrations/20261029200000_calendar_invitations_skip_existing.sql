begin;

-- Matches that already had a future appointment when calendar mails were
-- switched on stay out of the calendar until their appointment changes.
create table private.calendar_invitation_baseline (
  match_id text primary key references public.matches(id) on delete cascade,
  match_at timestamptz not null
);

-- A single row marks the first queue run, which takes the baseline instead of
-- inviting everybody to appointments that were agreed before.
create table private.calendar_invitation_activation (
  id boolean primary key default true check (id),
  activated_at timestamptz not null default now()
);

revoke all on private.calendar_invitation_baseline, private.calendar_invitation_activation
  from public, anon, authenticated;

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
  baseline_count integer := 0;
begin
  if not exists (select 1 from private.calendar_invitation_activation) then
    insert into private.calendar_invitation_baseline (match_id, match_at)
    select match.id, match.match_at
    from public.matches as match
    where match.match_at > now()
    on conflict (match_id) do nothing;
    get diagnostics baseline_count = row_count;

    update private.email_notification_queue as queue
    set status = 'cancelled',
        last_error = 'Termin stand vor der Aktivierung der Kalendereinladungen fest.',
        updated_at = now()
    where queue.notification_type in ('calendar_invitation', 'calendar_cancellation')
      and queue.status = 'pending';

    insert into private.calendar_invitation_activation default values;

    return jsonb_build_object(
      'calendarInvitation', 0,
      'calendarCancellation', 0,
      'calendarBaseline', baseline_count
    );
  end if;

  -- Once an appointment is moved, removed or over, the match is treated like
  -- any newly scheduled one.
  delete from private.calendar_invitation_baseline as baseline
  using public.matches as match
  where match.id = baseline.match_id
    and (match.match_at is distinct from baseline.match_at or match.match_at <= now());

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
        and not exists (
          select 1
          from private.calendar_invitation_baseline as baseline
          where baseline.match_id = match.id
        )
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

revoke all on function private.queue_calendar_notifications() from public, anon, authenticated;

commit;
