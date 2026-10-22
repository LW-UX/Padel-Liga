begin;

do $$
declare
  selected_session_id bigint;
begin
  select session.id
  into selected_session_id
  from public.training_sessions as session
  where session.played_on = date '2026-10-06'
    and session.display_time = time '12:30'
    and session.player_ids @> array['andreas_l', 'leonie_r', 'lukas_p', 'florian_z']::text[]
    and session.player_ids <@ array['andreas_l', 'leonie_r', 'lukas_p', 'florian_z']::text[]
  for update;

  if selected_session_id is null then
    raise exception 'Das zu korrigierende Training vom 6. Oktober wurde nicht eindeutig gefunden.';
  end if;

  update public.training_sessions
  set player_ids = array_replace(player_ids, 'florian_z', 'agnes_k')
  where id = selected_session_id;

  update public.training_rounds
  set
    team_one_ids = array_replace(team_one_ids, 'florian_z', 'agnes_k'),
    team_two_ids = array_replace(team_two_ids, 'florian_z', 'agnes_k')
  where session_id = selected_session_id;

  if exists (
    select 1
    from public.training_rounds as round
    where round.session_id = selected_session_id
      and (
        'florian_z' = any(round.team_one_ids || round.team_two_ids)
        or not (round.team_two_ids @> array['lukas_p', 'agnes_k']::text[])
      )
  ) then
    raise exception 'Die Trainingszuordnung konnte nicht vollständig korrigiert werden.';
  end if;
end;
$$;

commit;
