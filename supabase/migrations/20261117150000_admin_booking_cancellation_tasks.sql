begin;

-- Admins erhalten dieselbe gemeinsame Stornierungsaufgabe wie die Beteiligten.
create or replace function public.get_my_court_booking_cancellation_tasks()
returns table (
  booking_id bigint,
  match_id text,
  season_id text,
  league_label text,
  display_label text,
  court_name text,
  starts_at timestamptz,
  team_one_label text,
  team_two_label text
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select profile.player_id, profile.app_role
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.app_role in ('player', 'admin')
  )
  select booking.id, match.id, match.season_id, league.label, match.display_label,
    booking.court_name, booking.starts_at, match.team_one_label, match.team_two_label
  from private.court_bookings as booking
  join public.matches as match on match.id = booking.match_id
  join public.leagues as league
    on league.season_id = match.season_id and league.id = match.league_id
  cross join me
  where (me.app_role = 'admin' or exists (
      select 1 from public.match_players as member
      where member.match_id = match.id and member.player_id = me.player_id
    ))
    and booking.cancelled_at is not null
    and booking.cancellation_resolved_at is null
    and match.match_at = booking.starts_at
    and match.match_at > now()
    and match.actual_sets is null
    and match.result_details is null
    and match.cancelled_at is null
    and not exists (
      select 1 from public.result_proposals as proposal
      where proposal.match_id = match.id and proposal.status = 'pending'
    )
  order by booking.starts_at, booking.id;
$$;

create or replace function public.confirm_court_booking_cancellation(p_booking_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_profile record;
  booking private.court_bookings%rowtype;
  selected_match record;
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  if not private.user_email_is_confirmed(current_user_id) then
    raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen.';
  end if;

  select profile.* into current_profile
  from public.profiles as profile
  where profile.id = current_user_id;
  if not found or (current_profile.app_role is distinct from 'admin'
    and current_profile.player_id is null) then
    raise exception 'Kein Spielerprofil für dieses Konto gefunden.';
  end if;

  select entry.* into booking
  from private.court_bookings as entry
  where entry.id = p_booking_id
  for update;
  if not found or booking.cancelled_at is null or booking.match_id is null then
    raise exception 'Die stornierte Platzbuchung wurde nicht gefunden.';
  end if;

  if current_profile.app_role is distinct from 'admin' and not exists (
    select 1 from public.match_players as member
    where member.match_id = booking.match_id
      and member.player_id = current_profile.player_id
  ) then
    raise exception 'Nur beteiligte Spieler oder Admins dürfen den Termin aufheben.';
  end if;

  if booking.cancellation_resolved_at is not null then
    return jsonb_build_object('status', 'already_resolved', 'matchId', booking.match_id);
  end if;

  select match.* into selected_match
  from public.matches as match
  where match.id = booking.match_id
  for update;

  if not found
    or selected_match.match_at is distinct from booking.starts_at
    or selected_match.actual_sets is not null
    or selected_match.result_details is not null
    or selected_match.cancelled_at is not null
    or exists (
      select 1 from private.court_bookings as replacement
      where replacement.match_id = booking.match_id
        and replacement.cancelled_at is null
    ) then
    update private.court_bookings
    set cancellation_resolved_at = now(), cancellation_resolved_by = current_user_id,
        cancellation_resolution = 'no_action', updated_at = now()
    where id = booking.id;
    return jsonb_build_object('status', 'already_resolved', 'matchId', booking.match_id);
  end if;

  if exists (
    select 1 from public.result_proposals as proposal
    where proposal.match_id = booking.match_id and proposal.status = 'pending'
  ) then
    raise exception 'Für diese Partie wartet bereits ein Ergebnis auf Bestätigung.';
  end if;

  update public.matches set match_at = null where id = booking.match_id;
  update private.court_bookings
  set cancellation_resolved_at = now(), cancellation_resolved_by = current_user_id,
      cancellation_resolution = 'unscheduled', updated_at = now()
  where id = booking.id;

  return jsonb_build_object('status', 'unscheduled', 'matchId', booking.match_id);
end;
$$;

notify pgrst, 'reload schema';
commit;
