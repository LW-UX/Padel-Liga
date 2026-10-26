begin;

do $$
begin
  update public.training_sessions as session
  set player_ids = array['greta_p', 'ludwig_w', 'andreas_l', 'florian_z']::text[]
  where session.id = 4
    and session.played_on = date '2026-07-02'
    and session.display_time = time '12:30'
    and session.status = 'confirmed'
    and session.player_ids = array['luca_w', 'ludwig_w', 'marcel_m', 'chris_m']::text[];

  if not found then
    raise exception 'Training 4 entspricht nicht mehr dem erwarteten Ausgangsstand.';
  end if;

  update public.training_rounds as round
  set
    team_one_ids = array['greta_p', 'ludwig_w']::text[],
    team_two_ids = array['andreas_l', 'florian_z']::text[]
  where round.session_id = 4
    and round.round_number = 1
    and round.team_one_ids = array['luca_w', 'ludwig_w']::text[]
    and round.team_two_ids = array['marcel_m', 'chris_m']::text[]
    and round.result_details = '6:3, 4:6 – 10:5'
    and round.result_format = 'two_sets_match_tiebreak'
    and round.is_complete;

  if not found then
    raise exception 'Die Paarung von Training 4 entspricht nicht mehr dem erwarteten Ausgangsstand.';
  end if;

  if exists (
    select 1
    from public.training_rounds as round
    where round.session_id = 4
      and (
        round.team_one_ids <> array['greta_p', 'ludwig_w']::text[]
        or round.team_two_ids <> array['andreas_l', 'florian_z']::text[]
        or round.result_details <> '6:3, 4:6 – 10:5'
      )
  ) then
    raise exception 'Training 4 konnte nicht vollständig korrigiert werden.';
  end if;
end;
$$;

commit;
