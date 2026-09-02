begin;

alter table public.seasons
  add column if not exists tournament_mode text not null default 'none',
  add column if not exists qualification_places smallint not null default 0,
  add column if not exists home_ranking_limit smallint not null default 4,
  add column if not exists regular_schedule_locked boolean not null default false,
  add column if not exists predictions_enabled boolean not null default true;

alter table public.seasons drop constraint if exists seasons_tournament_mode_check;
alter table public.seasons add constraint seasons_tournament_mode_check
  check (tournament_mode in ('none', 'direct_final_four', 'top8_semifinals'));
alter table public.seasons drop constraint if exists seasons_qualification_places_check;
alter table public.seasons add constraint seasons_qualification_places_check
  check (qualification_places between 0 and 32);
alter table public.seasons drop constraint if exists seasons_home_ranking_limit_check;
alter table public.seasons add constraint seasons_home_ranking_limit_check
  check (home_ranking_limit between 1 and 32);

update public.seasons
set
  tournament_mode = 'direct_final_four',
  qualification_places = 4,
  home_ranking_limit = 4,
  regular_schedule_locked = true,
  predictions_enabled = false,
  results_entry_enabled = true,
  is_active = true
where id = '2026';

update public.seasons
set
  tournament_mode = 'top8_semifinals',
  qualification_places = 8,
  home_ranking_limit = 4,
  regular_schedule_locked = false,
  predictions_enabled = true,
  is_active = false
where id = 'winter-2026';

update public.seasons
set
  tournament_mode = 'none',
  qualification_places = 0,
  home_ranking_limit = 4,
  regular_schedule_locked = false,
  predictions_enabled = true,
  is_active = false
where id = 'test-2026';

update public.seasons
set is_active = false
where id not in ('2026') and is_active;

delete from public.player_achievements
where season_id = '2026'
  and kind in ('final_four', 'winner');

alter table public.matches
  add column if not exists competition_stage text not null default 'league';

alter table public.matches drop constraint if exists matches_competition_stage_check;
alter table public.matches add constraint matches_competition_stage_check
  check (competition_stage in ('league', 'semifinal', 'final_four'));

update public.matches
set competition_stage = case
  when match_type = 'final' then 'final_four'
  else 'league'
end;

create table if not exists public.season_tournament_players (
  season_id text not null references public.seasons(id) on delete cascade,
  stage text not null check (stage in ('semifinal', 'final_four')),
  seed smallint not null check (seed > 0),
  player_id text not null references public.players(id) on delete restrict,
  league_rank smallint not null check (league_rank > 0),
  qualified_from_match_id text references public.matches(id) on delete restrict,
  qualified_at timestamptz not null default now(),
  primary key (season_id, stage, seed),
  unique (season_id, stage, player_id)
);

alter table public.season_tournament_players enable row level security;
drop policy if exists "Tournament players are public" on public.season_tournament_players;
create policy "Tournament players are public"
  on public.season_tournament_players for select to anon, authenticated using (true);
revoke all on public.season_tournament_players from anon, authenticated;
grant select on public.season_tournament_players to anon, authenticated;

insert into public.matches as existing (
  id, season_id, league_id, matchday, match_type, competition_stage, format,
  scheduled_date, display_time, lock_at, display_label,
  counts_for_ranking, counts_for_elo,
  team_one_label, team_two_label, result_details, actual_sets, winner,
  betting_open, team_one_qualifier_ranks, team_two_qualifier_ranks
) values
  (
    'winter-2026-semifinal-1', 'winter-2026', 'main', 1, 'final', 'semifinal', 'best-of-three',
    null, null, null, 'Halbfinale 1', false, true,
    'Platz 1 / Platz 2', 'Platz 7 / Platz 8', null, null, null,
    false, array[1,2], array[7,8]
  ),
  (
    'winter-2026-semifinal-2', 'winter-2026', 'main', 1, 'final', 'semifinal', 'best-of-three',
    null, null, null, 'Halbfinale 2', false, true,
    'Platz 3 / Platz 4', 'Platz 5 / Platz 6', null, null, null,
    false, array[3,4], array[5,6]
  ),
  (
    'winter-2026-final-1', 'winter-2026', 'main', 2, 'final', 'final_four', 'single-set',
    null, null, null, 'Final 1', false, true,
    'Finalist 1 / Finalist 2', 'Finalist 3 / Finalist 4', null, null, null,
    false, array[1,2], array[3,4]
  ),
  (
    'winter-2026-final-2', 'winter-2026', 'main', 2, 'final', 'final_four', 'single-set',
    null, null, null, 'Final 2', false, true,
    'Finalist 1 / Finalist 4', 'Finalist 2 / Finalist 3', null, null, null,
    false, array[1,4], array[2,3]
  ),
  (
    'winter-2026-final-3', 'winter-2026', 'main', 2, 'final', 'final_four', 'single-set',
    null, null, null, 'Final 3', false, true,
    'Finalist 1 / Finalist 3', 'Finalist 2 / Finalist 4', null, null, null,
    false, array[1,3], array[2,4]
  )
