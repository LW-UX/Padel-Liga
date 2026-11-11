begin;

-- Hallencodes gelten auch für Trainings mit zugeordneter Platzbuchung. Die
-- Edge Function übergibt Trainings als Kennung `training:<ID>`; Cache, Claim,
-- Abschluss und Störungserfassung reichen diese Kennung unverändert durch.
create or replace function public.get_court_access_code_subject(p_match_id text, p_user_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case
    when coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then null
    when p_match_id ~ '^training:[0-9]{1,18}$' then (
      select jsonb_build_object('bookingId', booking.id, 'providerId', booking.provider_booking_id,
        'startsAt', booking.starts_at, 'endsAt', booking.ends_at,
        'courtNumber', upper(substring(trim(booking.court_name) from '([Hh][1-4])$')))
      from private.court_bookings as booking
      join public.training_sessions as training on training.id = booking.training_session_id
      join public.profiles as profile on profile.id = p_user_id
      where training.id = substring(p_match_id from 10)::bigint
        and booking.cancelled_at is null
        -- Ein eingetragenes Ergebnis beendet die Codeanzeige wie bei Partien.
        and training.status = 'scheduled'
        and private.training_session_at(training.played_on, training.display_time) = booking.starts_at
        and booking.ends_at > now()
        and booking.provider_booking_id is not null
        and upper(trim(booking.court_name)) ~ '(^|[[:space:]])H[1-4]$'
        and (profile.app_role = 'admin'
          or (profile.app_role = 'player' and profile.player_id = any(training.player_ids)))
    )
    else (
      select jsonb_build_object('bookingId', booking.id, 'providerId', booking.provider_booking_id,
        'startsAt', booking.starts_at, 'endsAt', booking.ends_at,
        'courtNumber', upper(substring(trim(booking.court_name) from '([Hh][1-4])$')))
      from private.court_bookings as booking
      join public.matches as match on match.id = booking.match_id
      join public.profiles as profile on profile.id = p_user_id
      where booking.match_id = p_match_id
        and booking.cancelled_at is null
        and match.cancelled_at is null
        and match.match_at = booking.starts_at
        and match.actual_sets is null and match.result_details is null
        and not exists (select 1 from public.result_proposals as proposal
          where proposal.match_id = match.id and proposal.status = 'pending')
        and booking.ends_at > now()
        and booking.provider_booking_id is not null
        -- Only the four hall courts have an entrance code. Outdoor bookings
        -- must not trigger a code lookup or an unavailable-code message.
        and upper(trim(booking.court_name)) ~ '(^|[[:space:]])H[1-4]$'
        and (profile.app_role = 'admin' or (
          profile.app_role = 'player' and exists (
            select 1 from public.match_players as member
            where member.match_id = match.id and member.player_id = profile.player_id
          )
        ))
    )
  end;
$$;

revoke all on function public.get_court_access_code_subject(text, uuid) from public, anon, authenticated;
grant execute on function public.get_court_access_code_subject(text, uuid) to service_role;

commit;
