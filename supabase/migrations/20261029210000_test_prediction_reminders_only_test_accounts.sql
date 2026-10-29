begin;

-- Test matches are hidden from regular accounts, so their prediction reminders
-- only go to the four internal test profiles.
create or replace function private.queue_due_reminder_notifications()
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
    and (
      season.id not in ('2026-test', 'test-2026')
      or profile.player_id in ('ludi_gmail', 'ludi_gmx', 'ludi_ionos', 'test_net')
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

revoke all on function private.queue_due_reminder_notifications() from public, anon, authenticated;

commit;