on conflict (id) do update set
  competition_stage = excluded.competition_stage,
  format = excluded.format,
  display_label = excluded.display_label,
  counts_for_ranking = excluded.counts_for_ranking,
  counts_for_elo = excluded.counts_for_elo,
  betting_open = existing.betting_open,
  team_one_qualifier_ranks = excluded.team_one_qualifier_ranks,
  team_two_qualifier_ranks = excluded.team_two_qualifier_ranks;

create or replace function private.derive_official_result(p_result_details text)
returns table (actual_sets text, winner smallint)
language plpgsql
immutable
set search_path = ''
as $$
declare
  score text[];
  score_count integer := 0;
  team_one_sets integer := 0;
  team_two_sets integer := 0;
begin
  for score in
    select regexp_matches(coalesce(p_result_details, ''), '([0-9]+)\s*:\s*([0-9]+)', 'g')
  loop
    score_count := score_count + 1;
    if score[1]::integer = score[2]::integer then
      raise exception 'Ein Satz benötigt einen eindeutigen Sieger.';
    elsif score[1]::integer > score[2]::integer then
      team_one_sets := team_one_sets + 1;
    else
      team_two_sets := team_two_sets + 1;
    end if;
  end loop;

  if score_count = 1 then
    actual_sets := team_one_sets::text || ':' || team_two_sets::text;
    winner := case when team_one_sets = 1 then 1 else 2 end;
    return next;
    return;
  end if;

  if score_count not between 2 and 3 then
    raise exception 'Bitte zwei Sätze und bei 1:1 eine Entscheidung eingeben.';
  end if;
  if greatest(team_one_sets, team_two_sets) <> 2 then
    raise exception 'Das Ergebnis benötigt zwei gewonnene Sätze für ein Team.';
  end if;
  if score_count = 3 and least(team_one_sets, team_two_sets) <> 1 then
    raise exception 'Nach einem 2:0 ist keine Entscheidung mehr nötig.';
  end if;

  actual_sets := team_one_sets::text || ':' || team_two_sets::text;
  winner := case when team_one_sets = 2 then 1 else 2 end;
  return next;
end;
$$;

