begin;

do $$
declare
  admin_account_id uuid;
  imported_session_id bigint;
begin
  select profile.id
  into admin_account_id
  from public.profiles as profile
  where profile.app_role = 'admin'
    and profile.player_id = 'ludwig_w';

  if admin_account_id is null then
    raise exception 'Das Adminprofil von Ludwig W. fehlt.';
  end if;

  if exists (
    select 1 from public.training_sessions
    where played_on = date '2025-09-19' and display_time = time '07:00'
      and player_ids @> array['raphael_h', 'marco_m', 'ludwig_w', 'luca_w']::text[]
      and player_ids <@ array['raphael_h', 'marco_m', 'ludwig_w', 'luca_w']::text[]
  ) then
    raise exception 'Das Training vom 19.09.2025 um 07:00 Uhr ist bereits vorhanden.';
  end if;

  insert into public.training_sessions (
    played_on, display_time, player_ids, created_by, status, confirmed_by, confirmed_at
  ) values (
    date '2025-09-19', time '07:00', array['raphael_h', 'marco_m', 'ludwig_w', 'luca_w'],
    admin_account_id, 'confirmed', admin_account_id, now()
  ) returning id into imported_session_id;

  insert into public.training_rounds (
    session_id, round_number, team_one_ids, team_two_ids, result_details, set_count, is_complete
  ) values (
    imported_session_id, 1, array['raphael_h', 'marco_m'], array['ludwig_w', 'luca_w'],
    '6:0, 6:4, 6:4', 3, true
  );

  if exists (
    select 1 from public.training_sessions
    where played_on = date '2026-04-23' and display_time = time '12:30'
      and player_ids @> array['luca_w', 'ludwig_w', 'niklas_k', 'greta_p']::text[]
      and player_ids <@ array['luca_w', 'ludwig_w', 'niklas_k', 'greta_p']::text[]
  ) then
    raise exception 'Das Training vom 23.04.2026 um 12:30 Uhr ist bereits vorhanden.';
  end if;

  insert into public.training_sessions (
    played_on, display_time, player_ids, created_by, status, confirmed_by, confirmed_at
  ) values (
    date '2026-04-23', time '12:30', array['luca_w', 'ludwig_w', 'niklas_k', 'greta_p'],
    admin_account_id, 'confirmed', admin_account_id, now()
  ) returning id into imported_session_id;

  insert into public.training_rounds (
    session_id, round_number, team_one_ids, team_two_ids, result_details, set_count, is_complete
  ) values (
    imported_session_id, 1, array['luca_w', 'ludwig_w'], array['niklas_k', 'greta_p'],
    '6:2, 7:5', 2, true
  );

  if exists (
    select 1 from public.training_sessions
    where played_on = date '2026-07-02' and display_time = time '12:30'
      and player_ids @> array['luca_w', 'ludwig_w', 'marcel_m', 'chris_m']::text[]
      and player_ids <@ array['luca_w', 'ludwig_w', 'marcel_m', 'chris_m']::text[]
  ) then
    raise exception 'Das erste Training vom 02.07.2026 um 12:30 Uhr ist bereits vorhanden.';
  end if;

  insert into public.training_sessions (
    played_on, display_time, player_ids, created_by, status, confirmed_by, confirmed_at
  ) values (
    date '2026-07-02', time '12:30', array['luca_w', 'ludwig_w', 'marcel_m', 'chris_m'],
    admin_account_id, 'confirmed', admin_account_id, now()
  ) returning id into imported_session_id;

  insert into public.training_rounds (
    session_id, round_number, team_one_ids, team_two_ids, result_details, set_count, is_complete
  ) values (
    imported_session_id, 1, array['luca_w', 'ludwig_w'], array['marcel_m', 'chris_m'],
    '6:3, 4:6 – 10:5', 3, true
  );

  if exists (
    select 1 from public.training_sessions
    where played_on = date '2026-07-02' and display_time = time '12:30'
      and player_ids @> array['andreas_l', 'luca_w', 'niklas_k', 'chris_m']::text[]
      and player_ids <@ array['andreas_l', 'luca_w', 'niklas_k', 'chris_m']::text[]
  ) then
    raise exception 'Das zweite Training vom 02.07.2026 um 12:30 Uhr ist bereits vorhanden.';
  end if;

  insert into public.training_sessions (
    played_on, display_time, player_ids, created_by, status, confirmed_by, confirmed_at
  ) values (
    date '2026-07-02', time '12:30', array['andreas_l', 'luca_w', 'niklas_k', 'chris_m'],
    admin_account_id, 'confirmed', admin_account_id, now()
  ) returning id into imported_session_id;

  insert into public.training_rounds (
    session_id, round_number, team_one_ids, team_two_ids, result_details, set_count, is_complete
  ) values (
    imported_session_id, 1, array['andreas_l', 'luca_w'], array['niklas_k', 'chris_m'],
    '4:6, 6:4, 4:6', 3, true
  );

  if exists (
    select 1 from public.training_sessions
    where played_on = date '2026-08-13' and display_time = time '08:00'
      and player_ids @> array['luca_w', 'ludwig_w', 'marco_m', 'chris_m']::text[]
      and player_ids <@ array['luca_w', 'ludwig_w', 'marco_m', 'chris_m']::text[]
  ) then
    raise exception 'Das Training vom 13.08.2026 um 08:00 Uhr ist bereits vorhanden.';
  end if;

  insert into public.training_sessions (
    played_on, display_time, player_ids, created_by, status, confirmed_by, confirmed_at
  ) values (
    date '2026-08-13', time '08:00', array['luca_w', 'ludwig_w', 'marco_m', 'chris_m'],
    admin_account_id, 'confirmed', admin_account_id, now()
  ) returning id into imported_session_id;

  insert into public.training_rounds (
    session_id, round_number, team_one_ids, team_two_ids, result_details, set_count, is_complete
  ) values
    (imported_session_id, 1, array['luca_w', 'ludwig_w'], array['marco_m', 'chris_m'], '6:2', 1, true),
    (imported_session_id, 2, array['luca_w', 'chris_m'], array['marco_m', 'ludwig_w'], '4:6', 1, true),
    (imported_session_id, 3, array['luca_w', 'marco_m'], array['chris_m', 'ludwig_w'], '3:1', 1, false);
end;
$$;

commit;
