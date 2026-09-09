begin;

create temporary table elo_changes_before_migration on commit drop as
select match_id, player_id, old_elo, new_elo, delta
from public.match_elo_changes;

create temporary table official_match_players_before_migration on commit drop as
select match.id as match_id, member.player_id, member.team, member.position
from public.matches as match
join public.seasons as season
  on season.id = match.season_id
 and season.counts_for_profile
join public.match_players as member on member.match_id = match.id
where match.counts_for_elo
  and match.actual_sets is not null
  and match.winner is not null;

create temporary table season_start_elos_before_migration on commit drop as
select season_id, player_id, start_elo
from public.season_players;

alter table public.players
  add column if not exists initial_elo integer;
alter table public.players
  drop constraint if exists players_initial_elo_check;
alter table public.players
  add constraint players_initial_elo_check
  check (initial_elo is null or initial_elo > 0);

alter table public.seasons
  add column if not exists completed_at timestamptz;

alter table public.season_players
  add column if not exists end_elo integer;
alter table public.season_players
  drop constraint if exists season_players_end_elo_check;
alter table public.season_players
  add constraint season_players_end_elo_check
  check (end_elo is null or end_elo > 0);

alter table public.matches
  add column if not exists match_at timestamptz;

alter table public.result_proposals
  add column if not exists match_at timestamptz;

update public.matches as match
set match_at = (
  match.scheduled_date
  + replace(match.display_time, '.', ':')::time
) at time zone 'Europe/Berlin'
where match.match_at is null
  and match.scheduled_date is not null
  and match.display_time ~ '^[0-9]{1,2}[.:][0-9]{2}$';

update public.result_proposals as proposal
set match_at = (proposal.played_on + proposal.played_time) at time zone 'Europe/Berlin'
where proposal.match_at is null;

do $$
begin
  if exists (
    select 1
    from public.matches as match
    where match.scheduled_date is not null
      and match.display_time ~ '^[0-9]{1,2}[.:][0-9]{2}$'
      and match.match_at is distinct from ((
        match.scheduled_date + replace(match.display_time, '.', ':')::time
      ) at time zone 'Europe/Berlin')
  ) or exists (
    select 1
    from public.result_proposals as proposal
    where proposal.match_at is distinct from ((
      proposal.played_on + proposal.played_time
    ) at time zone 'Europe/Berlin')
  ) then
    raise exception 'Die zusammengeführten Berliner Spielzeiten stimmen nicht mit dem Bestand überein.';
  end if;

  if exists (
    select 1
    from public.matches as match
    left join public.season_matchdays as matchday
      on matchday.season_id = match.season_id
     and matchday.matchday = match.matchday
    where match.scheduled_date is not null
      and nullif(trim(match.display_time), '') is null
      and match.scheduled_date is distinct from matchday.starts_on
  ) then
    raise exception 'Ein offener Datumshinweis lässt sich nicht verlustfrei über den Spieltag erhalten.';
  end if;
end
$$;

alter table public.result_proposals
  alter column match_at set not null;

update public.players as player
set initial_elo = seed.start_elo
from (
  select distinct on (participant.player_id)
    participant.player_id,
    participant.start_elo
  from public.season_players as participant
  join public.seasons as season
    on season.id = participant.season_id
   and season.counts_for_profile
  order by participant.player_id, season.starts_on nulls last, season.id
) as seed
where player.id = seed.player_id
  and player.initial_elo is null;

do $$
begin
  if exists (
    select 1
    from (
      select distinct on (participant.player_id)
        participant.player_id,
        participant.start_elo
      from public.season_players as participant
      join public.seasons as season
        on season.id = participant.season_id
       and season.counts_for_profile
      order by participant.player_id, season.starts_on nulls last, season.id
    ) as seed
    join public.players as player on player.id = seed.player_id
    where player.initial_elo is distinct from seed.start_elo
  ) or exists (
    select 1
    from public.players as player
    where player.initial_elo is not null
      and not exists (
        select 1
        from public.season_players as participant
        join public.seasons as season
          on season.id = participant.season_id
         and season.counts_for_profile
        where participant.player_id = player.id
      )
  ) then
    raise exception 'Die globalen Initial-Elo-Werte stimmen nicht mit den frühesten offiziellen Saisonwerten überein.';
  end if;
end
$$;

alter table public.matches
  drop constraint if exists matches_result_requires_match_at;
alter table public.matches
  add constraint matches_result_requires_match_at
  check (actual_sets is null or match_at is not null);

create or replace function private.initialize_player_elo_from_participation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.seasons as season
    where season.id = new.season_id
      and season.counts_for_profile
  ) then
    update public.players
    set initial_elo = new.start_elo
    where id = new.player_id
      and initial_elo is null;
  end if;
  return new;
end;
$$;

drop trigger if exists season_players_initialize_player_elo on public.season_players;
create trigger season_players_initialize_player_elo
after insert or update of season_id, player_id, start_elo on public.season_players
for each row execute function private.initialize_player_elo_from_participation();

create index if not exists matches_global_elo_order_idx
  on public.matches(match_at, id)
  where counts_for_elo and actual_sets is not null and winner is not null;

do $$
begin
  if exists (
    select 1
    from public.match_elo_changes as change
    join public.matches as match on match.id = change.match_id
    join public.seasons as season on season.id = match.season_id and season.counts_for_profile
    join public.players as player on player.id = change.player_id
    where match.counts_for_elo
      and (player.initial_elo is null or match.match_at is null)
  ) then
    raise exception 'Für bestehende offizielle Elo-Daten fehlen Initial-Elo oder Spielzeit.';
  end if;
end
$$;

