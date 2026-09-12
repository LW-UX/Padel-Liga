-- Historical pre-v2 contract: run before arcade_rulesets, as the local QA runner does.
-- Run against the project database only through its MCP helper and after approval.
-- These isolated test entries and all other changes are rolled back.
begin;
do $$
declare
  v_easy uuid := gen_random_uuid();
  v_hard uuid := gen_random_uuid();
  v_tie uuid := gen_random_uuid();
  v_legacy uuid := gen_random_uuid();
  v_own uuid := gen_random_uuid();
  i integer;
  v_result jsonb;
  v_rank bigint;
  v_before jsonb := public.get_arcade_leaderboard(null, 'hard');
  v_difficulty text;
begin
  perform public.submit_arcade_win(v_easy, 'QAEasy', 7, 0, 1, 10, 'easy');
  if public.get_arcade_leaderboard(null, 'hard') is distinct from v_before then
    raise exception 'Easy result changed the hard leaderboard';
  end if;
  perform public.submit_arcade_win(v_hard, 'QAHard', 7, 0, 1, 12, 'hard');
  perform public.submit_arcade_win(v_tie, 'QATie', 7, 0, 1, 18, 'easy');
  if (public.submit_arcade_win(v_easy, 'QAEasy', 7, 0, 1, 10, 'easy')->>'rank')::int <> 1
    or (public.submit_arcade_win(v_hard, 'QAHard', 7, 0, 1, 12, 'hard')->>'rank')::int <> 1
    or (public.submit_arcade_win(v_tie, 'QATie', 7, 0, 1, 18, 'easy')->>'rank')::int <> 1 then
    raise exception 'Equal results must share a rank within their own difficulty';
  end if;
  if (select count(*) from public.arcade_wins where round_id = v_easy) <> 1 then
    raise exception 'A retry inserted another row';
  end if;
  begin
    perform public.submit_arcade_win(v_easy, 'QAEasy', 7, 0, 1, 10, 'hard');
    raise exception 'Retry changed difficulty';
  exception when invalid_parameter_value then null;
  end;
  v_result := public.get_arcade_leaderboard(v_easy, 'hard');
  if v_result->'ownEntry' <> 'null'::jsonb
    or exists (select 1 from jsonb_array_elements(v_result->'entries') e where (e->>'isOwn')::boolean) then
    raise exception 'Own result leaked into other difficulty';
  end if;
  perform public.submit_arcade_win(v_legacy, 'QALegacy', 7, 6, 86400000);
  if (select difficulty from public.arcade_wins where round_id = v_legacy) <> 'hard'
    or public.get_arcade_leaderboard(v_legacy) is distinct from public.get_arcade_leaderboard(v_legacy, 'hard') then
    raise exception 'Legacy requests must use hard';
  end if;
  foreach v_difficulty in array array['easy', 'hard'] loop
    v_result := public.submit_arcade_win(gen_random_uuid(), 'QARank', 7, 3, 60000, 9, v_difficulty);
    select 1 + count(*) into v_rank from public.arcade_wins
      where difficulty = v_difficulty and (computer_score < 3 or (computer_score = 3 and duration_ms < 60000));
    if (v_result->>'rank')::bigint <> v_rank then raise exception 'Rank includes another difficulty'; end if;
  end loop;
  for i in 1..11 loop
    perform public.submit_arcade_win(gen_random_uuid(), 'QAEasyTop' || i, 7, 0, 1000 + i, 5, 'easy');
  end loop;
  perform public.submit_arcade_win(v_own, 'QAEasyOwn', 7, 6, 86400000, 13, 'easy');
  v_result := public.get_arcade_leaderboard(v_own, 'easy');
  if jsonb_array_length(v_result->'entries') <> 10 or v_result->'ownEntry'->>'name' is distinct from 'QAEasyOwn'
    or (v_result->'ownEntry'->>'rank')::bigint <= 10 then
    raise exception 'Easy list must show top ten and the own result below it';
  end if;
  foreach v_difficulty in array array['medium', '', null] loop
    begin
      perform public.get_arcade_leaderboard(null, v_difficulty);
      raise exception 'Invalid list difficulty accepted';
    exception when invalid_parameter_value then null;
    end;
    begin
      perform public.submit_arcade_win(gen_random_uuid(), 'QABad', 7, 0, 100, 1, v_difficulty);
      raise exception 'Invalid save difficulty accepted';
    exception when invalid_parameter_value then null;
    end;
  end loop;
end;
$$;
set local role anon;
select public.get_arcade_leaderboard(null, 'easy') is not null as anonymous_easy_read;
select public.submit_arcade_win(gen_random_uuid(), 'QAEasyAnon', 7, 6, 120000, 8, 'easy')->>'rank' as anonymous_easy_save;
reset role;
rollback;
