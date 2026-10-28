begin;

create or replace function public.submit_scheduled_training_result(
  p_session_id bigint,
  p_played_on date,
  p_display_time time,
  p_player_ids text[],
  p_rounds jsonb,
  p_guest_names jsonb
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
  select profile.* into current_profile
  from public.profiles as profile where profile.id = current_user_id;
  select session.* into selected_session
  from public.training_sessions as session
  where session.id = p_session_id and session.status = 'scheduled'
  for update;
  if not found then raise exception 'Der Trainingstermin ist nicht mehr verfügbar.'; end if;
  if current_profile.app_role <> 'admin'
    and (current_profile.player_id is null
      or not (current_profile.player_id = any(selected_session.player_ids))) then
    raise exception 'Nur ein beteiligter Spieler darf das Ergebnis eintragen.';
  end if;

  -- Die gemeinsame Erfassungsfunktion validiert die vier tatsächlichen Teilnehmer,
  -- Gastnamen, Paarungen und zusätzlich die Teilnahme des Einreichenden.
  select public.create_training_session(
    p_played_on, p_display_time, p_player_ids, p_rounds, p_guest_names
  ) into new_session_id;

  delete from public.training_sessions where id = selected_session.id;
  return new_session_id;
end;
$$;

commit;