create or replace function private.recalculate_global_elo_from_point(
  p_replay_at timestamptz,
  p_replay_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ratings jsonb := '{}'::jsonb;
  previous_rating record;
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
  perform pg_advisory_xact_lock(70317, 20270909);

  if p_replay_at is null or p_replay_id is null then
    raise exception 'Für die globale Elo-Neuberechnung fehlt der Startpunkt.';
  end if;

  if exists (
    select 1
    from public.matches as first_match
    join public.seasons as first_season
      on first_season.id = first_match.season_id
     and first_season.counts_for_profile
    join public.match_players as first_member on first_member.match_id = first_match.id
    join public.matches as second_match
      on second_match.match_at = first_match.match_at
     and second_match.id > first_match.id
     and second_match.counts_for_elo
     and second_match.actual_sets is not null
     and second_match.winner is not null
    join public.seasons as second_season
      on second_season.id = second_match.season_id
     and second_season.counts_for_profile
    join public.match_players as second_member
      on second_member.match_id = second_match.id
     and second_member.player_id = first_member.player_id
    where first_match.counts_for_elo
      and first_match.actual_sets is not null
      and first_match.winner is not null
      and first_match.match_at is not null
  ) then
    raise exception 'Ein Spieler kann nicht zwei offizielle Elo-Partien zum gleichen Zeitpunkt bestreiten.';
  end if;

  select coalesce(jsonb_object_agg(player.id, player.initial_elo), '{}'::jsonb)
  into ratings
  from public.players as player
  where player.initial_elo is not null;

  for previous_rating in
    select distinct on (change.player_id)
      change.player_id,
      change.new_elo
    from public.match_elo_changes as change
    join public.matches as match on match.id = change.match_id
    join public.seasons as season
      on season.id = match.season_id
     and season.counts_for_profile
    where match.counts_for_elo
      and (match.match_at, match.id) < (p_replay_at, p_replay_id)
    order by change.player_id, match.match_at desc, match.id desc
  loop
    ratings := jsonb_set(
      ratings,
      array[previous_rating.player_id],
      to_jsonb(previous_rating.new_elo),
      true
    );
  end loop;

  delete from public.match_elo_changes as change
  using public.matches as match, public.seasons as season
  where change.match_id = match.id
    and season.id = match.season_id
    and season.counts_for_profile
    and (
      match.id = p_replay_id
      or (match.match_at, match.id) >= (p_replay_at, p_replay_id)
    );

  for played_match in
    select match.*
    from public.matches as match
    join public.seasons as season
      on season.id = match.season_id
     and season.counts_for_profile
    where match.counts_for_elo
      and match.actual_sets is not null
      and match.winner is not null
      and match.match_at is not null
      and (match.match_at, match.id) >= (p_replay_at, p_replay_id)
    order by match.match_at, match.id
  loop
    select
      array_agg(member.player_id order by member.position) filter (where member.team = 1),
      array_agg(member.player_id order by member.position) filter (where member.team = 2)
    into team_one_ids, team_two_ids
    from public.match_players as member
    where member.match_id = played_match.id;

    if cardinality(team_one_ids) <> 2 or cardinality(team_two_ids) <> 2 then
      raise exception 'Für % fehlen vollständige Teams.', played_match.id;
    end if;

    foreach current_player_id in array team_one_ids || team_two_ids loop
      if not ratings ? current_player_id then
        raise exception 'Für Spieler % fehlt der globale Initial-Elo.', current_player_id;
      end if;
    end loop;

    select
      array_agg((score.capture)[1]::integer order by score.ordinality),
      array_agg((score.capture)[2]::integer order by score.ordinality)
    into score_one, score_two
    from regexp_matches(
      regexp_replace(played_match.result_details, '\([^)]*\)', '', 'g'),
      '([0-9]+)\s*:\s*([0-9]+)',
      'g'
    ) with ordinality as score(capture, ordinality);

    regular_set_count := case when played_match.format = 'single-set' then 1 else 2 end;
    if cardinality(score_one) < regular_set_count then
      raise exception 'Für % ist kein vollständiges Ergebnis vorhanden.', played_match.id;
    end if;

    select abs(sum(score_one[position]) - sum(score_two[position]))
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
      where change.match_id = played_match.id
        and change.player_id = current_player_id;
      ratings := jsonb_set(ratings, array[current_player_id], to_jsonb(player_new), true);
    end loop;
  end loop;

  update public.season_players as participant
  set end_elo = coalesce((
    select change.new_elo
    from public.match_elo_changes as change
    join public.matches as match on match.id = change.match_id
    join public.seasons as event_season
      on event_season.id = match.season_id
     and event_season.counts_for_profile
    where change.player_id = participant.player_id
      and match.counts_for_elo
      and match.match_at <= completed_season.season_end_at
    order by match.match_at desc, match.id desc
    limit 1
  ), (
    select player.initial_elo
    from public.players as player
    where player.id = participant.player_id
  ), participant.start_elo)
  from (
    select season.id, max(match.match_at) as season_end_at
    from public.seasons as season
    join public.matches as match on match.season_id = season.id
    where season.completed_at is not null
    group by season.id
    having max(match.match_at) >= p_replay_at
  ) as completed_season
  where participant.season_id = completed_season.id;

  update public.seasons as season
  set elo_final_date = (
    select (max(match.match_at) at time zone 'Europe/Berlin')::date
    from public.matches as match
    where match.season_id = season.id
  )
  where season.completed_at is not null
    and exists (
      select 1
      from public.matches as match
      where match.season_id = season.id
      group by match.season_id
      having max(match.match_at) >= p_replay_at
    );
end;
$$;

create or replace function private.recalculate_global_elo_from(p_match_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  replay_at timestamptz;
begin
  select match.match_at into replay_at
  from public.matches as match
  join public.seasons as season
    on season.id = match.season_id
   and season.counts_for_profile
  where match.id = p_match_id
    and match.counts_for_elo
    and match.actual_sets is not null
    and match.winner is not null;

  if not found then
    raise exception 'Die Partie % ist kein abgeschlossenes offizielles Elo-Spiel.', p_match_id;
  end if;
  if replay_at is null then
    raise exception 'Für die Partie % fehlt die verbindliche Spielzeit.', p_match_id;
  end if;

  perform private.recalculate_global_elo_from_point(replay_at, p_match_id);
end;
$$;

create or replace function private.recalculate_season_elo(p_season_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  first_match_id text;
begin
  select match.id into first_match_id
  from public.matches as match
  join public.seasons as season
    on season.id = match.season_id
   and season.counts_for_profile
  where match.season_id = p_season_id
    and match.counts_for_elo
    and match.actual_sets is not null
    and match.winner is not null
    and match.match_at is not null
  order by match.match_at, match.id
  limit 1;

  if first_match_id is not null then
    perform private.recalculate_global_elo_from(first_match_id);
  end if;
end;
$$;

create or replace function private.try_complete_season(p_season_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_season record;
  season_end_at timestamptz;
  match_count integer;
  open_match_count integer;
  incomplete_team_count integer;
  league_count integer;
  quarterfinal_count integer;
  semifinal_count integer;
  final_four_count integer;
  final_count integer;
begin
  select season.* into selected_season
  from public.seasons as season
  where season.id = p_season_id
  for update;

  if not found
    or selected_season.completed_at is not null
    or not selected_season.counts_for_profile
    or not selected_season.regular_schedule_locked then
    return false;
  end if;

  select
    count(*),
    count(*) filter (where match.actual_sets is null or match.winner is null or match.match_at is null),
    count(*) filter (where (
      select count(*) from public.match_players as member where member.match_id = match.id
    ) <> 4),
    count(*) filter (where match.competition_stage = 'league'),
    count(*) filter (where match.competition_stage = 'quarterfinal'),
    count(*) filter (where match.competition_stage = 'semifinal'),
    count(*) filter (where match.competition_stage = 'final_four'),
    count(*) filter (where match.competition_stage = 'final')
  into match_count, open_match_count, incomplete_team_count,
    league_count, quarterfinal_count, semifinal_count, final_four_count, final_count
  from public.matches as match
  where match.season_id = p_season_id;

  if match_count = 0 or open_match_count > 0 or incomplete_team_count > 0 then
    return false;
  end if;

  if selected_season.tournament_mode = 'direct_final_four'
    and (league_count = 0 or final_four_count <> 3) then
    return false;
  elsif selected_season.tournament_mode = 'top8_semifinals'
    and (league_count = 0 or semifinal_count <> 2 or final_four_count <> 3) then
    return false;
  elsif selected_season.tournament_mode = 'knockout_redraw'
    and (quarterfinal_count <> 4 or semifinal_count <> 2 or final_count <> 1) then
    return false;
  end if;

  select max(match.match_at) into season_end_at
  from public.matches as match
  where match.season_id = p_season_id;

  update public.season_players as participant
  set end_elo = coalesce((
    select change.new_elo
    from public.match_elo_changes as change
    join public.matches as match on match.id = change.match_id
    join public.seasons as season
      on season.id = match.season_id
     and season.counts_for_profile
    where change.player_id = participant.player_id
      and match.counts_for_elo
      and match.match_at <= season_end_at
    order by match.match_at desc, match.id desc
    limit 1
  ), (
    select player.initial_elo
    from public.players as player
    where player.id = participant.player_id
  ), participant.start_elo)
  where participant.season_id = p_season_id;

  update public.seasons
  set
    completed_at = now(),
    elo_final_date = (season_end_at at time zone 'Europe/Berlin')::date,
    results_entry_enabled = false
  where id = p_season_id;

  return true;
end;
$$;

create or replace function private.recalculate_global_elo_after_match_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  replay_at timestamptz;
  is_official_season boolean;
begin
  select season.counts_for_profile into is_official_season
  from public.seasons as season
  where season.id = new.season_id;

  if is_official_season and (
    (old.counts_for_elo and old.actual_sets is not null and old.winner is not null)
    or (new.counts_for_elo and new.actual_sets is not null and new.winner is not null)
  ) then
    replay_at := case
      when old.match_at is null then new.match_at
      when new.match_at is null then old.match_at
      else least(old.match_at, new.match_at)
    end;
    perform private.recalculate_global_elo_from_point(replay_at, new.id);
  end if;

  if new.actual_sets is not null and new.winner is not null then
    perform private.try_complete_season(new.season_id);
  end if;
  return new;
end;
$$;

create or replace function private.try_complete_season_after_schedule_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.try_complete_season(new.id);
  return new;
end;
$$;

drop trigger if exists seasons_try_complete_after_schedule_lock on public.seasons;
create trigger seasons_try_complete_after_schedule_lock
after update of regular_schedule_locked on public.seasons
for each row
when (
  old.regular_schedule_locked is distinct from new.regular_schedule_locked
  and new.regular_schedule_locked
)
execute function private.try_complete_season_after_schedule_lock();

drop trigger if exists matches_recalculate_global_elo on public.matches;
create trigger matches_recalculate_global_elo
after update of match_at, result_details, actual_sets, winner, counts_for_elo on public.matches
for each row
when (
  old.match_at is distinct from new.match_at
  or old.result_details is distinct from new.result_details
  or old.actual_sets is distinct from new.actual_sets
  or old.winner is distinct from new.winner
  or old.counts_for_elo is distinct from new.counts_for_elo
)
execute function private.recalculate_global_elo_after_match_result();

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
    and new.match_at is not null
    and new.actual_sets is null;
  return new;
end;
$$;

drop policy if exists "Users create open predictions" on public.predictions;
create policy "Users create open predictions" on public.predictions for insert to authenticated
with check (
  (select auth.uid()) is not null
  and (select auth.uid()) = user_id
  and exists (
    select 1
    from public.matches as match
    join public.seasons as season on season.id = match.season_id and season.predictions_enabled
    where match.id = match_id
      and match.betting_open
      and match.actual_sets is null
      and (match.match_at is null or match.match_at > now())
      and (
        match.competition_stage = 'league'
        or (
          match.match_at is not null
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
      and (match.match_at is null or match.match_at > now())
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
      and (match.match_at is null or match.match_at > now())
      and (
        match.competition_stage = 'league'
        or (
          match.match_at is not null
          and (select count(*) from public.match_players as member where member.match_id = match.id) = 4
        )
      )
  )
);

drop policy if exists "Users delete open predictions" on public.predictions;
create policy "Users delete open predictions" on public.predictions for delete to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.uid()) = user_id
  and exists (
    select 1 from public.matches as match
    join public.seasons as season on season.id = match.season_id and season.predictions_enabled
    where match.id = match_id
      and match.betting_open
      and match.actual_sets is null
      and (match.match_at is null or match.match_at > now())
  )
);

create or replace function private.award_knockout_final_achievements_after_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_season record;
  default_league record;
  award_date date;
begin
  if new.competition_stage <> 'final' or new.actual_sets is null or new.winner is null then
    return new;
  end if;

  select season.* into selected_season
  from public.seasons as season
  where season.id = new.season_id;
  if not found or selected_season.tournament_mode <> 'knockout_redraw' then
    return new;
  end if;

  select league.id, league.label into default_league
  from public.leagues as league
  where league.season_id = new.season_id and league.is_default
  order by league.id
  limit 1;
  if not found then
    raise exception 'Für die Cup-Saison % fehlt die Standardliga.', new.season_id;
  end if;

  award_date := coalesce((new.match_at at time zone 'Europe/Berlin')::date, current_date);

  insert into public.player_achievements (
    player_id, season_id, league_id, kind, title, subtitle, achieved_on, priority
  )
  select member.player_id, new.season_id, default_league.id,
    'winner', 'Champion', default_league.label, award_date, 200
  from public.match_players as member
  where member.match_id = new.id
    and member.team = new.winner
    and not exists (
      select 1 from public.player_achievements as achievement
      where achievement.player_id = member.player_id
        and achievement.season_id = new.season_id
        and achievement.league_id = default_league.id
        and achievement.kind = 'winner'
    );

  insert into public.player_achievements (
    player_id, season_id, league_id, kind, title, subtitle, achieved_on, priority
  )
  select member.player_id, new.season_id, default_league.id,
    'finalist', 'Finale', default_league.label, award_date, 100
  from public.match_players as member
  where member.match_id = new.id
    and member.team <> new.winner
    and not exists (
      select 1 from public.player_achievements as achievement
      where achievement.player_id = member.player_id
        and achievement.season_id = new.season_id
        and achievement.league_id = default_league.id
        and achievement.kind = 'finalist'
    );

  return new;
end;
$$;

drop function if exists public.schedule_match(text, timestamp without time zone);
create function public.schedule_match(p_match_id text, p_match_at timestamp without time zone)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_profile record;
  selected_match record;
  user_team smallint;
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  if not private.user_email_is_confirmed(current_user_id) then
    raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen.';
  end if;
  if p_match_at is null then raise exception 'Bitte Datum und Uhrzeit angeben.'; end if;

  select profile.* into current_profile
  from public.profiles as profile
  where profile.id = current_user_id;
  if not found then raise exception 'Kein Profil für dieses Konto gefunden.'; end if;

  select match.* into selected_match
  from public.matches as match
  join public.seasons as season on season.id = match.season_id
  where match.id = p_match_id and season.results_entry_enabled
  for update of match;
  if not found then raise exception 'Partie nicht gefunden.'; end if;
  if selected_match.actual_sets is not null or selected_match.result_details is not null then
    raise exception 'Die Partie besitzt bereits ein offizielles Ergebnis.';
  end if;
  if exists (
    select 1 from public.result_proposals as proposal
    where proposal.match_id = p_match_id and proposal.status = 'pending'
  ) then
    raise exception 'Für diese Partie wartet bereits ein Ergebnis auf Bestätigung.';
  end if;

  select member.team into user_team
  from public.match_players as member
  where member.match_id = p_match_id and member.player_id = current_profile.player_id;
  if current_profile.app_role is distinct from 'admin' and user_team is null then
    raise exception 'Nur beteiligte Spieler dürfen die Partie terminieren.';
  end if;

  update public.matches
  set match_at = p_match_at at time zone 'Europe/Berlin'
  where id = p_match_id;
end;
$$;

drop function if exists public.submit_match_result(text, text, text, smallint, timestamp without time zone);
create function public.submit_match_result(
  p_match_id text,
  p_result_details text,
  p_actual_sets text,
  p_winner smallint,
  p_match_at timestamp without time zone
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_profile record;
  selected_match record;
  user_team smallint;
  pending_proposal record;
  next_revision integer;
  new_proposal_id bigint;
  official_match_at timestamptz;
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  if not private.user_email_is_confirmed(current_user_id) then
    raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen.';
  end if;
  if p_match_at is null then raise exception 'Bitte tatsächliches Datum und Uhrzeit angeben.'; end if;
  official_match_at := p_match_at at time zone 'Europe/Berlin';
  if official_match_at > now() + interval '5 minutes' then
    raise exception 'Die tatsächliche Spielzeit darf nicht in der Zukunft liegen.';
  end if;
  perform private.validate_official_result(trim(p_result_details), p_actual_sets, p_winner);

  select profile.* into current_profile
  from public.profiles as profile where profile.id = current_user_id;
  if not found then raise exception 'Kein Profil für dieses Konto gefunden.'; end if;

  select match.* into selected_match
  from public.matches as match
  join public.seasons as season on season.id = match.season_id
  where match.id = p_match_id and season.results_entry_enabled
  for update of match;
  if not found then raise exception 'Partie nicht gefunden.'; end if;
  if selected_match.actual_sets is not null then
    raise exception 'Die Partie besitzt bereits ein offizielles Ergebnis.';
  end if;

  select member.team into user_team
  from public.match_players as member
  where member.match_id = p_match_id and member.player_id = current_profile.player_id;
  if current_profile.app_role <> 'admin' and user_team is null then
    raise exception 'Nur beteiligte Spieler dürfen Ergebnisse eintragen.';
  end if;

  if current_profile.app_role = 'admin' then
    perform pg_advisory_xact_lock(70317, 20270909);
    update public.matches
    set match_at = official_match_at,
      result_details = trim(p_result_details), actual_sets = p_actual_sets, winner = p_winner
    where id = p_match_id;
    return null;
  end if;

  select proposal.* into pending_proposal
  from public.result_proposals as proposal
  where proposal.match_id = p_match_id and proposal.status = 'pending'
  for update;
  if pending_proposal.id is not null and pending_proposal.proposed_by_team = user_team then
    raise exception 'Jetzt ist das gegnerische Team an der Reihe.';
  end if;
  if pending_proposal.id is not null then
    update public.result_proposals
    set status = 'superseded', resolved_at = now()
    where id = pending_proposal.id;
  end if;

  select coalesce(max(proposal.revision), 0) + 1 into next_revision
  from public.result_proposals as proposal where proposal.match_id = p_match_id;

  insert into public.result_proposals (
    match_id, revision, proposed_by, proposed_by_team, match_at,
    result_details, actual_sets, winner
  ) values (
    p_match_id, next_revision, current_user_id, user_team, official_match_at,
    trim(p_result_details), p_actual_sets, p_winner
  ) returning id into new_proposal_id;

  return new_proposal_id;
end;
$$;

create or replace function public.confirm_match_result(p_proposal_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_profile record;
  selected_proposal record;
  selected_match record;
  user_team smallint;
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  if not private.user_email_is_confirmed(current_user_id) then
    raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen.';
  end if;
  select profile.* into current_profile
  from public.profiles as profile where profile.id = current_user_id;

  select proposal.* into selected_proposal
  from public.result_proposals as proposal
  where proposal.id = p_proposal_id and proposal.status = 'pending'
  for update;
  if not found then raise exception 'Der Vorschlag ist nicht mehr offen.'; end if;

  select match.* into selected_match
  from public.matches as match where match.id = selected_proposal.match_id
  for update;
  if selected_match.actual_sets is not null then
    raise exception 'Die Partie wurde bereits bestätigt.';
  end if;

  select member.team into user_team
  from public.match_players as member
  where member.match_id = selected_match.id and member.player_id = current_profile.player_id;
  if current_profile.app_role <> 'admin'
    and (user_team is null or user_team = selected_proposal.proposed_by_team) then
    raise exception 'Bestätigen muss ein Spieler des gegnerischen Teams.';
  end if;

  perform pg_advisory_xact_lock(70317, 20270909);
  update public.result_proposals
  set status = 'confirmed', confirmed_by = current_user_id, resolved_at = now()
  where id = selected_proposal.id;

  update public.matches
  set match_at = selected_proposal.match_at,
    result_details = selected_proposal.result_details,
    actual_sets = selected_proposal.actual_sets,
    winner = selected_proposal.winner
  where id = selected_match.id;
end;
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
  match_at timestamptz,
  team_one_label text,
  team_two_label text,
  my_team smallint,
  task_type text,
  is_open boolean,
  proposal_id bigint,
  proposed_result text,
  proposed_sets text,
  proposed_winner smallint,
  proposed_match_at timestamptz,
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
    select match.*, season.label as season_label, league.label as league_label,
      member.team as my_team, me.app_role,
      pending.id as proposal_id, pending.proposed_by_team,
      pending.result_details as proposed_result,
      pending.actual_sets as proposed_sets,
      pending.winner as proposed_winner,
      pending.match_at as proposed_match_at,
      case
        when match.actual_sets is not null then false
        when pending.id is not null then true
        when match.match_at is null then false
        else match.match_at <= now()
      end as is_open
    from public.matches as match
    join public.seasons as season on season.id = match.season_id and season.results_entry_enabled
    join public.leagues as league on league.season_id = match.season_id and league.id = match.league_id
    cross join me
    left join public.match_players as member
      on member.match_id = match.id and member.player_id = me.player_id
    left join pending on pending.match_id = match.id
    where (p_season_id is null or match.season_id = p_season_id)
      and (me.app_role = 'admin' or member.player_id is not null)
  )
  select task_match.id, task_match.season_id, task_match.season_label,
    task_match.league_id, task_match.league_label, task_match.matchday,
    task_match.format, task_match.competition_stage, task_match.match_at,
    task_match.team_one_label, task_match.team_two_label, task_match.my_team,
    case
      when task_match.actual_sets is not null then 'completed'
      when task_match.proposal_id is null then 'enter'
      when task_match.app_role = 'admin' or task_match.proposed_by_team <> task_match.my_team then 'review'
      else 'waiting'
    end,
    task_match.is_open, task_match.proposal_id,
    task_match.proposed_result, task_match.proposed_sets, task_match.proposed_winner,
    task_match.proposed_match_at, task_match.result_details, task_match.actual_sets
  from task_matches as task_match
  order by task_match.match_at nulls last, task_match.id;
$$;

create or replace view private.player_profile_match_rows as
select
  member.player_id,
  match.id as row_id,
  'league'::text as kind,
  (match.match_at at time zone 'Europe/Berlin')::date as played_on,
  to_char(match.match_at at time zone 'Europe/Berlin', 'HH24.MI') as display_time,
  match.season_id,
  season.label as season_label,
  member.team,
  match.result_details,
  case when match.winner = member.team then 'win' else 'loss' end::text as outcome,
  coalesce((
    select array_agg(player.display_name order by teammate.position)
    from public.match_players as teammate
    join public.players as player on player.id = teammate.player_id
    where teammate.match_id = match.id and teammate.team = member.team
      and teammate.player_id <> member.player_id
  ), '{}')::text[] as partner_names,
  coalesce((
    select array_agg(player.display_name order by opponent.position)
    from public.match_players as opponent
    join public.players as player on player.id = opponent.player_id
    where opponent.match_id = match.id and opponent.team <> member.team
  ), '{}')::text[] as opponent_names,
  case member.team
    when 1 then (private.profile_regular_game_totals(match.result_details))[1]
    else (private.profile_regular_game_totals(match.result_details))[2]
  end as games_for,
  case member.team
    when 1 then (private.profile_regular_game_totals(match.result_details))[2]
    else (private.profile_regular_game_totals(match.result_details))[1]
  end as games_against,
  case
    when not match.counts_for_ranking then 0
    when member.team = 1 and match.actual_sets = '2:0' then 3
    when member.team = 1 and match.actual_sets = '2:1' then 2
    when member.team = 1 and match.actual_sets = '1:2' then 1
    when member.team = 2 and match.actual_sets = '0:2' then 3
    when member.team = 2 and match.actual_sets = '1:2' then 2
    when member.team = 2 and match.actual_sets = '2:1' then 1
    else 0
  end as points,
  match.counts_for_ranking,
  true as is_complete,
  null::bigint as training_session_id,
  null::integer as training_round_number
from public.matches as match
join public.seasons as season on season.id = match.season_id and season.counts_for_profile
join public.match_players as member on member.match_id = match.id
where match.actual_sets is not null and match.winner is not null
  and match.match_type in ('season', 'final')

union all

select
  participant.player_id,
  'training-' || session.id || '-' || round.round_number,
  'training'::text,
  session.played_on,
  to_char(session.display_time, 'HH24.MI'),
  null::text,
  'Training'::text,
  case when participant.player_id = any(round.team_one_ids) then 1 else 2 end::smallint,
  round.result_details,
  case
    when not round.is_complete then 'unfinished'
    when (private.profile_set_win_totals(round.result_details, round.set_count))[1]
       = (private.profile_set_win_totals(round.result_details, round.set_count))[2] then 'draw'
    when participant.player_id = any(round.team_one_ids)
      then case when (private.profile_set_win_totals(round.result_details, round.set_count))[1]
                   > (private.profile_set_win_totals(round.result_details, round.set_count))[2]
                then 'win' else 'loss' end
    else case when (private.profile_set_win_totals(round.result_details, round.set_count))[2]
                 > (private.profile_set_win_totals(round.result_details, round.set_count))[1]
              then 'win' else 'loss' end
  end::text,
  coalesce((
    select array_agg(player.display_name order by member.ordinality)
    from unnest(case when participant.player_id = any(round.team_one_ids)
      then round.team_one_ids else round.team_two_ids end)
      with ordinality as member(player_id, ordinality)
    join public.players as player on player.id = member.player_id
    where member.player_id <> participant.player_id
  ), '{}')::text[],
  coalesce((
    select array_agg(player.display_name order by member.ordinality)
    from unnest(case when participant.player_id = any(round.team_one_ids)
      then round.team_two_ids else round.team_one_ids end)
      with ordinality as member(player_id, ordinality)
    join public.players as player on player.id = member.player_id
  ), '{}')::text[],
  case when participant.player_id = any(round.team_one_ids)
    then (private.profile_regular_game_totals(round.result_details))[1]
    else (private.profile_regular_game_totals(round.result_details))[2] end,
  case when participant.player_id = any(round.team_one_ids)
    then (private.profile_regular_game_totals(round.result_details))[2]
    else (private.profile_regular_game_totals(round.result_details))[1] end,
  0,
  false,
  round.is_complete,
  session.id,
  round.round_number
from public.training_sessions as session
join public.training_rounds as round on round.session_id = session.id
cross join lateral unnest(session.player_ids) as participant(player_id)
where session.status = 'confirmed';

drop function if exists public.get_public_seasons();
create function public.get_public_seasons()
returns table (
  id text,
  label text,
  title text,
  starts_on date,
  is_active boolean,
  results_entry_enabled boolean,
  visual_theme text,
  completed_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select season.id, season.label, season.title, season.starts_on,
    season.is_active, season.results_entry_enabled, season.visual_theme, season.completed_at
  from public.seasons as season
  order by season.is_active desc, season.starts_on desc nulls last, season.id;
$$;

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
    'completedAt', season.completed_at,
    'visualTheme', season.visual_theme,
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
      select jsonb_agg(jsonb_build_object(
        'id', league.id, 'label', league.label, 'default', league.is_default
      ) order by league.is_default desc, league.id)
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
        'playerId', participant.player_id,
        'leagueId', participant.league_id,
        'startElo', participant.start_elo,
        'endElo', participant.end_elo,
        'currentElo', coalesce((
          select change.new_elo
          from public.match_elo_changes as change
          join public.matches as current_match on current_match.id = change.match_id
          join public.seasons as current_season
            on current_season.id = current_match.season_id
           and current_season.counts_for_profile
          where change.player_id = participant.player_id
            and current_match.counts_for_elo
          order by current_match.match_at desc, current_match.id desc
          limit 1
        ), player.initial_elo, participant.start_elo),
        'eloHistory', coalesce((
          select jsonb_agg(event.payload order by event.event_at, event.event_order, event.match_id)
          from (
            select
              (season.starts_on::timestamp at time zone 'Europe/Berlin') as event_at,
              0 as event_order,
              ''::text as match_id,
              jsonb_build_object(
                'eventType', 'season-start', 'matchId', null,
                'matchAt', season.starts_on::timestamp at time zone 'Europe/Berlin',
                'date', season.starts_on, 'label', 'Start',
                'oldElo', null, 'elo', participant.start_elo, 'delta', null,
                'interveningEvents', '[]'::jsonb
              ) as payload
            union all
            select
              match.match_at,
              1,
              match.id,
              jsonb_build_object(
                'eventType', 'match', 'matchId', match.id,
                'matchAt', match.match_at,
                'date', (match.match_at at time zone 'Europe/Berlin')::date,
                'label', coalesce(match.display_label, 'Partie ' || match.matchday),
                'oldElo', change.old_elo, 'elo', change.new_elo, 'delta', change.delta,
                'interveningEvents', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'seasonId', external_match.season_id,
                    'seasonLabel', external_season.label,
                    'matchLabel', coalesce(external_match.display_label, 'Partie ' || external_match.matchday),
                    'matchAt', external_match.match_at,
                    'delta', external_change.delta
                  ) order by external_match.match_at, external_match.id)
                  from public.match_elo_changes as external_change
                  join public.matches as external_match on external_match.id = external_change.match_id
                  join public.seasons as external_season
                    on external_season.id = external_match.season_id
                   and external_season.counts_for_profile
                  where external_change.player_id = participant.player_id
                    and external_match.counts_for_elo
                    and external_match.season_id <> season.id
                    and external_match.match_at > coalesce((
                      select max(previous_match.match_at)
                      from public.match_elo_changes as previous_change
                      join public.matches as previous_match on previous_match.id = previous_change.match_id
                      where previous_change.player_id = participant.player_id
                        and previous_match.season_id = season.id
                        and previous_match.counts_for_elo
                        and previous_match.match_at < match.match_at
                    ), season.starts_on::timestamp at time zone 'Europe/Berlin')
                    and external_match.match_at < match.match_at
                ), '[]'::jsonb)
              )
            from public.match_elo_changes as change
            join public.matches as match on match.id = change.match_id
            where change.player_id = participant.player_id
              and match.season_id = season.id
              and match.counts_for_elo
            union all
            select
              coalesce((
                select max(match.match_at) from public.matches as match where match.season_id = season.id
              ), season.completed_at),
              2,
              '~final',
              jsonb_build_object(
                'eventType', 'season-end', 'matchId', null,
                'matchAt', coalesce((
                  select max(match.match_at) from public.matches as match where match.season_id = season.id
                ), season.completed_at),
                'date', season.elo_final_date, 'label', 'Final',
                'oldElo', null, 'elo', participant.end_elo, 'delta', null,
                'interveningEvents', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'seasonId', external_match.season_id,
                    'seasonLabel', external_season.label,
                    'matchLabel', coalesce(external_match.display_label, 'Partie ' || external_match.matchday),
                    'matchAt', external_match.match_at,
                    'delta', external_change.delta
                  ) order by external_match.match_at, external_match.id)
                  from public.match_elo_changes as external_change
                  join public.matches as external_match on external_match.id = external_change.match_id
                  join public.seasons as external_season
                    on external_season.id = external_match.season_id
                   and external_season.counts_for_profile
                  where external_change.player_id = participant.player_id
                    and external_match.counts_for_elo
                    and external_match.season_id <> season.id
                    and external_match.match_at > coalesce((
                      select max(previous_match.match_at)
                      from public.match_elo_changes as previous_change
                      join public.matches as previous_match on previous_match.id = previous_change.match_id
                      where previous_change.player_id = participant.player_id
                        and previous_match.season_id = season.id
                        and previous_match.counts_for_elo
                    ), season.starts_on::timestamp at time zone 'Europe/Berlin')
                    and external_match.match_at <= coalesce((
                      select max(final_match.match_at)
                      from public.matches as final_match
                      where final_match.season_id = season.id
                    ), season.completed_at)
                ), '[]'::jsonb)
              )
            where participant.end_elo is not null
          ) as event
        ), '[]'::jsonb)
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
        'matchAt', match.match_at,
        'result', match.result_details,
        'sets', match.actual_sets,
        'winner', match.winner,
        'displayLabel', match.display_label,
        'team1', jsonb_build_object(
          'playerIds', coalesce((select jsonb_agg(member.player_id order by member.position)
            from public.match_players as member where member.match_id = match.id and member.team = 1), '[]'::jsonb),
          'qualifierRanks', to_jsonb(match.team_one_qualifier_ranks),
          'qualifierLabels', to_jsonb(string_to_array(match.team_one_label, ' / '))
        ),
        'team2', jsonb_build_object(
          'playerIds', coalesce((select jsonb_agg(member.player_id order by member.position)
            from public.match_players as member where member.match_id = match.id and member.team = 2), '[]'::jsonb),
          'qualifierRanks', to_jsonb(match.team_two_qualifier_ranks),
          'qualifierLabels', to_jsonb(string_to_array(match.team_two_label, ' / '))
        )
      ) order by
        case match.competition_stage
          when 'league' then 1 when 'quarterfinal' then 2 when 'semifinal' then 3
          when 'final_four' then 4 else 5 end,
        match.matchday, match.id)
      from public.matches as match where match.season_id = season.id
    ), '[]'::jsonb)
  )
  from public.seasons as season where season.id = p_season_id;
