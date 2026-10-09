-- Run through tools/supabase-mcp.mjs only after explicit approval.
-- The QA match and every generated event are rolled back.
begin;

do $$
declare
  qa_match_id constant text := 'qa-live-ticker-games-acceptance';
  admin_id uuid;
  first_server text;
  second_server text;
  session_id bigint;
  expected_version integer;
  action_id uuid;
  game_index integer;
  point_index integer;
  winning_team smallint;
  score_case text;
begin
  select profile.id into admin_id
  from public.profiles as profile
  where profile.app_role = 'admin'
  order by profile.created_at
  limit 1;

  if admin_id is null then
    raise exception 'Game ticker acceptance test requires an admin profile';
  end if;

  delete from public.matches where id = qa_match_id;

  insert into public.matches
  select (jsonb_populate_record(
    null::public.matches,
    to_jsonb(source_match) || jsonb_build_object(
      'id', qa_match_id,
      'match_at', now(),
      'actual_sets', null,
      'result_details', null,
      'winner', null,
      'counts_for_ranking', false,
      'counts_for_elo', false,
      'betting_open', false,
      'display_label', 'QA Einfacher Liveticker'
    )
  )).*
  from public.matches as source_match
  where source_match.id = 'test-2026-live-2';

  if not found then
    raise exception 'Game ticker acceptance fixture is missing';
  end if;

  insert into public.match_players(match_id, player_id, team, position)
  select qa_match_id, member.player_id, member.team, member.position
  from public.match_players as member
  where member.match_id = 'test-2026-live-2';

  select member.player_id into first_server
  from public.match_players as member
  where member.match_id = qa_match_id and member.team = 1
  order by member.position
  limit 1;

  select member.player_id into second_server
  from public.match_players as member
  where member.match_id = qa_match_id and member.team = 2
  order by member.position
  limit 1;

  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform public.start_live_match_with_mode(qa_match_id, first_server, 'games');

  select active.id, active.version into session_id, expected_version
  from public.live_match_sessions as active
  where active.match_id = qa_match_id
    and active.status in ('live', 'needs_server', 'ready_to_finish');

  if (select scoring_mode from public.live_match_sessions where id = session_id) <> 'games' then
    raise exception 'The selected scoring mode was not stored';
  end if;

  action_id := gen_random_uuid();
  perform public.record_live_game(qa_match_id, 2::smallint, expected_version, action_id);
  perform public.record_live_game(qa_match_id, 2::smallint, expected_version, action_id);

  if (select count(*) from public.live_match_events where client_action_id = action_id) <> 1
    or not exists (
      select 1 from public.live_match_events
      where client_action_id = action_id and event_type = 'game' and was_break
    )
  then
    raise exception 'Idempotent game retry or break detection is incorrect';
  end if;

  if (select status from public.live_match_sessions where id = session_id) <> 'needs_server' then
    raise exception 'The first game did not request the other team first server';
  end if;

  select version into expected_version from public.live_match_sessions where id = session_id;
  perform public.set_live_team_first_server(qa_match_id, 2::smallint, second_server, expected_version);

  -- Complete eleven more alternating games to reach 6:6.
  for game_index in 2..12 loop
    winning_team := case when mod(game_index, 2) = 0 then 1 else 2 end;
    select version into expected_version from public.live_match_sessions where id = session_id;
    perform public.record_live_game(qa_match_id, winning_team, expected_version, gen_random_uuid());
  end loop;

  if not exists (
    select 1 from public.live_match_sessions
    where id = session_id and scoring_mode = 'games'
      and team_one_games = 6 and team_two_games = 6 and is_tiebreak and status = 'live'
  ) then
    raise exception 'The game ticker did not enter the tiebreak at 6:6';
  end if;

  select version into expected_version from public.live_match_sessions where id = session_id;
  begin
    perform public.record_live_tiebreak_result(
      qa_match_id, 7::smallint, 6::smallint, expected_version, gen_random_uuid()
    );
    raise exception 'An invalid tiebreak result was accepted';
  exception when others then
    if sqlerrm = 'An invalid tiebreak result was accepted' then raise; end if;
  end;
  begin
    perform public.record_live_tiebreak_result(
      qa_match_id, 8::smallint, 5::smallint, expected_version, gen_random_uuid()
    );
    raise exception 'An unreachable extended tiebreak result was accepted';
  exception when others then
    if sqlerrm = 'An unreachable extended tiebreak result was accepted' then raise; end if;
  end;

  perform public.record_live_tiebreak_result(
    qa_match_id, 8::smallint, 6::smallint, expected_version, gen_random_uuid()
  );
  if (select status from public.live_match_sessions where id = session_id) <> 'ready_to_finish' then
    raise exception 'A complete tiebreak did not make the game ticker ready to finish';
  end if;

  select version into expected_version from public.live_match_sessions where id = session_id;
  perform public.undo_live_game(qa_match_id, expected_version);
  if not exists (
    select 1 from public.live_match_sessions
    where id = session_id and team_one_games = 6 and team_two_games = 6
      and is_tiebreak and status = 'live'
  ) then
    raise exception 'Undo did not restore the pre-tiebreak game state';
  end if;

  select version into expected_version from public.live_match_sessions where id = session_id;
  perform public.record_live_tiebreak_result(
    qa_match_id, 7::smallint, 4::smallint, expected_version, gen_random_uuid()
  );
  select version into expected_version from public.live_match_sessions where id = session_id;
  perform public.finish_live_match(qa_match_id, expected_version);

  if not exists (
    select 1 from public.matches
    where id = qa_match_id and result_details = '7:6 (7:4)'
      and actual_sets = '1:0' and winner = 1
  ) then
    raise exception 'The official result was not derived from the game ticker';
  end if;

  -- Verify every regular single-set ending supported by game-by-game scoring.
  foreach score_case in array array['6:0', '6:4', '7:5'] loop
    update public.matches set actual_sets = null, result_details = null, winner = null
    where id = qa_match_id;
    perform public.start_live_match_with_mode(qa_match_id, first_server, 'games');
    select active.id, active.version into session_id, expected_version
    from public.live_match_sessions as active
    where active.match_id = qa_match_id
      and active.status in ('live', 'needs_server', 'ready_to_finish');

    perform public.record_live_game(qa_match_id, 1::smallint, expected_version, gen_random_uuid());
    select version into expected_version from public.live_match_sessions where id = session_id;
    perform public.set_live_team_first_server(qa_match_id, 2::smallint, second_server, expected_version);

    if score_case = '6:0' then
      for point_index in 1..5 loop
        select version into expected_version from public.live_match_sessions where id = session_id;
        perform public.record_live_game(qa_match_id, 1::smallint, expected_version, gen_random_uuid());
      end loop;
    elsif score_case = '6:4' then
      for point_index in 1..4 loop
        select version into expected_version from public.live_match_sessions where id = session_id;
        perform public.record_live_game(qa_match_id, 1::smallint, expected_version, gen_random_uuid());
      end loop;
      for point_index in 1..4 loop
        select version into expected_version from public.live_match_sessions where id = session_id;
        perform public.record_live_game(qa_match_id, 2::smallint, expected_version, gen_random_uuid());
      end loop;
      select version into expected_version from public.live_match_sessions where id = session_id;
      perform public.record_live_game(qa_match_id, 1::smallint, expected_version, gen_random_uuid());
    else
      for point_index in 1..4 loop
        select version into expected_version from public.live_match_sessions where id = session_id;
        perform public.record_live_game(qa_match_id, 2::smallint, expected_version, gen_random_uuid());
        select version into expected_version from public.live_match_sessions where id = session_id;
        perform public.record_live_game(qa_match_id, 1::smallint, expected_version, gen_random_uuid());
      end loop;
      select version into expected_version from public.live_match_sessions where id = session_id;
      perform public.record_live_game(qa_match_id, 2::smallint, expected_version, gen_random_uuid());
      for point_index in 1..2 loop
        select version into expected_version from public.live_match_sessions where id = session_id;
        perform public.record_live_game(qa_match_id, 1::smallint, expected_version, gen_random_uuid());
      end loop;
    end if;

    if (select status from public.live_match_sessions where id = session_id) <> 'ready_to_finish' then
      raise exception 'Regular game ticker ending % was not recognized', score_case;
    end if;
    select version into expected_version from public.live_match_sessions where id = session_id;
    perform public.finish_live_match(qa_match_id, expected_version);
    if (select result_details from public.matches where id = qa_match_id) <> score_case then
      raise exception 'Regular game ticker ending % was not persisted', score_case;
    end if;
  end loop;
end;
$$;

rollback;
