begin;

create extension if not exists pg_cron;

create index if not exists result_proposals_pending_created_at_idx
  on public.result_proposals (created_at, id)
  where status = 'pending';

create index if not exists training_sessions_pending_created_at_idx
  on public.training_sessions (created_at, id)
  where status = 'pending';

create or replace function private.auto_confirm_expired_results()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_proposal_ids bigint[];
  confirmed_match_count integer := 0;
  confirmed_training_count integer := 0;
begin
  -- Lock every currently available candidate before taking the global Elo lock.
  -- This preserves the lock order used by interactive confirmations and skips
  -- proposals that are being confirmed or replaced at the same time.
  select coalesce(array_agg(expired.id order by expired.created_at, expired.id), '{}'::bigint[])
  into expired_proposal_ids
  from (
    select proposal.id, proposal.created_at
    from public.result_proposals as proposal
    join public.matches as match on match.id = proposal.match_id
    where proposal.status = 'pending'
      and proposal.created_at <= now() - interval '48 hours'
      and match.actual_sets is null
    order by proposal.created_at, proposal.id
    for update of proposal, match skip locked
  ) as expired;

  if cardinality(expired_proposal_ids) > 0 then
    perform pg_advisory_xact_lock(70317, 20270909);

    update public.result_proposals as proposal
    set status = 'confirmed',
      confirmed_by = null,
      resolved_at = now()
    where proposal.id = any(expired_proposal_ids)
      and proposal.status = 'pending';

    update public.matches as match
    set match_at = proposal.match_at,
      result_details = proposal.result_details,
      actual_sets = proposal.actual_sets,
      winner = proposal.winner
    from public.result_proposals as proposal
    where proposal.id = any(expired_proposal_ids)
      and proposal.match_id = match.id
      and proposal.status = 'confirmed'
      and proposal.confirmed_by is null
      and match.actual_sets is null;

    get diagnostics confirmed_match_count = row_count;
  end if;

  with expired_sessions as (
    select session.id
    from public.training_sessions as session
    where session.status = 'pending'
      and session.created_at <= now() - interval '48 hours'
    order by session.created_at, session.id
    for update skip locked
  )
  update public.training_sessions as session
  set status = 'confirmed',
    confirmed_by = null,
    confirmed_at = now()
  where session.id in (select expired.id from expired_sessions as expired)
    and session.status = 'pending';

  get diagnostics confirmed_training_count = row_count;

  return jsonb_build_object(
    'confirmedMatches', confirmed_match_count,
    'confirmedTrainings', confirmed_training_count
  );
end;
$$;

revoke all on function private.auto_confirm_expired_results() from public, anon, authenticated;

select cron.schedule(
  'auto-confirm-results-after-48-hours',
  '*/5 * * * *',
  $cron$select private.auto_confirm_expired_results();$cron$
);

commit;
