begin;

-- The sequence also counts mails that were replaced during the waiting time and
-- never left, so it cannot tell whether the calendar already shows this
-- appointment. Only an invitation that was really sent and not cancelled since
-- makes the new mail an update.
drop function public.get_claimed_calendar_notifications(uuid);

create function public.get_claimed_calendar_notifications(p_claim_token uuid)
returns table (
  job_id bigint,
  calendar_uid text,
  calendar_sequence integer,
  event_start timestamptz,
  is_update boolean
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
    queue.source_match_at,
    coalesce((
      select earlier.notification_type = 'calendar_invitation'
      from private.email_notification_queue as earlier
      where earlier.recipient_user_id = queue.recipient_user_id
        and earlier.match_id is not distinct from queue.match_id
        and earlier.training_session_id is not distinct from queue.training_session_id
        and earlier.notification_type in ('calendar_invitation', 'calendar_cancellation')
        and earlier.status = 'sent'
        and earlier.id < queue.id
      order by earlier.id desc
      limit 1
    ), false)
  from private.email_notification_queue as queue
  where queue.claim_token = p_claim_token
    and queue.status = 'processing'
    and queue.notification_type in ('calendar_invitation', 'calendar_cancellation');
end;
$$;

revoke all on function public.get_claimed_calendar_notifications(uuid) from public, anon, authenticated;
grant execute on function public.get_claimed_calendar_notifications(uuid) to service_role;

notify pgrst, 'reload schema';

commit;
