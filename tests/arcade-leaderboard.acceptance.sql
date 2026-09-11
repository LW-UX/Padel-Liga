-- Run through tools/supabase-mcp.mjs only after approval. No fixtures survive rollback.
begin;
do $$
declare
  v_id uuid := gen_random_uuid();
  v_second uuid := gen_random_uuid();
  v_result jsonb;
  v_rank bigint;
  v_bad_name text;
  v_own uuid := gen_random_uuid();
  v_top uuid;
  v_tied uuid := gen_random_uuid();
  i integer;
begin
  if has_table_privilege('anon', 'public.arcade_wins', 'INSERT')
    or has_table_privilege('anon', 'public.arcade_wins', 'SELECT')
    or has_table_privilege('authenticated', 'public.arcade_wins', 'UPDATE')
    or has_table_privilege('authenticated', 'public.arcade_wins', 'DELETE') then
    raise exception 'Direct table access must be blocked';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.arcade_wins'::regclass) then
    raise exception 'RLS must be enabled';
  end if;
  perform public.submit_arcade_win(v_id, ' QASieg ', 7, 2, 60000);
  perform public.submit_arcade_win(v_id, 'QASieg', 7, 2, 60000);
  if (select count(*) from public.arcade_wins where round_id = v_id) <> 1 then
    raise exception 'Retry duplicated the result';
  end if;
  if (select display_name from public.arcade_wins where round_id = v_id) <> 'QASieg' then
    raise exception 'Name was not trimmed';
  end if;
  begin
    perform public.submit_arcade_win(v_second, 'QAVerlust', 4, 7, 60000);
    raise exception 'Loss was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.submit_arcade_win(v_second, '', 7, 0, 60000);
    raise exception 'Empty name was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.submit_arcade_win(v_second, 'QAZeit', 7, 0, 0);
    raise exception 'Invalid time was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.submit_arcade_win(v_id, 'QAManipulation', 7, 0, 100);
    raise exception 'Existing result was replaced';
  exception when invalid_parameter_value then null;
  end;
  foreach v_bad_name in array array['Name mit Leerzeichen', 'Ludi!', repeat('x', 17), 'HiTlEr', 'H1tler99', 'Hiiitler', 'Arschloch', 'Nazi123'] loop
    begin
      perform public.submit_arcade_win(gen_random_uuid(), v_bad_name, 7, 2, 60000);
      raise exception 'Forbidden name was accepted: %', v_bad_name;
    exception when invalid_parameter_value then null;
    end;
  end loop;
  perform public.submit_arcade_win(gen_random_uuid(), 'Jörg42', 7, 6, 60000);
  perform public.submit_arcade_win(gen_random_uuid(), 'Nazim', 7, 6, 60000);
  v_result := public.submit_arcade_win(v_second, 'QABesser', 7, 1, 90000);
  select 1 + count(*) into v_rank from public.arcade_wins
    where computer_score < 1 or (computer_score = 1 and duration_ms < 90000);
  if (v_result->>'rank')::bigint <> v_rank then raise exception 'Wrong rank'; end if;
  if (public.submit_arcade_win(v_id, 'QASieg', 7, 2, 60000)->>'rank')::bigint <= v_rank then
    raise exception 'Score must precede time';
  end if;
  for i in 1..9 loop
    perform public.submit_arcade_win(gen_random_uuid(), 'QATop' || i, 7, 0, 1000 + i);
  end loop;
  perform public.submit_arcade_win(v_own, 'QAEigen', 7, 6, 86400000);
  v_result := public.get_arcade_leaderboard(v_own);
  if jsonb_array_length(v_result->'entries') <> 8 or v_result->'ownEntry'->>'name' <> 'QAEigen'
    or (v_result->'ownEntry'->>'rank')::bigint <= 8 then
    raise exception 'Own result outside top eight is missing';
  end if;
  select round_id into v_top from public.arcade_wins order by computer_score, duration_ms, created_at, round_id limit 1;
  v_result := public.get_arcade_leaderboard(v_top);
  if v_result->'ownEntry' <> 'null'::jsonb or not (v_result->'entries'->0->>'isOwn')::boolean then
    raise exception 'Top eight own result must be marked without duplicate';
  end if;
  v_result := public.get_arcade_leaderboard(gen_random_uuid());
  if v_result->'ownEntry' <> 'null'::jsonb then raise exception 'Unknown round has an own result'; end if;
  -- Even a tied rank of 1 belongs below the table when the exact round is outside its eight rows.
  for i in 1..9 loop
    perform public.submit_arcade_win(gen_random_uuid(), 'QAGleich' || i, 7, 0, 1);
  end loop;
  perform public.submit_arcade_win(v_tied, 'QAGleichEigen', 7, 0, 1);
  update public.arcade_wins set created_at = clock_timestamp() + interval '1 day' where round_id = v_tied;
  v_result := public.get_arcade_leaderboard(v_tied);
  if v_result->'ownEntry'->>'name' is distinct from 'QAGleichEigen'
    or (v_result->'ownEntry'->>'rank')::bigint is distinct from 1::bigint then
    raise exception 'Tied own result outside eight rows is missing';
  end if;
  v_result := public.get_arcade_leaderboard();
  if jsonb_array_length(v_result->'entries') > 8 then raise exception 'Top eight exceeds limit'; end if;
  if (v_result->'entries'->0) ? 'round_id' then raise exception 'Round token is public'; end if;
end;
$$;
set local role anon;
select public.get_arcade_leaderboard() is not null as anonymous_read_works;
select public.submit_arcade_win(gen_random_uuid(), 'QAAnonym', 7, 6, 120000)->>'rank' as anonymous_write_rank;
reset role;
rollback;
