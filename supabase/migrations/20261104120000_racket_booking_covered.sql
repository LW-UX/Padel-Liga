begin;

-- Hat ein Spieler des Termins die Schläger selbst in Clearooms gebucht, gilt der Termin als versorgt.
alter table public.racket_bookings
  add column covered_by text,
  drop constraint racket_bookings_state_check,
  add constraint racket_bookings_state_check
    check (state in ('booked', 'partial', 'covered', 'busy', 'outside_hours', 'failed'));

-- Liefert der Edge Function racket-booking Namen und Konto-E-Mails der Spieler eines Termins,
-- damit sie eigene Clearooms-Buchungen der Spieler erkennt. Fremde Aufrufer erhalten eine leere Liste.
create function public.get_racket_booking_participants(
  p_subject_type text,
  p_subject_id text,
  p_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_profile record;
  player_ids text[];
  training_creator uuid;
begin
  select profile.player_id, profile.app_role::text as app_role into current_profile
  from public.profiles as profile
  where profile.id = p_user_id;

  if p_subject_type = 'match' then
    select array_agg(member.player_id) into player_ids
    from public.match_players as member
    where member.match_id = p_subject_id;
  elsif p_subject_type = 'training' and p_subject_id ~ '^\d+$' then
    select session.player_ids, session.created_by into player_ids, training_creator
    from public.training_sessions as session
    where session.id = p_subject_id::bigint;
  end if;

  if player_ids is null then return '[]'::jsonb; end if;
  if current_profile.app_role is distinct from 'admin'
    and training_creator is distinct from p_user_id
    and (current_profile.player_id = any(player_ids)) is not true then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('name', player.display_name, 'email', lower(account.email)))
    from public.players as player
    join public.profiles as profile on profile.player_id = player.id
    join auth.users as account on account.id = profile.id
    where player.id = any(player_ids) and account.email is not null
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.get_racket_booking_participants(text, text, uuid) from public, anon, authenticated;
grant execute on function public.get_racket_booking_participants(text, text, uuid) to service_role;

commit;