$$;

create or replace function public.get_player_profile(p_player_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with selected_player as (
    select player.* from public.players as player where player.id = p_player_id
  ), career_source as (
    select history.*, private.profile_training_metrics(history.result_details) as training_metrics,
      private.profile_match_weight(history.kind, history.result_details) as match_weight
    from private.player_profile_match_rows as history
    where history.player_id = p_player_id
  ), career as (
    select source.*,
      case
        when source.kind <> 'training' then source.outcome
        when (source.training_metrics)[1] = 0 then 'unfinished'
        when (case when source.team = 1 then (source.training_metrics)[2] else (source.training_metrics)[3] end)
           = (case when source.team = 1 then (source.training_metrics)[3] else (source.training_metrics)[2] end) then 'draw'
        when (case when source.team = 1 then (source.training_metrics)[2] else (source.training_metrics)[3] end)
           > (case when source.team = 1 then (source.training_metrics)[3] else (source.training_metrics)[2] end) then 'win'
        else 'loss'
      end::text as weighted_outcome,
      case when source.kind = 'training'
        then (case when source.team = 1 then (source.training_metrics)[2] else (source.training_metrics)[3] end) * 0.5::numeric
        else case when source.outcome = 'win' then 1::numeric else 0::numeric end end as win_weight,
      case when source.kind = 'training'
        then (case when source.team = 1 then (source.training_metrics)[3] else (source.training_metrics)[2] end) * 0.5::numeric
        else case when source.outcome = 'loss' then 1::numeric else 0::numeric end end as loss_weight,
      case when source.kind = 'training'
        then case when source.team = 1 then (source.training_metrics)[4] else (source.training_metrics)[5] end
        else source.games_for end as weighted_games_for,
      case when source.kind = 'training'
        then case when source.team = 1 then (source.training_metrics)[5] else (source.training_metrics)[4] end
        else source.games_against end as weighted_games_against
    from career_source as source
  ), scored_career as (
    select * from career where match_weight > 0
  ), first_participation as (
    select participant.season_id, season.label, season.starts_on
    from public.season_players as participant
    join public.seasons as season on season.id = participant.season_id and season.counts_for_profile
    where participant.player_id = p_player_id
    order by season.starts_on nulls last, season.id
    limit 1
  ), elo_events as (
    select first_participation.season_id, first_participation.label as season_label,
      first_participation.starts_on::timestamp at time zone 'Europe/Berlin' as event_at,
      'Start'::text as label, player.initial_elo as elo, null::integer as old_elo,
      null::integer as delta, 'initial'::text as event_type, null::text as match_id
    from selected_player as player
    cross join first_participation
    where player.initial_elo is not null
    union all
    select match.season_id, season.label, match.match_at,
      coalesce(match.display_label, 'Partie ' || match.matchday), change.new_elo,
      change.old_elo, change.delta, 'match', match.id
    from public.match_elo_changes as change
    join public.matches as match on match.id = change.match_id and match.counts_for_elo
    join public.seasons as season on season.id = match.season_id and season.counts_for_profile
    where change.player_id = p_player_id
  ), ordered_elo as (
    select * from elo_events order by event_at nulls last, match_id nulls first
  )
  select case when exists (select 1 from selected_player) then jsonb_build_object(
    'identity', (select jsonb_build_object(
      'id', player.id, 'displayName', player.display_name,
      'initials', player.initials, 'company', player.company
    ) from selected_player as player),
    'summary', jsonb_build_object(
      'currentElo', coalesce(
        (select elo from ordered_elo order by event_at desc nulls last, match_id desc nulls last limit 1),
        (select initial_elo from selected_player)
      ),
      'peakElo', (select max(elo) from ordered_elo),
      'matches', coalesce((select sum(match_weight) from scored_career), 0),
      'wins', coalesce((select sum(win_weight) from scored_career), 0),
      'losses', coalesce((select sum(loss_weight) from scored_career), 0),
      'gamesFor', coalesce((select sum(weighted_games_for) from scored_career), 0),
      'gamesAgainst', coalesce((select sum(weighted_games_against) from scored_career), 0),
      'gameDiff', coalesce((select sum(weighted_games_for - weighted_games_against) from scored_career), 0)
    ),
    'eloSeries', coalesce((select jsonb_agg(jsonb_build_object(
      'eventType', event.event_type,
      'matchId', event.match_id,
      'seasonId', event.season_id,
      'seasonLabel', event.season_label,
      'matchAt', event.event_at,
      'date', (event.event_at at time zone 'Europe/Berlin')::date,
      'label', event.label,
      'oldElo', event.old_elo,
      'elo', event.elo,
      'delta', event.delta
    ) order by event.event_at nulls last, event.match_id nulls first)
      from ordered_elo as event), '[]'::jsonb),
    'participations', coalesce((select jsonb_agg(jsonb_build_object(
      'seasonId', stats.season_id, 'seasonLabel', stats.season_label, 'isActive', stats.is_active,
      'rank', stats.rank, 'matches', stats.matches, 'wins', stats.wins,
      'losses', stats.matches - stats.wins, 'points', stats.points,
      'gameDiff', stats.games_for - stats.games_against
    ) order by stats.is_active desc, stats.season_id desc)
      from private.season_player_statistics as stats where stats.player_id = p_player_id), '[]'::jsonb),
    'achievements', coalesce((select jsonb_agg(jsonb_build_object(
      'id', achievement.id, 'kind', achievement.kind, 'title', achievement.title,
      'subtitle', achievement.subtitle, 'achievedOn', achievement.achieved_on,
      'seasonId', achievement.season_id
    ) order by achievement.priority desc, achievement.achieved_on desc nulls last, achievement.id)
      from public.player_achievements as achievement
      left join public.seasons as season on season.id = achievement.season_id
      where achievement.player_id = p_player_id
        and (achievement.season_id is null or season.counts_for_profile)), '[]'::jsonb),
    'matches', coalesce((select jsonb_agg(jsonb_build_object(
      'id', history.row_id, 'kind', history.kind, 'matchWeight', history.match_weight,
      'winWeight', history.win_weight, 'lossWeight', history.loss_weight,
      'date', history.played_on, 'seasonId', history.season_id,
      'seasonLabel', history.season_label, 'resultDetails', history.result_details,
      'team', history.team, 'outcome', history.weighted_outcome,
      'isComplete', history.is_complete, 'trainingSessionId', history.training_session_id,
      'trainingRoundNumber', history.training_round_number,
      'partnerNames', to_jsonb(history.partner_names), 'opponentNames', to_jsonb(history.opponent_names)
    ) order by history.played_on desc nulls last, history.display_time desc nulls last,
      history.training_session_id desc nulls last, history.training_round_number asc nulls last, history.row_id desc)
      from career as history), '[]'::jsonb)
  ) else null end;
$$;

revoke execute on function public.schedule_match(text, timestamp without time zone) from public, anon;
grant execute on function public.schedule_match(text, timestamp without time zone) to authenticated;
revoke execute on function public.submit_match_result(text, text, text, smallint, timestamp without time zone) from public, anon;
grant execute on function public.submit_match_result(text, text, text, smallint, timestamp without time zone) to authenticated;
revoke execute on function public.get_my_result_tasks(text) from public, anon;
grant execute on function public.get_my_result_tasks(text) to authenticated;
revoke all on function public.get_public_seasons() from public;
grant execute on function public.get_public_seasons() to anon, authenticated;
revoke all on function public.get_public_season(text) from public;
grant execute on function public.get_public_season(text) to anon, authenticated;
revoke execute on function public.get_player_profile(text) from public;
grant execute on function public.get_player_profile(text) to anon, authenticated;

drop function if exists public.schedule_match(text, date, time);
drop function if exists public.submit_match_result(text, text, text, smallint, date, time);

alter table public.result_proposals
  drop column played_on,
  drop column played_time;

alter table public.matches
  drop column scheduled_date,
  drop column display_time,
  drop column lock_at;

do $$
begin
  if exists (
    (select match_id, player_id, old_elo, new_elo, delta from elo_changes_before_migration
      except
     select match_id, player_id, old_elo, new_elo, delta from public.match_elo_changes)
    union all
    (select match_id, player_id, old_elo, new_elo, delta from public.match_elo_changes
      except
     select match_id, player_id, old_elo, new_elo, delta from elo_changes_before_migration)
  ) then
    raise exception 'Die vorhandenen Elo-Änderungen wurden während der Migration verändert.';
  end if;
  if exists (
    (select match_id, player_id, team, position from official_match_players_before_migration
      except
     select match.id, member.player_id, member.team, member.position
     from public.matches as match
     join public.seasons as season
       on season.id = match.season_id
      and season.counts_for_profile
     join public.match_players as member on member.match_id = match.id
     where match.counts_for_elo
       and match.actual_sets is not null
       and match.winner is not null)
    union all
    (select match.id, member.player_id, member.team, member.position
     from public.matches as match
     join public.seasons as season
       on season.id = match.season_id
      and season.counts_for_profile
     join public.match_players as member on member.match_id = match.id
     where match.counts_for_elo
       and match.actual_sets is not null
       and match.winner is not null
      except
     select match_id, player_id, team, position from official_match_players_before_migration)
  ) then
    raise exception 'Offizielle Partien oder ihre Spielerzuordnungen wurden während der Migration verändert.';
  end if;
  if exists (
    (select season_id, player_id, start_elo from season_start_elos_before_migration
      except
     select season_id, player_id, start_elo from public.season_players)
    union all
    (select season_id, player_id, start_elo from public.season_players
      except
     select season_id, player_id, start_elo from season_start_elos_before_migration)
  ) then
    raise exception 'Die vorhandenen Saison-Start-Elo-Werte wurden während der Migration verändert.';
  end if;
end
$$;

notify pgrst, 'reload schema';

commit;
