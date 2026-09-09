begin;

do $$
declare
  selected_session_id bigint;
begin
  select session.id
  into selected_session_id
  from public.training_sessions as session
  where session.played_on = date '2025-09-19'
    and session.display_time = time '07:00'
    and session.status = 'confirmed'
    and session.player_ids @> array['raphael_h', 'marco_m', 'ludwig_w', 'luca_w']::text[]
    and session.player_ids <@ array['raphael_h', 'marco_m', 'ludwig_w', 'luca_w']::text[];

  if selected_session_id is null then
    raise exception 'Das bestätigte Training vom 19.09.2025 um 07:00 Uhr wurde nicht eindeutig gefunden.';
  end if;

  update public.training_rounds as round
  set result_details = '0:6, 4:6, 4:6'
  where round.session_id = selected_session_id
    and round.round_number = 1
    and round.team_one_ids = array['raphael_h', 'marco_m']::text[]
    and round.team_two_ids = array['ludwig_w', 'luca_w']::text[]
    and round.result_details = '6:0, 6:4, 6:4'
    and round.result_format = 'three_sets'
    and round.is_complete;

  if not found then
    raise exception 'Die Trainingsrunde entspricht nicht mehr dem erwarteten Ausgangsstand.';
  end if;
end;
$$;

commit;
