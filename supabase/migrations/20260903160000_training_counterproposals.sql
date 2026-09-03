begin;

create or replace function public.replace_pending_training_session(
  p_session_id bigint,
  p_played_on date,
  p_display_time time,
  p_player_ids text[],
  p_rounds jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_profile record;
  selected_session record;
  new_session_id bigint;
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  if not private.user_email_is_confirmed(current_user_id) then raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen.'; end if;

  select profile.* into current_profile
  from public.profiles as profile
  where profile.id = current_user_id;
  if not found then raise exception 'Kein Profil für dieses Konto gefunden.'; end if;

  select session.* into selected_session
  from public.training_sessions as session
  where session.id = p_session_id and session.status = 'pending'
  for update;
  if not found then raise exception 'Das Training ist nicht mehr offen.'; end if;

  if current_profile.app_role <> 'admin' and (
    current_profile.player_id is null
    or not (current_profile.player_id = any(selected_session.player_ids))
  ) then
    raise exception 'Nur beteiligte Spieler dürfen eine Alternative eingeben.';
  end if;

  delete from public.training_sessions as session
  where session.id = selected_session.id;

  select public.create_training_session(p_played_on, p_display_time, p_player_ids, p_rounds)
  into new_session_id;
  return new_session_id;
end;
$$;

revoke execute on function public.replace_pending_training_session(bigint, date, time, text[], jsonb) from public, anon;
grant execute on function public.replace_pending_training_session(bigint, date, time, text[], jsonb) to authenticated;

commit;
