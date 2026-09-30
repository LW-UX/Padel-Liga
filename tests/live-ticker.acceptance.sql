-- Run through tools/supabase-mcp.mjs only after explicit approval.
-- The QA match and every generated event are rolled back.
begin;

do $$
declare
  qa_match_id constant text := 'qa-live-ticker-acceptance';
  admin_id uuid;
  first_server text;
  second_server text;
  session_id bigint;
  expected_version integer;
  action_id uuid;
  server_after_first_tiebreak_point text;
  server_after_second_tiebreak_point text;
  server_after_third_tiebreak_point text;
  payload jsonb;
  game_index integer;
  point_index integer;
  winning_team smallint;
begin
  select profile.id into admin_id
  from public.profiles as profile
  where profile.app_role = 'admin'
  order by profile.created_at
  limit 1;

  if admin_id is null then
    raise exception 'Liveticker acceptance test requires an admin profile';
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
      'display_label', 'QA Liveticker'
    )
  )).*
  from public.matches as source_match
  where source_match.id = 'test-2026-live-2';

  if not found then
    raise exception 'Liveticker acceptance test fixture is missing';
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
  perform public.start_live_match(qa_match_id, first_server);

  select active.id, active.version into session_id, expected_version
  from public.live_match_sessions as active
  where active.match_id = qa_match_id
    and active.status in ('live', 'needs_server', 'ready_to_finish');

  action_id := gen_random_uuid();
  perform public.record_live_point(qa_match_id, 1::smallint, expected_version, action_id);
  perform public.record_live_point(qa_match_id, 1::smallint, expected_version, action_id);

  if (select count(*) from public.live_match_events where client_action_id = action_id) <> 1
    or (select version from public.live_match_sessions where id = session_id) <> expected_version + 1
  then
    raise exception 'Idempotent retry changed the live score twice';
  end if;

  begin
    perform public.record_live_point(qa_match_id, 1::smallint, expected_version, gen_random_uuid());
    raise exception 'Stale live version was accepted';
  exception when serialization_failure then
    null;
  end;

  -- Complete the first game after its already recorded opening point.
  for point_index in 1..3 loop
    select version into expected_version from public.live_match_sessions where id = session_id;
    perform public.record_live_point(qa_match_id, 1::smallint, expected_version, gen_random_uuid());
  end loop;

  if (select status from public.live_match_sessions where id = session_id) <> 'needs_server' then
    raise exception 'The first game did not request the other team first server';
  end if;

  select version into expected_version from public.live_match_sessions where id = session_id;
  perform public.set_live_team_first_server(qa_match_id, 2::smallint, second_server, expected_version);

  -- Reach 40:40, let team two win the Golden Point, undo it, and replay it.
  for point_index in 1..3 loop
    select version into expected_version from public.live_match_sessions where id = session_id;
    perform public.record_live_point(qa_match_id, 1::smallint, expected_version, gen_random_uuid());
    select version into expected_version from public.live_match_sessions where id = session_id;
    perform public.record_live_point(qa_match_id, 2::smallint, expected_version, gen_random_uuid());
  end loop;
  select version into expected_version from public.live_match_sessions where id = session_id;
  perform public.record_live_point(qa_match_id, 2::smallint, expected_version, gen_random_uuid());

  if not exists (
    select 1 from public.live_match_sessions
    where id = session_id and team_one_games = 1 and team_two_games = 1
      and team_one_points = 0 and team_two_points = 0
  ) then
    raise exception 'Golden Point did not finish the game';
  end if;

  select version into expected_version from public.live_match_sessions where id = session_id;
  perform public.undo_live_point(qa_match_id, expected_version);
  if not exists (
    select 1 from public.live_match_sessions
    where id = session_id and team_one_games = 1 and team_two_games = 0
      and team_one_points = 3 and team_two_points = 3 and status = 'live'
  ) then
    raise exception 'Undo did not restore the exact pre-Golden-Point state';
  end if;

  select version into expected_version from public.live_match_sessions where id = session_id;
  perform public.record_live_point(qa_match_id, 2::smallint, expected_version, gen_random_uuid());

  -- Alternate ten service games to enter the set tiebreak at 6:6.
  for game_index in 1..10 loop
    winning_team := case when mod(game_index, 2) = 1 then 1 else 2 end;
    for point_index in 1..4 loop
      select version into expected_version from public.live_match_sessions where id = session_id;
      perform public.record_live_point(qa_match_id, winning_team, expected_version, gen_random_uuid());
    end loop;
  end loop;

  if not exists (
    select 1 from public.live_match_sessions
    where id = session_id and team_one_games = 6 and team_two_games = 6
      and is_tiebreak and status = 'live'
  ) then
    raise exception 'The set did not enter a tiebreak at 6:6';
  end if;

  select version into expected_version from public.live_match_sessions where id = session_id;
  perform public.record_live_point(qa_match_id, 1::smallint, expected_version, gen_random_uuid());
  select current_server_player_id into server_after_first_tiebreak_point
  from public.live_match_sessions where id = session_id;

  select version into expected_version from public.live_match_sessions where id = session_id;
  perform public.record_live_point(qa_match_id, 2::smallint, expected_version, gen_random_uuid());
  select current_server_player_id into server_after_second_tiebreak_point
  from public.live_match_sessions where id = session_id;

  select version into expected_version from public.live_match_sessions where id = session_id;
  perform public.record_live_point(qa_match_id, 2::smallint, expected_version, gen_random_uuid());
  select current_server_player_id into server_after_third_tiebreak_point
  from public.live_match_sessions where id = session_id;

  if server_after_first_tiebreak_point is distinct from second_server
    or server_after_second_tiebreak_point is distinct from second_server
    or server_after_third_tiebreak_point = second_server
  then
    raise exception 'Tiebreak service rotation is incorrect';
  end if;

  for point_index in 1..6 loop
    select version into expected_version from public.live_match_sessions where id = session_id;
    perform public.record_live_point(qa_match_id, 1::smallint, expected_version, gen_random_uuid());
  end loop;

  if (select status from public.live_match_sessions where id = session_id) <> 'ready_to_finish' then
    raise exception 'Completed tiebreak did not make the match ready to finish';
  end if;

  select version into expected_version from public.live_match_sessions where id = session_id;
  perform public.finish_live_match(qa_match_id, expected_version);

  if not exists (
    select 1 from public.matches
    where id = qa_match_id and result_details = '7:6 (7:2)'
      and actual_sets = '1:0' and winner = 1
  ) then
    raise exception 'Official result was not derived from the live events';
  end if;

  perform public.admin_correct_live_match_result(qa_match_id, '6:4', '1:0', 1::smallint, 'QA correction');
  payload := public.get_public_live_ticker(qa_match_id);

  if payload->>'result' is distinct from '6:4'
    or coalesce((payload->>'corrected')::boolean, false) is not true
    or jsonb_array_length(payload->'session'->'events') <> 0
  then
    raise exception 'The public corrected archive is inconsistent';
  end if;
end;
$$;

rollback;
