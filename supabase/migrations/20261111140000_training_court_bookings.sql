begin;

alter table private.court_bookings
  add column training_session_id bigint references public.training_sessions(id) on delete set null,
  add constraint court_bookings_one_subject check (match_id is null or training_session_id is null);
create unique index court_bookings_one_active_per_training_idx
  on private.court_bookings(training_session_id)
  where training_session_id is not null and cancelled_at is null;

-- Terminänderungen geben die alte Platzbuchung wieder frei; die externe Buchung bleibt bestehen.
create function private.release_changed_training_court_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update private.court_bookings
    set training_session_id = null, assigned_at = null, assigned_by = null, updated_at = now()
    where training_session_id = old.id;
    return old;
  end if;
  if new.played_on is distinct from old.played_on or new.display_time is distinct from old.display_time then
    update private.court_bookings
    set training_session_id = null, assigned_at = null, assigned_by = null, updated_at = now()
    where training_session_id = new.id and cancelled_at is null
      and starts_at <> private.training_session_at(new.played_on, new.display_time);
  end if;
  return new;
end;
$$;
revoke all on function private.release_changed_training_court_booking() from public, anon, authenticated;
create trigger release_changed_training_court_booking
  after update of played_on, display_time on public.training_sessions
  for each row execute function private.release_changed_training_court_booking();
create trigger release_deleted_training_court_booking
  before delete on public.training_sessions
  for each row execute function private.release_changed_training_court_booking();

-- Speichern und Zuordnung sind eine Transaktion; die bestehenden Trainingsregeln bleiben maßgeblich.
create function public.save_training_with_court_booking(
  p_session_id bigint,
  p_played_on date,
  p_display_time time,
  p_player_ids text[],
  p_guest_names jsonb,
  p_court_booking_id bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking private.court_bookings%rowtype;
  session_id bigint := p_session_id;
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  if not private.user_email_is_confirmed(current_user_id) then
    raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen.';
  end if;
  select * into booking from private.court_bookings where id = p_court_booking_id for update;
  if not found or booking.cancelled_at is not null or booking.starts_at <= now() then
    raise exception 'Diese Platzbuchung ist nicht mehr verfügbar.';
  end if;
  if booking.match_id is not null
    or (booking.training_session_id is not null and booking.training_session_id is distinct from p_session_id) then
    raise exception 'Diese Platzbuchung wurde bereits einer anderen Partie oder einem Training zugeordnet.';
  end if;
  if p_played_on is null or p_display_time is null
    or booking.starts_at <> private.training_session_at(p_played_on, p_display_time) then
    raise exception 'Termin und Platzbuchung stimmen nicht überein.';
  end if;

  if session_id is null then
    session_id := public.schedule_training_session(p_played_on, p_display_time, p_player_ids, p_guest_names);
  else
    perform public.update_scheduled_training(session_id, p_played_on, p_display_time, p_player_ids, p_guest_names);
  end if;
  update private.court_bookings
  set training_session_id = null, assigned_at = null, assigned_by = null, updated_at = now()
  where training_session_id = session_id and id <> p_court_booking_id and cancelled_at is null;
  update private.court_bookings
  set training_session_id = session_id, assigned_at = now(), assigned_by = current_user_id, updated_at = now()
  where id = p_court_booking_id;
  return session_id;
end;
$$;
revoke all on function public.save_training_with_court_booking(bigint, date, time, text[], jsonb, bigint) from public, anon;
grant execute on function public.save_training_with_court_booking(bigint, date, time, text[], jsonb, bigint) to authenticated;

-- Die private Kalenderansicht erkennt beide Zuordnungsarten, ohne fremde Trainings offenzulegen.
drop function public.get_my_court_bookings(date);
create function public.get_my_court_bookings(p_date date default null)
returns table (
  booking_id bigint, court_resource_id text, court_name text,
  starts_at timestamptz, ends_at timestamptz, match_id text, match_label text,
  training_session_id bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select profile.player_id, profile.app_role from public.profiles as profile
    where profile.id = (select auth.uid()) and profile.app_role in ('player', 'admin')
  )
  select booking.id, booking.court_resource_id, booking.court_name,
    booking.starts_at, booking.ends_at, booking.match_id,
    case when booking.training_session_id is not null then 'Training' else match.display_label end,
    booking.training_session_id
  from private.court_bookings as booking
  cross join me
  left join public.matches as match on match.id = booking.match_id
  left join public.training_sessions as training on training.id = booking.training_session_id
  where booking.cancelled_at is null and booking.ends_at > now()
    and (p_date is null or (booking.starts_at at time zone 'Europe/Berlin')::date = p_date)
    and (me.app_role = 'admin'
      or (booking.match_id is null and booking.training_session_id is null)
      or exists (select 1 from public.match_players as member
        where member.match_id = booking.match_id and member.player_id = me.player_id)
      or training.created_by = (select auth.uid()) or me.player_id = any(training.player_ids))
  order by booking.starts_at, booking.court_name, booking.id;
$$;
revoke all on function public.get_my_court_bookings(date) from public, anon;
grant execute on function public.get_my_court_bookings(date) to authenticated;

notify pgrst, 'reload schema';
commit;
