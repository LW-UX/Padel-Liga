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

  if (
    select count(*)
    from public.players as player
    where player.id in (
      'marco_m', 'andreas_l', 'greta_p', 'niklas_k',
      'ludwig_w', 'marcel_m', 'jonas_l'
    )
  ) <> 7 then
    raise exception 'Mindestens ein Spieler für die September-Trainings fehlt.';
  end if;

  if exists (
    select 1
    from public.training_sessions as session
    where session.played_on = date '2026-09-02'
      and session.display_time = time '17:00'
      and session.player_ids @> array['marco_m', 'andreas_l', 'greta_p', 'niklas_k']::text[]
      and session.player_ids <@ array['marco_m', 'andreas_l', 'greta_p', 'niklas_k']::text[]
  ) then
    raise exception 'Das Training vom 02.09.2026 um 17:00 Uhr ist bereits vorhanden.';
  end if;

  insert into public.training_sessions (
    played_on, display_time, player_ids, created_by, status, confirmed_by, confirmed_at
  ) values (
    date '2026-09-02', time '17:00', array['marco_m', 'andreas_l', 'greta_p', 'niklas_k'],
    admin_account_id, 'confirmed', admin_account_id, now()
  ) returning id into imported_session_id;

  insert into public.training_rounds (
    session_id, round_number, team_one_ids, team_two_ids,
    result_details, set_count, is_complete, result_format
  ) values
    (
      imported_session_id, 1,
      array['marco_m', 'andreas_l'], array['greta_p', 'niklas_k'],
      '6:1', 1, true, 'one_set'
    ),
    (
      imported_session_id, 2,
      array['greta_p', 'andreas_l'], array['niklas_k', 'marco_m'],
      '6:1', 1, true, 'one_set'
    ),
    (
      imported_session_id, 3,
      array['niklas_k', 'andreas_l'], array['greta_p', 'marco_m'],
      '4:3', 1, false, 'one_set'
    );

  if exists (
    select 1
    from public.training_sessions as session
    where session.played_on = date '2026-09-08'
      and session.display_time = time '12:15'
      and session.player_ids @> array['marco_m', 'ludwig_w', 'marcel_m', 'jonas_l']::text[]
      and session.player_ids <@ array['marco_m', 'ludwig_w', 'marcel_m', 'jonas_l']::text[]
  ) then
    raise exception 'Das Training vom 08.09.2026 um 12:15 Uhr ist bereits vorhanden.';
  end if;

  insert into public.training_sessions (
    played_on, display_time, player_ids, created_by, status, confirmed_by, confirmed_at
  ) values (
    date '2026-09-08', time '12:15', array['marco_m', 'ludwig_w', 'marcel_m', 'jonas_l'],
    admin_account_id, 'confirmed', admin_account_id, now()
  ) returning id into imported_session_id;

  insert into public.training_rounds (
    session_id, round_number, team_one_ids, team_two_ids,
    result_details, set_count, is_complete, result_format
  ) values (
    imported_session_id, 1,
    array['marco_m', 'ludwig_w'], array['marcel_m', 'jonas_l'],
    '6:4, 6:3, 4:2', 3, false, 'three_sets'
  );
end;
$$;

commit;
