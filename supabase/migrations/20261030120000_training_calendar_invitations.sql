begin;

-- A training has no match row, and a deleted training has no row at all, yet its
-- cancellation mail still has to go out. The queue therefore keeps the plain id.
alter table private.email_notification_queue
  alter column match_id drop not null,
  add column training_session_id bigint;

alter table private.email_notification_queue
  add constraint email_notification_queue_subject_check check (
    (match_id is not null and training_session_id is null)
    or (
      match_id is null
      and training_session_id is not null
      and notification_type in ('calendar_invitation', 'calendar_cancellation')
    )
  );

create index email_notification_queue_training_calendar_idx
  on private.email_notification_queue (training_session_id, recipient_user_id, id desc)
  where training_session_id is not null;

-- Trainings that are already scheduled now stay out of the calendar until their
-- appointment changes, like matches at the start of calendar mails.
create table private.training_calendar_baseline (
  training_session_id bigint primary key references public.training_sessions(id) on delete cascade,
  session_at timestamptz not null
);

revoke all on private.training_calendar_baseline from public, anon, authenticated;

insert into private.training_calendar_baseline (training_session_id, session_at)
select session.id, private.training_session_at(session.played_on, session.display_time)
from public.training_sessions as session
where session.status = 'scheduled'
  and private.training_session_at(session.played_on, session.display_time) > now();

-- Same comparison as private.queue_calendar_notifications(). Entering a result
-- replaces the scheduled row, so a training played before its appointment gets
-- a cancellation for the entry that would otherwise stay in the calendar.
create function private.queue_training_calendar_notifications()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pair record;
  delivered_type text;
  delivered_session_at timestamptz;
  needed_type text;
  needed_session_at timestamptz;
  next_sequence integer;
  invitation_count integer := 0;
  cancellation_count integer := 0;
begin
  delete from private.training_calendar_baseline as baseline
  using public.training_sessions as session
  where session.id = baseline.training_session_id
    and (
      private.training_session_at(session.played_on, session.display_time) is distinct from baseline.session_at
      or baseline.session_at <= now()
    );

  for pair in
    with desired as (
      select
        session.id as training_session_id,
        profile.id as user_id,
        private.training_session_at(session.played_on, session.display_time) as session_at
      from public.training_sessions as session
      cross join lateral unnest(session.player_ids) as participant(player_id)
      join public.profiles as profile on profile.player_id = participant.player_id
      join auth.users as auth_user on auth_user.id = profile.id
      where session.status = 'scheduled'
        and private.training_session_at(session.played_on, session.display_time) > now()
        and auth_user.email is not null
        and auth_user.email_confirmed_at is not null
        and not exists (
          select 1
          from private.training_calendar_baseline as baseline
          where baseline.training_session_id = session.id
        )
    ), known as (
      select distinct queue.training_session_id, queue.recipient_user_id as user_id
      from private.email_notification_queue as queue
      where queue.training_session_id is not null
        and queue.notification_type = 'calendar_invitation'
        and queue.status <> 'cancelled'
        and queue.source_match_at > now()
    )
    select
      coalesce(desired.training_session_id, known.training_session_id) as training_session_id,
      coalesce(desired.user_id, known.user_id) as user_id,
      desired.session_at as desired_session_at
    from desired
    full join known
      on known.training_session_id = desired.training_session_id
     and known.user_id = desired.user_id
  loop
    if not private.email_notification_enabled(pair.user_id, 'calendar_invitation') then
      continue;
    end if;

    delivered_type := null;
    delivered_session_at := null;
    select queue.notification_type, queue.source_match_at
    into delivered_type, delivered_session_at
    from private.email_notification_queue as queue
    where queue.training_session_id = pair.training_session_id
      and queue.recipient_user_id = pair.user_id
      and queue.status in ('processing', 'sent', 'failed')
    order by queue.id desc
    limit 1;

    needed_type := null;
    needed_session_at := null;
    if pair.desired_session_at is not null then
      if delivered_type is distinct from 'calendar_invitation'
        or delivered_session_at <> pair.desired_session_at then
        needed_type := 'calendar_invitation';
        needed_session_at := pair.desired_session_at;
      end if;
    elsif delivered_type = 'calendar_invitation'
      and delivered_session_at > now() then
      needed_type := 'calendar_cancellation';
      needed_session_at := delivered_session_at;
    end if;

    if exists (
      select 1
      from private.email_notification_queue as queue
      where queue.training_session_id = pair.training_session_id
        and queue.recipient_user_id = pair.user_id
        and queue.notification_type = needed_type
        and queue.source_match_at = needed_session_at
        and queue.status = 'pending'
    ) then
      continue;
    end if;

    update private.email_notification_queue as queue
    set status = 'cancelled',
        last_error = 'Durch eine neuere Terminänderung ersetzt.',
        updated_at = now()
    where queue.training_session_id = pair.training_session_id
      and queue.recipient_user_id = pair.user_id
      and queue.status = 'pending';

    if needed_type is null then
      continue;
    end if;

    select coalesce(max(queue.calendar_sequence), -1) + 1 into next_sequence
    from private.email_notification_queue as queue
    where queue.training_session_id = pair.training_session_id
      and queue.recipient_user_id = pair.user_id;

    insert into private.email_notification_queue (
      notification_type,
      recipient_user_id,
      training_session_id,
      source_match_at,
      scheduled_for,
      dedupe_key,
      calendar_sequence
    ) values (
      needed_type,
      pair.user_id,
      pair.training_session_id,
      needed_session_at,
      case
        when needed_session_at <= now() + interval '2 hours' then now()
        else now() + interval '15 minutes'
      end,
      concat('calendar:training-', pair.training_session_id, ':', pair.user_id, ':', next_sequence),
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
    'trainingCalendarInvitation', invitation_count,
    'trainingCalendarCancellation', cancellation_count
  );