create or replace function private.validate_official_result(
  p_result_details text,
  p_actual_sets text,
  p_winner smallint
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  derived_sets text;
  derived_winner smallint;
begin
  select result.actual_sets, result.winner
  into derived_sets, derived_winner
  from private.derive_official_result(p_result_details) as result;

  if p_actual_sets is distinct from derived_sets or p_winner is distinct from derived_winner then
    raise exception 'Satzergebnis und Sieger passen nicht zu den eingegebenen Ergebnissen.';
  end if;
end;
$$;

create or replace function private.validate_result_for_format(
  p_format text,
  p_result_details text,
  p_actual_sets text,
  p_winner smallint
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  score_count integer;
  team_one_games integer;
  team_two_games integer;
begin
  perform private.validate_official_result(p_result_details, p_actual_sets, p_winner);
  select count(*) into score_count
  from regexp_matches(coalesce(p_result_details, ''), '([0-9]+)\s*:\s*([0-9]+)', 'g');

  if p_format = 'single-set' and (score_count <> 1 or p_actual_sets not in ('1:0', '0:1')) then
    raise exception 'Eine Ein-Satz-Partie benötigt genau einen eindeutigen Satz.';
  end if;
  if p_format = 'single-set' then
    select (score.capture)[1]::integer, (score.capture)[2]::integer
    into team_one_games, team_two_games
    from regexp_matches(p_result_details, '([0-9]+)\s*:\s*([0-9]+)', 'g') as score(capture)
    limit 1;
    if not (
      (team_one_games = 6 and team_two_games between 0 and 4)
      or (team_two_games = 6 and team_one_games between 0 and 4)
      or (team_one_games = 7 and team_two_games in (5, 6))
      or (team_two_games = 7 and team_one_games in (5, 6))
    ) then
      raise exception 'Ungültiger Satzendstand.';
    end if;
  end if;
  if p_format <> 'single-set' and (score_count not between 2 and 3 or p_actual_sets not in ('2:0', '2:1', '1:2', '0:2')) then
    raise exception 'Diese Partie benötigt zwei Gewinnsätze.';
  end if;
end;
$$;

alter table public.result_proposals drop constraint if exists result_proposals_actual_sets_check;
alter table public.result_proposals add constraint result_proposals_actual_sets_check
  check (actual_sets in ('2:0', '2:1', '1:2', '0:2', '1:0', '0:1'));
alter table public.result_proposals drop constraint if exists result_proposals_check;
alter table public.result_proposals add constraint result_proposals_check
  check (
    (actual_sets in ('2:0', '2:1', '1:0') and winner = 1)
    or (actual_sets in ('1:2', '0:2', '0:1') and winner = 2)
  );

create or replace function private.validate_match_result_format()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.actual_sets is not null and (
    tg_op = 'INSERT'
    or new.format is distinct from old.format
    or new.actual_sets is distinct from old.actual_sets
    or new.result_details is distinct from old.result_details
    or new.winner is distinct from old.winner
  ) then
    perform private.validate_result_for_format(new.format, new.result_details, new.actual_sets, new.winner);
  end if;
  return new;
end;
$$;

drop trigger if exists matches_validate_result_format on public.matches;
create trigger matches_validate_result_format
before insert or update of format, result_details, actual_sets, winner on public.matches
for each row execute function private.validate_match_result_format();

create or replace function private.sync_tournament_betting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_mode text;
  assigned_players integer;
begin
  if new.competition_stage = 'league' then return new; end if;

  select season.tournament_mode into selected_mode
  from public.seasons as season
  where season.id = new.season_id;
  select count(*) into assigned_players
  from public.match_players as member
  where member.match_id = new.id;

  new.betting_open := selected_mode = 'top8_semifinals'
    and assigned_players = 4
    and new.scheduled_date is not null
    and nullif(trim(new.display_time), '') is not null
    and new.lock_at is not null
    and new.actual_sets is null;
  return new;
end;
$$;

drop trigger if exists matches_sync_tournament_betting on public.matches;
create trigger matches_sync_tournament_betting
before insert or update on public.matches
for each row execute function private.sync_tournament_betting();

drop policy if exists "Users create open predictions" on public.predictions;
create policy "Users create open predictions" on public.predictions for insert to authenticated
with check (
  (select auth.uid()) is not null
  and (select auth.uid()) = user_id
  and exists (
    select 1 from public.matches as match
    join public.seasons as season on season.id = match.season_id and season.predictions_enabled
    where match.id = match_id
      and match.betting_open
      and match.actual_sets is null
      and (match.lock_at is null or match.lock_at > now())
      and (
        match.competition_stage = 'league'
        or (
          match.scheduled_date is not null
          and nullif(trim(match.display_time), '') is not null
          and match.lock_at is not null
          and (select count(*) from public.match_players as member where member.match_id = match.id) = 4
        )
      )
  )
);

drop policy if exists "Users update open predictions" on public.predictions;
create policy "Users update open predictions" on public.predictions for update to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.uid()) = user_id
  and exists (
    select 1 from public.matches as match
    join public.seasons as season on season.id = match.season_id and season.predictions_enabled
    where match.id = match_id
      and match.betting_open
      and match.actual_sets is null
      and (match.lock_at is null or match.lock_at > now())
  )
)
with check (
  (select auth.uid()) is not null
  and (select auth.uid()) = user_id
  and exists (
    select 1 from public.matches as match
    join public.seasons as season on season.id = match.season_id and season.predictions_enabled
    where match.id = match_id
      and match.betting_open
      and match.actual_sets is null
      and (match.lock_at is null or match.lock_at > now())
      and (
        match.competition_stage = 'league'
        or (
          match.scheduled_date is not null
          and nullif(trim(match.display_time), '') is not null
          and match.lock_at is not null
          and (select count(*) from public.match_players as member where member.match_id = match.id) = 4
        )
      )
  )
);

create or replace function private.validate_result_proposal_format()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_format text;
begin
  select match.format into selected_format
  from public.matches as match
  where match.id = new.match_id;
  perform private.validate_result_for_format(selected_format, new.result_details, new.actual_sets, new.winner);
  return new;
end;
$$;

drop trigger if exists result_proposals_validate_format on public.result_proposals;
create trigger result_proposals_validate_format
before insert or update of result_details, actual_sets, winner on public.result_proposals
for each row execute function private.validate_result_proposal_format();

