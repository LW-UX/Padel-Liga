-- Only the project MCP helper may execute this on Supabase, after explicit approval.
-- Prefer tools/check-arcade-rulesets.mjs against an isolated local database.
begin;
do $$
declare
  v_easy uuid := gen_random_uuid();
  v_hard uuid := gen_random_uuid();
  v_own uuid := gen_random_uuid();
  v_result jsonb;
  v_before jsonb := public.get_arcade_leaderboard(null, 'hard', 'classic');
  v_ruleset text;
  i integer;
begin
  perform public.submit_arcade_win(v_easy, 'QAEasy', 7, 0, 1, 10, 'easy', 'v2');
  perform public.submit_arcade_win(v_hard, 'QAHard', 7, 0, 1, 10, 'hard', 'v2');
  if public.get_arcade_leaderboard(null, 'hard', 'classic') is distinct from v_before then
    raise exception 'V2 changes Classic';
  end if;
  if (public.submit_arcade_win(v_easy, 'QAEasy', 7, 0, 1, 10, 'easy', 'v2')->>'rank')::int <> 1
    or (public.submit_arcade_win(v_hard, 'QAHard', 7, 0, 1, 10, 'hard', 'v2')->>'rank')::int <> 1 then
    raise exception 'Difficulty/ruleset ranks not isolated';
  end if;
  if (select count(*) from public.arcade_wins where round_id = v_easy) <> 1 then
    raise exception 'Retry inserted another row';
  end if;
  v_result := public.submit_arcade_win(gen_random_uuid(), 'QATie', 7, 0, 1, 90, 'easy', 'v2');
  if (v_result->>'rank')::int <> 1 then raise exception 'Equal results do not share rank'; end if;
  for i in 1..3 loop
    begin
      if i = 1 then
        perform public.submit_arcade_win(v_easy, 'QAEasy', 7, 0, 1, 10, 'hard', 'v2');
      elsif i = 2 then
        perform public.submit_arcade_win(v_easy, 'QAEasy', 7, 0, 1, 10, 'easy', 'classic');
      else
        perform public.submit_arcade_win(v_easy, 'QAEasy', 7, 0, 2, 10, 'easy', 'v2');
      end if;
      raise exception 'Retry changed difficulty, version or score';
    exception when invalid_parameter_value then null;
    end;
  end loop;
  begin
    perform public.submit_arcade_win(gen_random_uuid(), 'QALegacy', 7, 6, 60000);
    raise exception 'Unversioned old client inserted into Classic';
  exception when invalid_parameter_value then
    if sqlerrm <> 'ARCADE_RULESET_CLOSED' then raise; end if;
  end;
  foreach v_ruleset in array array['invalid', '', null] loop
    begin
      perform public.get_arcade_leaderboard(null, 'hard', v_ruleset);
      raise exception 'Invalid list version accepted';
    exception when invalid_parameter_value then null;
    end;
    begin
      perform public.submit_arcade_win(gen_random_uuid(), 'QABad', 7, 0, 100, 1, 'hard', v_ruleset);
      raise exception 'Invalid save version accepted';
    exception when invalid_parameter_value then null;
    end;
  end loop;
  for i in 1..9 loop
    perform public.submit_arcade_win(gen_random_uuid(), 'QATop' || i, 7, 0, 1000 + i, 5, 'easy', 'v2');
  end loop;
  perform public.submit_arcade_win(v_own, 'QAOwn', 7, 6, 86400000, 13, 'easy', 'v2');
  v_result := public.get_arcade_leaderboard(v_own, 'easy', 'v2');
  if jsonb_array_length(v_result->'entries') <> 8 or v_result->'ownEntry'->>'name' is distinct from 'QAOwn'
    or (v_result->'ownEntry'->>'rank')::bigint <= 8 then
    raise exception 'V2 must show top eight and own entry';
  end if;
  v_result := public.get_arcade_leaderboard(v_own, 'hard', 'v2');
  if v_result->'ownEntry' <> 'null'::jsonb or exists (
    select 1 from jsonb_array_elements(v_result->'entries') e where (e->>'isOwn')::boolean
  ) then raise exception 'Own result leaked into other difficulty'; end if;
  if public.get_arcade_leaderboard(null) is distinct from public.get_arcade_leaderboard(null, 'hard', 'classic') then
    raise exception 'Old list defaults no longer read Classic';
  end if;
end;
$$;
set local role anon;
select public.get_arcade_leaderboard(null, 'easy', 'v2');
select public.submit_arcade_win(gen_random_uuid(), 'QAAnon', 7, 6, 120000, 8, 'easy', 'v2');
do $$
begin
  begin
    insert into public.arcade_wins (round_id, display_name, human_score, computer_score, duration_ms, ruleset)
      values (gen_random_uuid(), 'QABypass', 7, 0, 100, 'v2');
    raise exception 'Anonymous direct insert allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
rollback;
