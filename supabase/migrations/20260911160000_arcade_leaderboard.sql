begin;

-- Private, maintainable list; short ambiguous words require a full-name match.
create table public.arcade_name_blocklist (
  term text primary key check (char_length(term) >= 3),
  match_mode text not null check (match_mode in ('contains', 'exact'))
);
alter table public.arcade_name_blocklist enable row level security;
revoke all on public.arcade_name_blocklist from public, anon, authenticated;
insert into public.arcade_name_blocklist (term, match_mode) values
  ('arschloch', 'contains'),
  ('hurensohn', 'contains'),
  ('hurenkind', 'contains'),
  ('fotze', 'contains'),
  ('wichser', 'contains'),
  ('missgeburt', 'contains'),
  ('schlampe', 'contains'),
  ('drecksau', 'contains'),
  ('scheisse', 'contains'),
  ('motherfucker', 'contains'),
  ('fuck', 'contains'),
  ('bitch', 'contains'),
  ('nigger', 'contains'),
  ('neger', 'exact'),
  ('kanake', 'contains'),
  ('schwuchtel', 'contains'),
  ('faggot', 'contains'),
  ('judensau', 'contains'),
  ('heilhitler', 'contains'),
  ('siegheil', 'contains'),
  ('hitler', 'contains'),
  ('goebbels', 'contains'),
  ('himmler', 'contains'),
  ('hermanngoering', 'contains'),
  ('hermanngoring', 'contains'),
  ('rudolfhess', 'contains'),
  ('josefmengele', 'contains'),
  ('josephmengele', 'contains'),
  ('adolfeichmann', 'contains'),
  ('arsch', 'exact'),
  ('idiot', 'exact'),
  ('nazi', 'exact');

create function public.arcade_name_key(p_name text)
returns text language sql immutable strict set search_path = '' as $$
  select regexp_replace(
    translate(replace(lower(p_name), 'ß', 'ss'),
      'äöü0134578', 'aouoieastb'),
    '(.)\1+', '\1', 'g');
$$;
revoke all on function public.arcade_name_key(text) from public, anon, authenticated;

-- Arcade results are separate from league players, matches and Elo.
create table public.arcade_wins (
  round_id uuid primary key,
  display_name text not null check (char_length(display_name) between 1 and 16 and display_name = btrim(display_name) and display_name ~ '^[[:alpha:][:digit:]]+$'),
  human_score smallint not null check (human_score = 7),
  computer_score smallint not null check (computer_score between 0 and 6),
  duration_ms integer not null check (duration_ms between 1 and 86400000),
  created_at timestamptz not null default now()
);
create index arcade_wins_ranking on public.arcade_wins (computer_score, duration_ms, created_at, round_id);
alter table public.arcade_wins enable row level security;
revoke all on public.arcade_wins from public, anon, authenticated;

create function public.get_arcade_leaderboard(p_round_id uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  with ranked as materialized (
    select display_name, computer_score, duration_ms, created_at, round_id,
      rank() over (order by computer_score, duration_ms) as place
    from public.arcade_wins
  ), visible as (
    select * from ranked order by computer_score, duration_ms, created_at, round_id limit 8
  )
  select jsonb_build_object(
    'entries', coalesce((select jsonb_agg(jsonb_build_object('rank', place, 'name', display_name,
      'computerScore', computer_score, 'durationMs', duration_ms, 'isOwn', coalesce(round_id = p_round_id, false))
      order by computer_score, duration_ms, created_at, round_id) from visible), '[]'::jsonb),
    'ownEntry', (select jsonb_build_object('rank', place, 'name', display_name,
      'computerScore', computer_score, 'durationMs', duration_ms, 'isOwn', true)
      from ranked where round_id = p_round_id
        and not exists (select 1 from visible where round_id = p_round_id))
  );
$$;

create function public.submit_arcade_win(p_round_id uuid, p_name text, p_human_score integer, p_computer_score integer, p_duration_ms integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_name text := normalize(btrim(p_name));
  v_name_key text;
  v_existing public.arcade_wins%rowtype;
  v_rank bigint;
begin
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
    or p_duration_ms is null or p_duration_ms not between 1 and 86400000 then
    raise exception 'Ungültiger Arcade-Sieg.' using errcode = '22023';
  end if;
  insert into public.arcade_wins (round_id, display_name, human_score, computer_score, duration_ms)
    values (p_round_id, v_name, p_human_score, p_computer_score, p_duration_ms)
    on conflict (round_id) do nothing;
  select * into strict v_existing from public.arcade_wins where round_id = p_round_id;
  -- The round UUID makes retries idempotent and never permits replacing a score.
  if v_existing.computer_score <> p_computer_score or v_existing.duration_ms <> p_duration_ms then
    raise exception 'Diese Partie wurde bereits eingetragen.' using errcode = '22023';
  end if;
  select 1 + count(*) into v_rank from public.arcade_wins
    where computer_score < p_computer_score or (computer_score = p_computer_score and duration_ms < p_duration_ms);
  return jsonb_build_object('rank', v_rank);
end;
$$;
revoke all on function public.get_arcade_leaderboard(uuid) from public;
revoke all on function public.submit_arcade_win(uuid, text, integer, integer, integer) from public;
grant execute on function public.get_arcade_leaderboard(uuid) to anon, authenticated;
grant execute on function public.submit_arcade_win(uuid, text, integer, integer, integer) to anon, authenticated;

commit;
