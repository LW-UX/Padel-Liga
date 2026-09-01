alter table public.seasons
  add column if not exists counts_for_profile boolean not null default true,
  add column if not exists organizations text[] not null default '{}',
  add column if not exists short_info text[] not null default '{}',
  add column if not exists elo_final_date date;

update public.seasons
set counts_for_profile = false
where id = 'test-2026';

create table if not exists public.season_matchdays (
  season_id text not null references public.seasons(id) on delete cascade,
  matchday integer not null check (matchday > 0),
  starts_on date,
  ends_on date,
  title text,
  primary key (season_id, matchday),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

alter table public.matches
  add column if not exists display_label text,
  add column if not exists counts_for_ranking boolean not null default true,
  add column if not exists counts_for_elo boolean not null default true,
  add column if not exists team_one_qualifier_ranks smallint[] not null default '{}',
  add column if not exists team_two_qualifier_ranks smallint[] not null default '{}';

create table if not exists public.player_achievements (
  id bigint generated always as identity primary key,
  player_id text not null references public.players(id) on delete cascade,
  season_id text,
  league_id text,
  kind text not null check (kind in ('winner', 'final_four', 'custom')),
  title text not null check (char_length(trim(title)) between 2 and 80),
  subtitle text check (subtitle is null or char_length(trim(subtitle)) <= 120),
  achieved_on date,
  priority integer not null default 0,
  created_at timestamptz not null default now(),
  foreign key (season_id, league_id) references public.leagues(season_id, id) on delete set null
);

create index if not exists player_achievements_player_idx
  on public.player_achievements(player_id, priority desc, achieved_on desc nulls last, id);

alter table public.season_matchdays enable row level security;
alter table public.player_achievements enable row level security;

drop policy if exists "Season matchdays are public" on public.season_matchdays;
create policy "Season matchdays are public"
  on public.season_matchdays for select to anon, authenticated using (true);

drop policy if exists "Player achievements are public" on public.player_achievements;
create policy "Player achievements are public"
  on public.player_achievements for select to anon, authenticated using (true);

revoke all on public.season_matchdays, public.player_achievements from anon, authenticated;
grant select on public.season_matchdays, public.player_achievements to anon, authenticated;

create or replace function private.profile_regular_game_totals(p_result_details text)
returns integer[]
language sql
immutable
set search_path = ''
as $$
  with scores as (
    select
      (capture)[1]::integer as team_one,
      (capture)[2]::integer as team_two
    from regexp_matches(
      regexp_replace(coalesce(p_result_details, ''), '\([^)]*\)', '', 'g'),
      '([0-9]+)\s*:\s*([0-9]+)',
      'g'
    ) as score(capture)
  )
  select array[
    coalesce(sum(team_one) filter (where team_one <= 7 and team_two <= 7), 0)::integer,
    coalesce(sum(team_two) filter (where team_one <= 7 and team_two <= 7), 0)::integer
  ]
  from scores;
$$;

create or replace function private.profile_set_win_totals(
  p_result_details text,
  p_set_count integer
)
returns integer[]
language sql
immutable
set search_path = ''
as $$
  with scores as (
    select
      (capture)[1]::integer as team_one,
      (capture)[2]::integer as team_two,
      ordinality
    from regexp_matches(
      regexp_replace(coalesce(p_result_details, ''), '\([^)]*\)', '', 'g'),
      '([0-9]+)\s*:\s*([0-9]+)',
      'g'
    ) with ordinality as score(capture, ordinality)
  )
  select array[
    count(*) filter (where team_one > team_two and ordinality <= p_set_count)::integer,
    count(*) filter (where team_two > team_one and ordinality <= p_set_count)::integer
  ]
  from scores;
$$;

create or replace view private.player_profile_match_rows as
select
  member.player_id,
  match.id as row_id,
  'league'::text as kind,
  match.scheduled_date as played_on,
  match.display_time,
  match.season_id,
  season.label as season_label,
  member.team,
  match.result_details,
  case when match.winner = member.team then 'win' else 'loss' end::text as outcome,
  coalesce((
    select array_agg(player.display_name order by teammate.position)
    from public.match_players as teammate
    join public.players as player on player.id = teammate.player_id
    where teammate.match_id = match.id
      and teammate.team = member.team
      and teammate.player_id <> member.player_id
  ), '{}')::text[] as partner_names,
  coalesce((
    select array_agg(player.display_name order by opponent.position)
    from public.match_players as opponent
    join public.players as player on player.id = opponent.player_id
    where opponent.match_id = match.id
      and opponent.team <> member.team
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
  match.counts_for_ranking
from public.matches as match
join public.seasons as season
  on season.id = match.season_id
 and season.counts_for_profile
join public.match_players as member on member.match_id = match.id
where match.actual_sets is not null
  and match.winner is not null
  and match.match_type in ('season', 'final')

union all

select
  participant.player_id,
  'training-' || session.id || '-' || round.round_number as row_id,
  'training'::text as kind,
  session.played_on,
  to_char(session.display_time, 'HH24.MI') as display_time,
  null::text as season_id,
  'Training'::text as season_label,
  case when participant.player_id = any(round.team_one_ids) then 1 else 2 end::smallint as team,
  round.result_details,
  case
    when (private.profile_set_win_totals(round.result_details, round.set_count))[1]
       = (private.profile_set_win_totals(round.result_details, round.set_count))[2] then 'draw'
    when participant.player_id = any(round.team_one_ids)
      then case when (private.profile_set_win_totals(round.result_details, round.set_count))[1]
                   > (private.profile_set_win_totals(round.result_details, round.set_count))[2]
                then 'win' else 'loss' end
    else case when (private.profile_set_win_totals(round.result_details, round.set_count))[2]
                 > (private.profile_set_win_totals(round.result_details, round.set_count))[1]
              then 'win' else 'loss' end
  end::text as outcome,
  coalesce((
    select array_agg(player.display_name order by member.ordinality)
    from unnest(case
      when participant.player_id = any(round.team_one_ids) then round.team_one_ids
      else round.team_two_ids
    end) with ordinality as member(player_id, ordinality)
    join public.players as player on player.id = member.player_id
    where member.player_id <> participant.player_id
  ), '{}')::text[] as partner_names,
  coalesce((
    select array_agg(player.display_name order by member.ordinality)
    from unnest(case
      when participant.player_id = any(round.team_one_ids) then round.team_two_ids
      else round.team_one_ids
    end) with ordinality as member(player_id, ordinality)
    join public.players as player on player.id = member.player_id
  ), '{}')::text[] as opponent_names,
  case when participant.player_id = any(round.team_one_ids)
    then (private.profile_regular_game_totals(round.result_details))[1]
    else (private.profile_regular_game_totals(round.result_details))[2]
  end as games_for,
  case when participant.player_id = any(round.team_one_ids)
    then (private.profile_regular_game_totals(round.result_details))[2]
    else (private.profile_regular_game_totals(round.result_details))[1]
  end as games_against,
  0 as points,
  false as counts_for_ranking
from public.training_sessions as session
join public.training_rounds as round on round.session_id = session.id
cross join lateral unnest(session.player_ids) as participant(player_id)
where session.status = 'confirmed';

create or replace view private.season_player_statistics as
with aggregate_stats as (
  select
    participant.season_id,
    participant.league_id,
    participant.player_id,
    player.display_name,
    season.label as season_label,
    season.is_active,
    count(history.row_id) filter (where history.counts_for_ranking)::integer as matches,
    count(history.row_id) filter (where history.counts_for_ranking and history.outcome = 'win')::integer as wins,
    coalesce(sum(history.points) filter (where history.counts_for_ranking), 0)::integer as points,
    coalesce(sum(history.games_for) filter (where history.counts_for_ranking), 0)::integer as games_for,
    coalesce(sum(history.games_against) filter (where history.counts_for_ranking), 0)::integer as games_against
  from public.season_players as participant
  join public.seasons as season
    on season.id = participant.season_id
   and season.counts_for_profile
  join public.players as player on player.id = participant.player_id
  left join private.player_profile_match_rows as history
    on history.player_id = participant.player_id
   and history.season_id = participant.season_id
  group by participant.season_id, participant.league_id, participant.player_id,
    player.display_name, season.label, season.is_active
)
select
  aggregate_stats.*,
  row_number() over (
    partition by season_id, league_id
    order by points desc, (games_for - games_against) desc, games_for desc, display_name
  )::integer as rank
from aggregate_stats;

create or replace function public.get_public_seasons()
returns table (
  id text,
  label text,
  title text,
  starts_on date,
  is_active boolean,
  results_entry_enabled boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select season.id, season.label, season.title, season.starts_on,
    season.is_active, season.results_entry_enabled
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
    'eloFinalDate', season.elo_final_date,
    'organizations', to_jsonb(season.organizations),
    'shortInfo', to_jsonb(season.short_info),
    'resultsEntryEnabled', season.results_entry_enabled,
    'leagues', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', league.id,
        'label', league.label,
        'default', league.is_default
      ) order by league.is_default desc, league.id)
      from public.leagues as league
      where league.season_id = season.id
    ), '[]'::jsonb),
    'matchdays', coalesce((
      select jsonb_agg(jsonb_build_object(
        'spieltag', matchday.matchday,
        'startDate', matchday.starts_on,
        'endDate', matchday.ends_on,
        'title', matchday.title
      ) order by matchday.matchday)
      from public.season_matchdays as matchday
      where matchday.season_id = season.id
    ), '[]'::jsonb),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'playerId', participant.player_id,
        'leagueId', participant.league_id,
        'startElo', participant.start_elo
      ) order by player.display_name)
      from public.season_players as participant
      join public.players as player on player.id = participant.player_id
      where participant.season_id = season.id
    ), '[]'::jsonb),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', match.id,
        'type', 'season',
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
            from public.match_players as member
            where member.match_id = match.id and member.team = 1
          ), '[]'::jsonb),
          'qualifierRanks', to_jsonb(match.team_one_qualifier_ranks)
        ),
        'team2', jsonb_build_object(
          'playerIds', coalesce((
            select jsonb_agg(member.player_id order by member.position)
            from public.match_players as member
            where member.match_id = match.id and member.team = 2
          ), '[]'::jsonb),
          'qualifierRanks', to_jsonb(match.team_two_qualifier_ranks)
        )
      ) order by match.matchday, match.id)
      from public.matches as match
      where match.season_id = season.id
    ), '[]'::jsonb)
  )
  from public.seasons as season
  where season.id = p_season_id;
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
  ), career as (
    select * from private.player_profile_match_rows as history
    where history.player_id = p_player_id
  ), elo_events as (
    select
      participant.season_id,
      season.label as season_label,
      season.starts_on as event_date,
      null::text as display_time,
      'Start'::text as label,
      participant.start_elo as elo,
      0 as event_order
    from public.season_players as participant
    join public.seasons as season
      on season.id = participant.season_id
     and season.counts_for_profile
    where participant.player_id = p_player_id
    union all
    select
      match.season_id,
      season.label,
      match.scheduled_date,
      match.display_time,
      coalesce(match.display_label, 'Partie ' || match.matchday),
      change.new_elo,
      1
    from public.match_elo_changes as change
    join public.matches as match on match.id = change.match_id and match.counts_for_elo
    join public.seasons as season on season.id = match.season_id and season.counts_for_profile
    where change.player_id = p_player_id
  ), ordered_elo as (
    select * from elo_events
    order by event_date nulls last, display_time nulls last, event_order, label
  )
  select case when exists (select 1 from selected_player) then jsonb_build_object(
    'identity', (
      select jsonb_build_object(
        'id', player.id,
        'displayName', player.display_name,
        'initials', player.initials,
        'company', player.company
      ) from selected_player as player
    ),
    'summary', jsonb_build_object(
      'currentElo', (select elo from ordered_elo order by event_date desc nulls last, display_time desc nulls last, event_order desc limit 1),
      'peakElo', (select max(elo) from ordered_elo),
      'matches', (select count(*) from career),
      'wins', (select count(*) from career where outcome = 'win'),
      'losses', (select count(*) from career where outcome = 'loss'),
      'gamesFor', coalesce((select sum(games_for) from career), 0),
      'gamesAgainst', coalesce((select sum(games_against) from career), 0),
      'gameDiff', coalesce((select sum(games_for - games_against) from career), 0)
    ),
    'eloSeries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'seasonId', event.season_id,
        'seasonLabel', event.season_label,
        'date', event.event_date,
        'label', event.label,
        'elo', event.elo
      ) order by event.event_date nulls last, event.display_time nulls last, event.event_order, event.label)
      from ordered_elo as event
    ), '[]'::jsonb),
    'participations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'seasonId', stats.season_id,
        'seasonLabel', stats.season_label,
        'isActive', stats.is_active,
        'rank', stats.rank,
        'matches', stats.matches,
        'wins', stats.wins,
        'losses', stats.matches - stats.wins,
        'points', stats.points,
        'gameDiff', stats.games_for - stats.games_against
      ) order by stats.is_active desc, stats.season_id desc)
      from private.season_player_statistics as stats
      where stats.player_id = p_player_id
    ), '[]'::jsonb),
    'achievements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', achievement.id,
        'kind', achievement.kind,
        'title', achievement.title,
        'subtitle', achievement.subtitle,
        'achievedOn', achievement.achieved_on,
        'seasonId', achievement.season_id
      ) order by achievement.priority desc, achievement.achieved_on desc nulls last, achievement.id)
      from public.player_achievements as achievement
      left join public.seasons as season on season.id = achievement.season_id
      where achievement.player_id = p_player_id
        and (achievement.season_id is null or season.counts_for_profile)
    ), '[]'::jsonb),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', history.row_id,
        'kind', history.kind,
        'date', history.played_on,
        'seasonId', history.season_id,
        'seasonLabel', history.season_label,
        'resultDetails', history.result_details,
        'team', history.team,
        'outcome', history.outcome,
        'partnerNames', to_jsonb(history.partner_names),
        'opponentNames', to_jsonb(history.opponent_names)
      ) order by history.played_on desc nulls last, history.display_time desc nulls last, history.row_id desc)
      from career as history
    ), '[]'::jsonb)
  ) else null end;
$$;

revoke all on function public.get_public_seasons() from public;
revoke all on function public.get_public_season(text) from public;
revoke all on function public.get_player_profile(text) from public;
grant execute on function public.get_public_seasons() to anon, authenticated;
grant execute on function public.get_public_season(text) to anon, authenticated;
grant execute on function public.get_player_profile(text) to anon, authenticated;
