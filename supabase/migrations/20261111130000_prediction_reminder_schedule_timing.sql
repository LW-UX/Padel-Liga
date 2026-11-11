begin;

-- Keep the scheduling event separate from unrelated match updates and mail delays.
create table private.match_schedule_timing (
  match_id text primary key references public.matches(id) on delete cascade,
  match_at timestamptz not null,
  scheduled_at timestamptz not null
);
revoke all on private.match_schedule_timing from public, anon, authenticated;

create function private.record_match_schedule_timing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.match_at is not distinct from old.match_at then return new; end if;
  end if;
  if new.match_at is null then
    delete from private.match_schedule_timing where match_id = new.id;
  else
    insert into private.match_schedule_timing(match_id, match_at, scheduled_at)
    values(new.id, new.match_at, now())
    on conflict(match_id) do update
      set match_at = excluded.match_at, scheduled_at = excluded.scheduled_at;
  end if;
  return new;
end;
$$;
revoke all on function private.record_match_schedule_timing() from public, anon, authenticated;

create trigger record_match_schedule_timing
after insert or update of match_at on public.matches
for each row execute function private.record_match_schedule_timing();

-- Existing appointments have no reliable scheduling timestamp. Do not invent one.
create function public.get_claimed_prediction_reminder_context(p_claim_token uuid)
returns table(job_id bigint, short_notice boolean)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Nicht erlaubt.';
  end if;
  if p_claim_token is null then raise exception 'Claim-Token fehlt.'; end if;
  return query
  select queue.id, timing.scheduled_at > queue.source_match_at - interval '24 hours'
  from private.email_notification_queue as queue
  left join private.match_schedule_timing as timing
    on timing.match_id = queue.match_id and timing.match_at = queue.source_match_at
  where queue.claim_token = p_claim_token and queue.status = 'processing'
    and queue.notification_type = 'prediction_reminder';
end;
$$;
revoke all on function public.get_claimed_prediction_reminder_context(uuid) from public, anon, authenticated;
grant execute on function public.get_claimed_prediction_reminder_context(uuid) to service_role;

commit;
