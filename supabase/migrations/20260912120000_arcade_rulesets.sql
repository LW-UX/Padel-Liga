begin;

-- Archive by version in place: no rows, timestamps or round IDs are replaced.
alter table public.arcade_wins add column ruleset text not null default 'classic'
  check (ruleset in ('classic', 'v2'));
comment on column public.arcade_wins.ruleset is 'Classic is the frozen pre-v2 archive; v2 uses glass/fence rules and short shots.';
drop index public.arcade_wins_ranking;
create index arcade_wins_ranking on public.arcade_wins
  (ruleset, difficulty, computer_score, duration_ms, created_at, round_id);

-- Replace rather than overload: PostgREST must resolve old and new payloads unambiguously.
drop function public.get_arcade_leaderboard(uuid, text);
drop function public.submit_arcade_win(uuid, text, integer, integer, integer, integer, text);

create function public.get_arcade_leaderboard(p_round_id uuid default null, p_difficulty text default 'hard', p_ruleset text default 'classic')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_ruleset is null or p_ruleset not in ('classic', 'v2') then
    raise exception 'Ungültige Spielversion.' using errcode = '22023';
  end if;
  if p_difficulty is null or p_difficulty not in ('easy', 'hard') then
    raise exception 'Ungültige Schwierigkeitsstufe.' using errcode = '22023';
  end if;
  return (with ranked as materialized (
    select display_name, computer_score, duration_ms, created_at, round_id, best_rally,
      rank() over (order by computer_score, duration_ms) as place
    from public.arcade_wins where ruleset = p_ruleset and difficulty = p_difficulty
  ), visible as (
    select * from ranked order by computer_score, duration_ms, created_at, round_id limit 8
  )
  select jsonb_build_object(
    'ruleset', p_ruleset, 'difficulty', p_difficulty,
    'entries', coalesce((select jsonb_agg(jsonb_build_object('rank', place, 'name', display_name,
      'computerScore', computer_score, 'durationMs', duration_ms, 'createdAt', created_at, 'bestRally', best_rally, 'isOwn', coalesce(round_id = p_round_id, false))
      order by computer_score, duration_ms, created_at, round_id) from visible), '[]'::jsonb),
    'ownEntry', (select jsonb_build_object('rank', place, 'name', display_name,
      'computerScore', computer_score, 'durationMs', duration_ms, 'createdAt', created_at, 'bestRally', best_rally, 'isOwn', true)
      from ranked where round_id = p_round_id
        and not exists (select 1 from visible where round_id = p_round_id))
  ));
end;
$$;

create function public.submit_arcade_win(p_round_id uuid, p_name text, p_human_score integer, p_computer_score integer, p_duration_ms integer, p_best_rally integer default null, p_difficulty text default 'hard', p_ruleset text default 'classic')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_name text := normalize(btrim(p_name));
  v_name_key text;
  v_existing public.arcade_wins%rowtype;
  v_rank bigint;
begin
  if p_ruleset is null or p_ruleset not in ('classic', 'v2') then
    raise exception 'Ungültige Spielversion.' using errcode = '22023';
  end if;
  if p_difficulty is null or p_difficulty not in ('easy', 'hard') then
    raise exception 'Ungültige Schwierigkeitsstufe.' using errcode = '22023';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 16 or v_name !~ '^[[:alpha:][:digit:]]+$' then
    raise exception 'ARCADE_NAME_INVALID' using errcode = '22023';
  end if;
  v_name_key := public.arcade_name_key(v_name);
  if exists (select 1 from public.arcade_name_blocklist
    where (match_mode = 'exact' and (v_name_key = public.arcade_name_key(term)
      or public.arcade_name_key(regexp_replace(v_name, '^[0-9]+|[0-9]+$', '', 'g')) = public.arcade_name_key(term)))
       or (match_mode = 'contains' and strpos(v_name_key, public.arcade_name_key(term)) > 0)) then
    raise exception 'ARCADE_NAME_BLOCKED' using errcode = '22023';
  end if;
  if p_round_id is null or p_human_score is distinct from 7
    or p_computer_score is null or p_computer_score not between 0 and 6
    or p_duration_ms is null or p_duration_ms not between 1 and 86400000
    or p_best_rally < 0 then
    raise exception 'Ungültiger Arcade-Sieg.' using errcode = '22023';
  end if;
  if p_ruleset = 'classic' then
    -- A retry may confirm a frozen result, but can never insert into the archive.
    select * into v_existing from public.arcade_wins where round_id = p_round_id;
    if not found then
      raise exception 'ARCADE_RULESET_CLOSED' using errcode = '22023';
    end if;
  else
    insert into public.arcade_wins (round_id, display_name, human_score, computer_score, duration_ms, best_rally, difficulty, ruleset)
      values (p_round_id, v_name, p_human_score, p_computer_score, p_duration_ms, p_best_rally, p_difficulty, p_ruleset)
      on conflict (round_id) do nothing;
    select * into strict v_existing from public.arcade_wins where round_id = p_round_id;
  end if;
  -- The round UUID makes retries idempotent and never permits replacing a score.
  if v_existing.computer_score <> p_computer_score or v_existing.duration_ms <> p_duration_ms
    or v_existing.best_rally is distinct from p_best_rally
    or v_existing.difficulty is distinct from p_difficulty
    or v_existing.ruleset is distinct from p_ruleset then
    raise exception 'Diese Partie wurde bereits eingetragen.' using errcode = '22023';
  end if;
  select 1 + count(*) into v_rank from public.arcade_wins
    where ruleset = p_ruleset and difficulty = p_difficulty
      and (computer_score < p_computer_score or (computer_score = p_computer_score and duration_ms < p_duration_ms));
  return jsonb_build_object('rank', v_rank, 'difficulty', p_difficulty, 'ruleset', p_ruleset);
end;
$$;
revoke all on function public.get_arcade_leaderboard(uuid, text, text) from public;
revoke all on function public.submit_arcade_win(uuid, text, integer, integer, integer, integer, text, text) from public;
grant execute on function public.get_arcade_leaderboard(uuid, text, text) to anon, authenticated;
grant execute on function public.submit_arcade_win(uuid, text, integer, integer, integer, integer, text, text) to anon, authenticated;

-- Even privileged accidental writes cannot change the Classic snapshot.
create function public.guard_arcade_ruleset()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op <> 'INSERT' and old.ruleset = 'classic' then
    raise exception 'ARCADE_RULESET_CLOSED' using errcode = '22023';
  end if;
  if tg_op <> 'DELETE' then
    if new.ruleset = 'classic' then
      raise exception 'ARCADE_RULESET_CLOSED' using errcode = '22023';
    end if;
    if tg_op = 'UPDATE' and new.ruleset is distinct from old.ruleset then
      raise exception 'Die Spielversion einer Partie ist unveränderlich.' using errcode = '22023';
    end if;
    return new;
  end if;
  return old;
end;
$$;
revoke all on function public.guard_arcade_ruleset() from public, anon, authenticated;
create trigger arcade_ruleset_guard before insert or update or delete on public.arcade_wins
  for each row execute function public.guard_arcade_ruleset();

commit;
