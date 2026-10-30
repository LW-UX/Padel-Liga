begin;

-- Calendar mail links to the match preview, which the database already decides
-- for tips. The result gains a column, which needs a drop.
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
  training_participants text,
  match_has_preview boolean
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
    ),
    coalesce(private.match_forecast_mode(match.id) = 'preview', false)
  from claimed
  join auth.users as auth_user on auth_user.id = claimed.recipient_user_id
  join public.profiles as profile on profile.id = claimed.recipient_user_id
  left join public.matches as match on match.id = claimed.match_id
  left join public.seasons as season on season.id = match.season_id
  left join public.result_proposals as proposal on proposal.id = claimed.proposal_id
  order by claimed.scheduled_for, claimed.id;
end;
$$;

revoke all on function public.claim_due_email_notifications(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_due_email_notifications(uuid, integer) to service_role;

notify pgrst, 'reload schema';

commit;