create or replace function private.populate_tournament_stage(
  p_season_id text,
  p_match_stage text,
  p_player_stage text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_match record;
  expected_players integer;
  available_players integer;
  existing_players integer;
begin
  for target_match in
    select match.*
    from public.matches as match
    where match.season_id = p_season_id
      and match.competition_stage = p_match_stage
    order by match.id
    for update
  loop
    expected_players := cardinality(target_match.team_one_qualifier_ranks)
      + cardinality(target_match.team_two_qualifier_ranks);
    select count(*) into available_players
    from (
      select qualifier.seed
      from unnest(target_match.team_one_qualifier_ranks || target_match.team_two_qualifier_ranks) as wanted(seed)
      join public.season_tournament_players as qualifier
        on qualifier.season_id = p_season_id
       and qualifier.stage = p_player_stage
       and qualifier.seed = wanted.seed
    ) as resolved;
    if available_players <> expected_players then
      raise exception 'Für % konnten nicht alle Turnierplätze aufgelöst werden.', target_match.id;
    end if;

    select count(*) into existing_players
    from public.match_players as member
    where member.match_id = target_match.id;
    if existing_players = expected_players then
      continue;
    end if;
    if existing_players > 0 and (
      target_match.actual_sets is not null
      or exists (select 1 from public.result_proposals as proposal where proposal.match_id = target_match.id)
      or exists (select 1 from public.predictions as prediction where prediction.match_id = target_match.id)
    ) then
      raise exception 'Die bereits begonnene Partie % darf nicht neu besetzt werden.', target_match.id;
    end if;

    delete from public.match_players where match_id = target_match.id;
    insert into public.match_players (match_id, player_id, team, position)
    select target_match.id, qualifier.player_id, 1, wanted.ordinality::smallint
    from unnest(target_match.team_one_qualifier_ranks) with ordinality as wanted(seed, ordinality)
    join public.season_tournament_players as qualifier
      on qualifier.season_id = p_season_id
     and qualifier.stage = p_player_stage
     and qualifier.seed = wanted.seed;
    insert into public.match_players (match_id, player_id, team, position)
    select target_match.id, qualifier.player_id, 2, wanted.ordinality::smallint
    from unnest(target_match.team_two_qualifier_ranks) with ordinality as wanted(seed, ordinality)
    join public.season_tournament_players as qualifier
      on qualifier.season_id = p_season_id
     and qualifier.stage = p_player_stage
     and qualifier.seed = wanted.seed;

    update public.matches as match
    set
      team_one_label = (
        select string_agg(player.display_name, ' / ' order by member.position)
        from public.match_players as member
        join public.players as player on player.id = member.player_id
        where member.match_id = target_match.id and member.team = 1
      ),
      team_two_label = (
        select string_agg(player.display_name, ' / ' order by member.position)
        from public.match_players as member
        join public.players as player on player.id = member.player_id
        where member.match_id = target_match.id and member.team = 2
      ),
      updated_at = now()
    where match.id = target_match.id;
  end loop;
end;
$$;

create or replace function private.award_final_four_players(p_season_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.player_achievements (
    player_id, season_id, league_id, kind, title, subtitle, achieved_on, priority
  )
  select
    finalist.player_id,
    finalist.season_id,
    league.id,
    'final_four',
    'Final 4 Teilnehmer',
    'Padel-Liga ' || season.label,
    null,
    100
  from public.season_tournament_players as finalist
  join public.seasons as season on season.id = finalist.season_id
  join public.leagues as league on league.season_id = finalist.season_id and league.is_default
  where finalist.season_id = p_season_id
    and finalist.stage = 'final_four'
    and not exists (
      select 1 from public.player_achievements as achievement
      where achievement.player_id = finalist.player_id
        and achievement.season_id = finalist.season_id
        and achievement.league_id = league.id
        and achievement.kind = 'final_four'
    );
$$;

create or replace function private.award_tournament_winner(p_season_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  final_count integer;
  completed_count integer;
  winner_player_id text;
  default_league_id text;
  season_label text;
begin
  select count(*), count(*) filter (where match.actual_sets is not null and match.winner is not null)
  into final_count, completed_count
  from public.matches as match
  where match.season_id = p_season_id and match.competition_stage = 'final_four';
  if final_count <> 3 or completed_count <> 3 then return; end if;

  with finalist_stats as (
    select
      finalist.player_id,
      finalist.seed,
      count(*) filter (where match.winner = member.team)::integer as wins,
      coalesce(sum(case member.team when 1 then score.team_one - score.team_two else score.team_two - score.team_one end), 0)::integer as game_diff
    from public.season_tournament_players as finalist
    join public.match_players as member on member.player_id = finalist.player_id
    join public.matches as match
      on match.id = member.match_id
     and match.season_id = finalist.season_id
     and match.competition_stage = 'final_four'
    cross join lateral (
      select (score_parts.capture)[1]::integer as team_one, (score_parts.capture)[2]::integer as team_two
      from regexp_matches(match.result_details, '([0-9]+)\s*:\s*([0-9]+)', 'g') as score_parts(capture)
      limit 1
    ) as score
    where finalist.season_id = p_season_id and finalist.stage = 'final_four'
    group by finalist.player_id, finalist.seed
  ), best_base as (
    select * from finalist_stats
    where wins = (select max(wins) from finalist_stats)
      and game_diff = (select max(game_diff) from finalist_stats where wins = (select max(wins) from finalist_stats))
  ), ranked as (
    select
      candidate.*,
      (
        select count(distinct match.id)
        from public.match_players as member
        join public.matches as match on match.id = member.match_id and match.competition_stage = 'final_four'
        where member.player_id = candidate.player_id
          and match.season_id = p_season_id
          and match.winner = member.team
          and exists (
            select 1
            from public.match_players as opponent
            join best_base as tied on tied.player_id = opponent.player_id
            where opponent.match_id = match.id and opponent.team <> member.team
          )
      )::integer as head_to_head_wins
    from best_base as candidate
  )
  select ranked.player_id into winner_player_id
  from ranked
  order by ranked.head_to_head_wins desc, ranked.seed
  limit 1;

  if winner_player_id is null then return; end if;
  select league.id, season.label into default_league_id, season_label
  from public.seasons as season
  join public.leagues as league on league.season_id = season.id and league.is_default
  where season.id = p_season_id;

  insert into public.player_achievements (
    player_id, season_id, league_id, kind, title, subtitle, achieved_on, priority
  )
  select winner_player_id, p_season_id, default_league_id, 'winner', 'Gewinner',
    'Padel-Liga ' || season_label, null, 200
  where not exists (
    select 1 from public.player_achievements as achievement
    where achievement.player_id = winner_player_id
      and achievement.season_id = p_season_id
      and achievement.league_id = default_league_id
      and achievement.kind = 'winner'
  );
end;
$$;

create or replace function private.advance_season_tournament(p_season_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_season record;
  league_match_count integer;
  open_league_match_count integer;
  qualifier_count integer;
  semifinal_count integer;
  completed_semifinal_count integer;
begin
  select season.* into selected_season
  from public.seasons as season
  where season.id = p_season_id
  for update;
  if not found or selected_season.tournament_mode = 'none' then return; end if;

  select count(*), count(*) filter (where match.actual_sets is null or match.winner is null)
  into league_match_count, open_league_match_count
  from public.matches as match
  where match.season_id = p_season_id and match.competition_stage = 'league' and match.counts_for_ranking;

  if selected_season.regular_schedule_locked and league_match_count > 0 and open_league_match_count = 0 then
    if selected_season.tournament_mode = 'direct_final_four' then
      insert into public.season_tournament_players (season_id, stage, seed, player_id, league_rank)
      select p_season_id, 'final_four', stats.rank, stats.player_id, stats.rank
      from private.season_player_statistics as stats
      where stats.season_id = p_season_id
        and stats.league_id = (
          select league.id from public.leagues as league
          where league.season_id = p_season_id and league.is_default
          order by league.id limit 1
        )
        and stats.rank <= selected_season.qualification_places
      on conflict (season_id, stage, seed) do nothing;

      select count(*) into qualifier_count
      from public.season_tournament_players
      where season_id = p_season_id and stage = 'final_four';
      if qualifier_count <> selected_season.qualification_places then
        raise exception 'Die Final-Four-Qualifikation für % ist unvollständig.', p_season_id;
      end if;
      perform private.populate_tournament_stage(p_season_id, 'final_four', 'final_four');
      perform private.award_final_four_players(p_season_id);
    elsif selected_season.tournament_mode = 'top8_semifinals' then
      insert into public.season_tournament_players (season_id, stage, seed, player_id, league_rank)
      select p_season_id, 'semifinal', stats.rank, stats.player_id, stats.rank
      from private.season_player_statistics as stats
      where stats.season_id = p_season_id
        and stats.league_id = (
          select league.id from public.leagues as league
          where league.season_id = p_season_id and league.is_default
          order by league.id limit 1
        )
        and stats.rank <= selected_season.qualification_places
      on conflict (season_id, stage, seed) do nothing;

      select count(*) into qualifier_count
      from public.season_tournament_players
      where season_id = p_season_id and stage = 'semifinal';
      if qualifier_count <> selected_season.qualification_places then
        raise exception 'Die Halbfinal-Qualifikation für % ist unvollständig.', p_season_id;
      end if;
      perform private.populate_tournament_stage(p_season_id, 'semifinal', 'semifinal');
    end if;
  end if;

  if selected_season.tournament_mode = 'top8_semifinals' then
    select count(*), count(*) filter (where match.actual_sets is not null and match.winner is not null)
    into semifinal_count, completed_semifinal_count
    from public.matches as match
    where match.season_id = p_season_id and match.competition_stage = 'semifinal';

    if semifinal_count = 2 and completed_semifinal_count = 2 then
      insert into public.season_tournament_players (
        season_id, stage, seed, player_id, league_rank, qualified_from_match_id
      )
      select
        p_season_id,
        'final_four',
        (row_number() over (order by qualifier.league_rank))::smallint,
        member.player_id,
        qualifier.league_rank,
        match.id
      from public.matches as match
      join public.match_players as member on member.match_id = match.id and member.team = match.winner
      join public.season_tournament_players as qualifier
        on qualifier.season_id = p_season_id
       and qualifier.stage = 'semifinal'
       and qualifier.player_id = member.player_id
      where match.season_id = p_season_id and match.competition_stage = 'semifinal'
      on conflict (season_id, stage, seed) do nothing;

      select count(*) into qualifier_count
      from public.season_tournament_players
      where season_id = p_season_id and stage = 'final_four';
      if qualifier_count <> 4 then
        raise exception 'Die Final-Four-Sieger für % sind unvollständig.', p_season_id;
      end if;
      perform private.populate_tournament_stage(p_season_id, 'final_four', 'final_four');
      perform private.award_final_four_players(p_season_id);
    end if;
  end if;

  perform private.award_tournament_winner(p_season_id);
end;
$$;

create or replace function private.advance_tournament_after_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.actual_sets is not null and new.winner is not null then
    perform private.advance_season_tournament(new.season_id);
  end if;
  return new;
end;
$$;

drop trigger if exists matches_advance_tournament on public.matches;
create trigger matches_advance_tournament
after insert or update of actual_sets, winner on public.matches
for each row execute function private.advance_tournament_after_result();

create or replace function private.recalculate_season_elo(p_season_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ratings jsonb := '{}'::jsonb;
  played_match record;
  team_one_ids text[];
  team_two_ids text[];
  score_one integer[];
  score_two integer[];
  regular_set_count integer;
  regular_difference numeric;
  tiebreak_difference numeric;
  point_factor numeric;
  current_player_id text;
  player_old integer;
  player_new integer;
  opponent_one integer;
  opponent_two integer;
  expected numeric;
  won_score integer;
begin
  delete from public.match_elo_changes as change
  using public.matches as match
  where change.match_id = match.id and match.season_id = p_season_id;

  select coalesce(jsonb_object_agg(participant.player_id, participant.start_elo), '{}'::jsonb)
  into ratings
  from public.season_players as participant
  where participant.season_id = p_season_id;

  for played_match in
    select match.* from public.matches as match
    where match.season_id = p_season_id
      and match.actual_sets is not null and match.winner is not null and match.counts_for_elo
    order by match.scheduled_date nulls last, match.display_time nulls last, match.id
  loop
    select
      array_agg(member.player_id order by member.position) filter (where member.team = 1),
      array_agg(member.player_id order by member.position) filter (where member.team = 2)
    into team_one_ids, team_two_ids
    from public.match_players as member where member.match_id = played_match.id;
    if cardinality(team_one_ids) <> 2 or cardinality(team_two_ids) <> 2 then
      raise exception 'Für % fehlen vollständige Teams.', played_match.id;
    end if;

    select
      array_agg((score.capture)[1]::integer order by score.ordinality),
      array_agg((score.capture)[2]::integer order by score.ordinality)
    into score_one, score_two
    from regexp_matches(
      regexp_replace(played_match.result_details, '\([^)]*\)', '', 'g'),
      '([0-9]+)\s*:\s*([0-9]+)', 'g'
    ) with ordinality as score(capture, ordinality);
    regular_set_count := case when played_match.format = 'single-set' then 1 else 2 end;
    if cardinality(score_one) < regular_set_count then
      raise exception 'Für % ist kein vollständiges Ergebnis vorhanden.', played_match.id;
    end if;

    select abs(sum(score_one[positions.position]) - sum(score_two[positions.position]))
    into regular_difference
    from generate_series(1, regular_set_count) as positions(position);
    tiebreak_difference := case
      when played_match.format <> 'single-set' and cardinality(score_one) >= 3
        then (abs(score_one[3] - score_two[3])::numeric / 10) * 3
      else 0
    end;
    point_factor := power(log(10::numeric, regular_difference + tiebreak_difference + 1), 3) + 2;

    foreach current_player_id in array team_one_ids loop
      player_old := (ratings ->> current_player_id)::integer;
      opponent_one := (ratings ->> team_two_ids[1])::integer;
      opponent_two := (ratings ->> team_two_ids[2])::integer;
      expected := (
        1 / (1 + power(10::numeric, (opponent_one - player_old)::numeric / 500))
        + 1 / (1 + power(10::numeric, (opponent_two - player_old)::numeric / 500))
      ) / 2;
      won_score := case when played_match.winner = 1 then 1 else 0 end;
      player_new := round(player_old + point_factor * 50 * (won_score - expected));
      insert into public.match_elo_changes (match_id, player_id, old_elo, new_elo)
      values (played_match.id, current_player_id, player_old, player_new);
    end loop;
    foreach current_player_id in array team_two_ids loop
      player_old := (ratings ->> current_player_id)::integer;
      opponent_one := (ratings ->> team_one_ids[1])::integer;
      opponent_two := (ratings ->> team_one_ids[2])::integer;
      expected := (
        1 / (1 + power(10::numeric, (opponent_one - player_old)::numeric / 500))
        + 1 / (1 + power(10::numeric, (opponent_two - player_old)::numeric / 500))
      ) / 2;
      won_score := case when played_match.winner = 2 then 1 else 0 end;
      player_new := round(player_old + point_factor * 50 * (won_score - expected));
      insert into public.match_elo_changes (match_id, player_id, old_elo, new_elo)
      values (played_match.id, current_player_id, player_old, player_new);
    end loop;
    foreach current_player_id in array team_one_ids || team_two_ids loop
      select change.new_elo into player_new
      from public.match_elo_changes as change
      where change.match_id = played_match.id and change.player_id = current_player_id;
      ratings := jsonb_set(ratings, array[current_player_id], to_jsonb(player_new), true);
    end loop;
  end loop;
end;
$$;

alter table public.predictions drop constraint if exists predictions_prediction_check;

create or replace function private.validate_prediction_for_match()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  match_format text;
  team_one_games integer;
  team_two_games integer;
begin
  select match.format into match_format from public.matches as match where match.id = new.match_id;
  if match_format = 'single-set' then
    if new.prediction !~ '^[0-9]+:[0-9]+$' then raise exception 'Ungültiger Ein-Satz-Tipp.'; end if;
    team_one_games := split_part(new.prediction, ':', 1)::integer;
    team_two_games := split_part(new.prediction, ':', 2)::integer;
    if not (
      (team_one_games = 6 and team_two_games between 0 and 4)
      or (team_two_games = 6 and team_one_games between 0 and 4)
      or (team_one_games = 7 and team_two_games in (5, 6))
      or (team_two_games = 7 and team_one_games in (5, 6))
    ) then raise exception 'Ungültiger Satzendstand.'; end if;
  elsif new.prediction not in ('2:0', '2:1', '1:2', '0:2') then
    raise exception 'Ungültiger Satzergebnis-Tipp.';
  end if;
  return new;
end;
$$;

drop trigger if exists predictions_validate_match_format on public.predictions;
create trigger predictions_validate_match_format
before insert or update of prediction, match_id on public.predictions
for each row execute function private.validate_prediction_for_match();

create or replace function public.get_prediction_leaderboard(p_season_id text)
returns table (
  user_id uuid,
  display_name text,
  predictions_count bigint,
  scored_count bigint,
  exact_count bigint,
  tendency_count bigint,
  points bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with scored as (
    select
      prediction.user_id,
      prediction.match_id,
      prediction.prediction,
      match.format,
      match.actual_sets,
      case when match.format = 'single-set'
        then substring(match.result_details from '([0-9]+\s*:\s*[0-9]+)')
        else match.actual_sets
      end as actual_value,
      case when match.format = 'single-set'
        then split_part(prediction.prediction, ':', 1)::integer > split_part(prediction.prediction, ':', 2)::integer
        else prediction.prediction in ('2:0', '2:1')
      end as predicted_team_one,
      case when match.format = 'single-set'
        then split_part(substring(match.result_details from '([0-9]+\s*:\s*[0-9]+)'), ':', 1)::integer
          > split_part(substring(match.result_details from '([0-9]+\s*:\s*[0-9]+)'), ':', 2)::integer
        else match.actual_sets in ('2:0', '2:1')
      end as actual_team_one
    from public.predictions as prediction
    join public.matches as match on match.id = prediction.match_id
    where match.season_id = p_season_id
  )
  select
    profile.id,
    profile.display_name,
    count(scored.match_id),
    count(scored.match_id) filter (where scored.actual_sets is not null),
    count(scored.match_id) filter (where scored.actual_sets is not null and scored.prediction = scored.actual_value),
    count(scored.match_id) filter (
      where scored.actual_sets is not null
        and scored.prediction <> scored.actual_value
        and scored.predicted_team_one = scored.actual_team_one
    ),
    coalesce(sum(case
      when scored.actual_sets is null then 0
      when scored.prediction = scored.actual_value then 4
      when scored.predicted_team_one = scored.actual_team_one then 2
      else 0
    end), 0)::bigint
  from public.profiles as profile
  join scored on scored.user_id = profile.id
  group by profile.id, profile.display_name
  order by 7 desc, 5 desc, 6 desc, 2 asc;
$$;

drop function if exists public.get_my_result_tasks(text);
create function public.get_my_result_tasks(p_season_id text default null)
returns table (
  match_id text,
  season_id text,
  season_label text,
  league_id text,
  league_label text,
  matchday integer,
  match_format text,
  competition_stage text,
  scheduled_date date,
  display_time text,
  team_one_label text,
  team_two_label text,
  my_team smallint,
  task_type text,
  is_open boolean,
  proposal_id bigint,
  proposed_result text,
  proposed_sets text,
  proposed_winner smallint,
  proposed_played_on date,
  proposed_played_time time,
  official_result text,
  official_sets text
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select profile.id, profile.player_id, profile.app_role
    from public.profiles as profile where profile.id = (select auth.uid())
  ), pending as (
    select proposal.* from public.result_proposals as proposal where proposal.status = 'pending'
  ), task_matches as (
    select
      match.*,
      season.label as season_label,
      league.label as league_label,
      member.team as my_team,
      me.app_role,
      pending.id as proposal_id,
      pending.proposed_by_team,
      pending.result_details as proposed_result,
      pending.actual_sets as proposed_sets,
      pending.winner as proposed_winner,
      pending.played_on as proposed_played_on,
      pending.played_time as proposed_played_time,
      case
        when match.actual_sets is not null then false
        when pending.id is not null then true
        when match.lock_at is not null then match.lock_at <= now()
        when match.scheduled_date is null then false
        when match.scheduled_date < (timezone('Europe/Berlin', now()))::date then true
        when match.scheduled_date > (timezone('Europe/Berlin', now()))::date then false
        when match.display_time ~ '^[0-9]{1,2}[.:][0-9]{2}$'
          then replace(match.display_time, '.', ':')::time <= (timezone('Europe/Berlin', now()))::time
        else true
      end as is_open
    from public.matches as match
    join public.seasons as season on season.id = match.season_id and season.results_entry_enabled
    join public.leagues as league on league.season_id = match.season_id and league.id = match.league_id
    cross join me
    left join public.match_players as member on member.match_id = match.id and member.player_id = me.player_id
    left join pending on pending.match_id = match.id
    where (p_season_id is null or match.season_id = p_season_id)
      and (me.app_role = 'admin' or member.player_id is not null)
  )
  select
    task_match.id, task_match.season_id, task_match.season_label,
    task_match.league_id, task_match.league_label, task_match.matchday,
    task_match.format, task_match.competition_stage,
    task_match.scheduled_date, task_match.display_time,
    task_match.team_one_label, task_match.team_two_label, task_match.my_team,
    case
      when task_match.actual_sets is not null then 'completed'
      when task_match.proposal_id is null then 'enter'
      when task_match.app_role = 'admin' or task_match.proposed_by_team <> task_match.my_team then 'review'
      else 'waiting'
    end,
    task_match.is_open, task_match.proposal_id,
    task_match.proposed_result, task_match.proposed_sets, task_match.proposed_winner,
    task_match.proposed_played_on, task_match.proposed_played_time,
    task_match.result_details, task_match.actual_sets
  from task_matches as task_match
  order by task_match.scheduled_date nulls last, task_match.display_time nulls last, task_match.id;
$$;

revoke execute on function public.get_my_result_tasks(text) from public, anon;
grant execute on function public.get_my_result_tasks(text) to authenticated;

create or replace function public.get_public_season(p_season_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', season.id,
    'label', season.label,
    'title', season.title,
    'startDate', season.starts_on,
    'eloFinalDate', season.elo_final_date,
    'organizations', to_jsonb(season.organizations),
    'shortInfo', to_jsonb(season.short_info),
    'resultsEntryEnabled', season.results_entry_enabled,
    'competition', jsonb_build_object(
      'tournamentMode', replace(season.tournament_mode, '_', '-'),
      'qualificationPlaces', season.qualification_places,
      'homeRankingLimit', season.home_ranking_limit,
      'regularScheduleLocked', season.regular_schedule_locked,
      'predictionsEnabled', season.predictions_enabled
    ),
    'leagues', coalesce((
      select jsonb_agg(jsonb_build_object('id', league.id, 'label', league.label, 'default', league.is_default)
        order by league.is_default desc, league.id)
      from public.leagues as league where league.season_id = season.id
    ), '[]'::jsonb),
    'matchdays', coalesce((
      select jsonb_agg(jsonb_build_object(
        'spieltag', matchday.matchday, 'startDate', matchday.starts_on,
        'endDate', matchday.ends_on, 'title', matchday.title
      ) order by matchday.matchday)
      from public.season_matchdays as matchday where matchday.season_id = season.id
    ), '[]'::jsonb),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'playerId', participant.player_id, 'leagueId', participant.league_id, 'startElo', participant.start_elo
      ) order by player.display_name)
      from public.season_players as participant
      join public.players as player on player.id = participant.player_id
      where participant.season_id = season.id
    ), '[]'::jsonb),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', match.id,
        'type', 'season',
        'stage', replace(match.competition_stage, '_', '-'),
        'seasonId', match.season_id,
        'leagueId', match.league_id,
        'format', match.format,
        'countsForRanking', match.counts_for_ranking,
        'countsForElo', match.counts_for_elo,
        'matchday', match.matchday,
        'date', match.scheduled_date,
        'time', match.display_time,
        'result', match.result_details,
        'sets', match.actual_sets,
        'winner', match.winner,
        'displayLabel', match.display_label,
        'team1', jsonb_build_object(
          'playerIds', coalesce((
            select jsonb_agg(member.player_id order by member.position)
            from public.match_players as member where member.match_id = match.id and member.team = 1
          ), '[]'::jsonb),
          'qualifierRanks', to_jsonb(match.team_one_qualifier_ranks),
          'qualifierLabels', to_jsonb(string_to_array(match.team_one_label, ' / '))
        ),
        'team2', jsonb_build_object(
          'playerIds', coalesce((
            select jsonb_agg(member.player_id order by member.position)
            from public.match_players as member where member.match_id = match.id and member.team = 2
          ), '[]'::jsonb),
          'qualifierRanks', to_jsonb(match.team_two_qualifier_ranks),
          'qualifierLabels', to_jsonb(string_to_array(match.team_two_label, ' / '))
        )
      ) order by
        case match.competition_stage when 'league' then 1 when 'semifinal' then 2 else 3 end,
        match.matchday, match.id)
      from public.matches as match where match.season_id = season.id
    ), '[]'::jsonb)
  )
  from public.seasons as season where season.id = p_season_id;
$$;

revoke all on function public.get_public_season(text) from public;
grant execute on function public.get_public_season(text) to anon, authenticated;

select private.advance_season_tournament('2026');
select private.advance_season_tournament('winter-2026');

notify pgrst, 'reload schema';

commit;