end;
$$;

create or replace function private.queue_due_email_notifications()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.queue_due_reminder_notifications()
    || private.queue_calendar_notifications()
    || private.queue_training_calendar_notifications();
$$;

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
    concat(
      case
        when queue.training_session_id is not null then concat('training-', queue.training_session_id)
        else concat('match-', queue.match_id)
      end,
      '-', queue.recipient_user_id, '@padelliga'
    ),
    queue.calendar_sequence,
    queue.source_match_at
  from private.email_notification_queue as queue
  where queue.claim_token = p_claim_token
    and queue.status = 'processing'
    and queue.notification_type in ('calendar_invitation', 'calendar_cancellation');
end;
$$;

-- The result gains training_participants, which needs a drop. Trainings have no
-- season or teams, and a deleted training has no participants left to name.
drop function public.claim_due_email_notifications(uuid, integer);

create function public.claim_due_email_notifications(
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
  idempotency_key text,
  training_participants text
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
    case
      when claimed.training_session_id is not null then 'Training'
      else coalesce(
        match.display_label,
        'Partie ' || coalesce(substring(match.id from '([0-9]+)$'), match.matchday::text)
      )
    end,
    match.team_one_label,
    match.team_two_label,
    coalesce(proposal.match_at, match.match_at, claimed.source_match_at),
    proposal.actual_sets,
    proposal.result_details,
    claimed.dedupe_key,
    (
      select string_agg(
        coalesce(player.display_name, session.guest_names ->> participant.player_id),
        ', ' order by participant.position
      )
      from public.training_sessions as session
      cross join lateral unnest(session.player_ids) with ordinality as participant(player_id, position)
      left join public.players as player on player.id = participant.player_id
      where session.id = claimed.training_session_id
    )
  from claimed
  join auth.users as auth_user on auth_user.id = claimed.recipient_user_id
  join public.profiles as profile on profile.id = claimed.recipient_user_id
  left join public.matches as match on match.id = claimed.match_id
  left join public.seasons as season on season.id = match.season_id
  left join public.result_proposals as proposal on proposal.id = claimed.proposal_id
  order by claimed.scheduled_for, claimed.id;
end;
$$;

revoke all on function private.queue_training_calendar_notifications() from public, anon, authenticated;
revoke all on function private.queue_due_email_notifications() from public, anon, authenticated;
revoke all on function public.get_claimed_calendar_notifications(uuid) from public, anon, authenticated;
revoke all on function public.claim_due_email_notifications(uuid, integer) from public, anon, authenticated;

grant execute on function public.get_claimed_calendar_notifications(uuid) to service_role;
grant execute on function public.claim_due_email_notifications(uuid, integer) to service_role;

notify pgrst, 'reload schema';

commit;
