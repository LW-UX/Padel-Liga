begin;

do $$
declare
  selected_session_id bigint;
begin
  select session.id
  into selected_session_id
  from public.training_sessions as session
  where session.played_on = date '2026-07-02'
    and session.display_time = time '12:30'
    and session.player_ids @> array['andreas_l', 'luca_w', 'niklas_k', 'chris_m']::text[]
    and session.player_ids <@ array['andreas_l', 'luca_w', 'niklas_k', 'chris_m']::text[]
  for update;

  if selected_session_id is null then
    raise exception 'Das zu korrigierende Lotz-Training wurde nicht eindeutig gefunden.';
  end if;

  update public.training_sessions
  set player_ids = array_replace(player_ids, 'andreas_l', 'christoph_l')
  where id = selected_session_id;

  update public.training_rounds
  set
    team_one_ids = array_replace(team_one_ids, 'andreas_l', 'christoph_l'),
    team_two_ids = array_replace(team_two_ids, 'andreas_l', 'christoph_l')
  where session_id = selected_session_id;

  if not exists (
    select 1
    from public.training_rounds as round
    where round.session_id = selected_session_id
      and 'christoph_l' = any(round.team_one_ids || round.team_two_ids)
      and not ('andreas_l' = any(round.team_one_ids || round.team_two_ids))
  ) then
    raise exception 'Die Lotz-Zuordnung konnte nicht vollständig korrigiert werden.';
  end if;
end;
$$;

commit;
