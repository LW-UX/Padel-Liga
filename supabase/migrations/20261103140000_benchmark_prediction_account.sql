begin;

-- Benchmark-Konten tippen automatisch nach der Auto-Tipp-Regel aus js/elo-forecast.js.
-- Sie werden selbst gewertet, beeinflussen aber weder die passive Gutschrift eigener Partien
-- noch die öffentliche Tippverteilung oder das Podium. Die Kennung ist nicht vom Konto änderbar,
-- weil authenticated nur display_name aktualisieren darf.
alter table public.profiles
  add column if not exists is_benchmark boolean not null default false;

-- „Hanako L“ ist das Vergleichskonto für alle anderen Tipper.
update public.profiles
set is_benchmark = true
where id = '5ccfedb7-52ad-4b86-825b-227905102162'
  and player_id is null;

create or replace function private.is_benchmark_account(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select profile.is_benchmark
    from public.profiles as profile
    where profile.id = p_user_id
  ), false);
$$;
revoke all on function private.is_benchmark_account(uuid) from public, anon, authenticated;

-- Aktuelle Elo wie currentElo in public.get_public_season, die die Tippseite anzeigt.
create or replace function private.get_benchmark_player_elo(p_player_id text, p_season_id text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select change.new_elo
    from public.match_elo_changes as change
    join public.matches as current_match on current_match.id = change.match_id
    join public.seasons as current_season
      on current_season.id = current_match.season_id
     and current_season.counts_for_profile
    where change.player_id = p_player_id
      and current_match.counts_for_elo
    order by current_match.match_at desc, current_match.id desc
    limit 1
  ), (
    select player.initial_elo
    from public.players as player
    where player.id = p_player_id
  ), (
    select participant.start_elo
    from public.season_players as participant
    where participant.player_id = p_player_id
      and participant.season_id = p_season_id
  ));
$$;
revoke all on function private.get_benchmark_player_elo(text, text) from public, anon, authenticated;

-- Entspricht getAutoTipForecast: Teamstärke 70 % schwächerer und 30 % stärkerer Spieler,
-- Favorit ab 54 % glatt (2:0), darunter knapp (2:1); im Ein-Satz-Format 6:0 bis 6:4.
create or replace function private.get_benchmark_auto_tip(p_match_id text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_match record;
  team_one_elos numeric[];
  team_two_elos numeric[];
  team_one_elo numeric;
  team_two_elo numeric;
  team_one_probability integer;
  team_two_probability integer;
  favorite integer;
  winner smallint;
  loser_games integer;
begin
  select match.id, match.season_id, match.format into selected_match
  from public.matches as match
  where match.id = p_match_id;
  if not found then return null; end if;

  select
    array_agg(private.get_benchmark_player_elo(member.player_id, selected_match.season_id))
      filter (where member.team = 1),
    array_agg(private.get_benchmark_player_elo(member.player_id, selected_match.season_id))
      filter (where member.team = 2)
  into team_one_elos, team_two_elos
  from public.match_players as member
  where member.match_id = p_match_id;

  if coalesce(cardinality(team_one_elos), 0) <> 2
    or coalesce(cardinality(team_two_elos), 0) <> 2
    or array_position(team_one_elos || team_two_elos, null) is not null then
    return null;
  end if;

  team_one_elo := least(team_one_elos[1], team_one_elos[2]) * 0.7
    + greatest(team_one_elos[1], team_one_elos[2]) * 0.3;
  team_two_elo := least(team_two_elos[1], team_two_elos[2]) * 0.7
    + greatest(team_two_elos[1], team_two_elos[2]) * 0.3;
  team_one_probability := round((
    100 / (1 + power(10::double precision, ((team_two_elo - team_one_elo) / 500)::double precision))
  )::numeric)::integer;
  team_two_probability := 100 - team_one_probability;

  winner := case
    when team_one_probability > team_two_probability then 1
    when team_two_probability > team_one_probability then 2
    when greatest(team_two_elos[1], team_two_elos[2]) > greatest(team_one_elos[1], team_one_elos[2]) then 2
    else 1
  end;
  favorite := greatest(team_one_probability, team_two_probability);

  if selected_match.format = 'single-set' then
    loser_games := case
      when favorite >= 80 then 0
      when favorite >= 70 then 1
      when favorite >= 63 then 2
      when favorite >= 58 then 3
      else 4
    end;
    return case when winner = 1 then '6:' || loser_games else loser_games || ':6' end;
  end if;

  return case
    when favorite >= 54 and winner = 1 then '2:0'
    when favorite >= 54 then '0:2'
    when winner = 1 then '2:1'
    else '1:2'
  end;
end;
$$;
revoke all on function private.get_benchmark_auto_tip(text) from public, anon, authenticated;

-- Setzt oder aktualisiert die Benchmark-Tipps aller Partien, die nach den Tipp-Policies offen sind.
-- Bis zum Tippschluss folgt der Tipp damit immer der aktuellen Elo-Prognose.
create or replace function private.sync_benchmark_predictions(p_match_id text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_count integer;
begin
  insert into public.predictions(user_id, match_id, prediction)
  select profile.id, match.id, tip.prediction
  from public.profiles as profile
  cross join public.matches as match
  join public.seasons as season
    on season.id = match.season_id
   and season.predictions_enabled
  cross join lateral (select private.get_benchmark_auto_tip(match.id) as prediction) as tip
  where profile.is_benchmark
    and profile.player_id is null
    and (p_match_id is null or match.id = p_match_id)
    and match.betting_open
    and match.cancelled_at is null
    and match.winner is null
    and match.actual_sets is null
    and (match.match_at is null or match.match_at > now())
    and (match.competition_stage = 'league' or match.match_at is not null)
    and tip.prediction is not null
  on conflict (user_id, match_id) do update
    set prediction = excluded.prediction,
        updated_at = now()
    where public.predictions.prediction is distinct from excluded.prediction;

  get diagnostics changed_count = row_count;
  return changed_count;
end;
$$;
revoke all on function private.sync_benchmark_predictions(text) from public, anon, authenticated;

-- Sofortiger Tipp beim Veröffentlichen oder Umterminieren; ein Fehler darf die Partieänderung nie blockieren.
create or replace function private.sync_benchmark_prediction_for_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform private.sync_benchmark_predictions(new.id);
  exception when others then
    raise warning 'Benchmark-Tipp für % konnte nicht gesetzt werden: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function private.sync_benchmark_prediction_for_match() from public, anon, authenticated;

drop trigger if exists matches_sync_benchmark_prediction on public.matches;
create trigger matches_sync_benchmark_prediction
after update of betting_open, match_at on public.matches
for each row
when (
  new.betting_open
  and (old.betting_open is distinct from new.betting_open or old.match_at is distinct from new.match_at)
)
execute function private.sync_benchmark_prediction_for_match();

-- Nachführen nach Elo-Änderungen, Teamauslosungen und neu angelegten Partien.
select cron.schedule(
  'sync-benchmark-predictions',
  '*/10 * * * *',
  $cron$select private.sync_benchmark_predictions();$cron$
);

select private.sync_benchmark_predictions();

-- Passive Gutschrift: Der schlechteste Fremdtipp wird ohne Benchmark-Tipps ermittelt.
create or replace function private.get_prediction_leaderboard_rows(p_season_id text)
returns table (
  user_id uuid,
  display_name text,
  is_player boolean,
  predictions_count bigint,
  scored_count bigint,
  exact_count bigint,
  tendency_count bigint,
  passive_count bigint,
  bonus_points bigint,
  points bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with prediction_scores as (
    select
      prediction.user_id,
      prediction.match_id,
      prediction.prediction,
      match.actual_sets,
      case when match.format = 'single-set'
        then replace(substring(match.result_details from '([0-9]+\s*:\s*[0-9]+)'), ' ', '')
        else match.actual_sets
      end as actual_value,
      case when match.format = 'single-set'
        then split_part(prediction.prediction, ':', 1)::integer > split_part(prediction.prediction, ':', 2)::integer
        else prediction.prediction in ('2:0', '2:1')
      end as predicted_team_one,
      case when match.format = 'single-set'
        then split_part(replace(substring(match.result_details from '([0-9]+\s*:\s*[0-9]+)'), ' ', ''), ':', 1)::integer
          > split_part(replace(substring(match.result_details from '([0-9]+\s*:\s*[0-9]+)'), ' ', ''), ':', 2)::integer
        else match.actual_sets in ('2:0', '2:1')
      end as actual_team_one
    from public.predictions as prediction
    join public.matches as match on match.id = prediction.match_id
    where match.season_id = p_season_id
      and match.cancelled_at is null
      and not exists (
        select 1
        from public.profiles as own_profile
        join public.match_players as own_member on own_member.player_id = own_profile.player_id
        where own_profile.id = prediction.user_id
          and own_member.match_id = prediction.match_id
      )
  ), scored_predictions as (
    select
      prediction_scores.*,
      case
        when actual_sets is null then null
        when prediction = actual_value then 4
        when predicted_team_one = actual_team_one then 2
        else 0
      end::bigint as awarded_points
    from prediction_scores
  ), match_floor as (
    select match_id, min(awarded_points)::bigint as awarded_points
    from scored_predictions
    where awarded_points is not null
      and not private.is_benchmark_account(user_id)
    group by match_id
  ), leaderboard_entries as (
    select
      scored.user_id,
      scored.match_id,
      true as is_prediction,
      scored.awarded_points is not null as is_scored,
      scored.awarded_points = 4 and scored.prediction = scored.actual_value as is_exact,
      scored.awarded_points = 2 as is_tendency,
      false as is_passive,
      coalesce(scored.awarded_points, 0)::bigint as awarded_points
    from scored_predictions as scored

    union all

    select
      profile.id,
      floor.match_id,
      false,
      true,
      false,
      false,
      true,
      floor.awarded_points
    from match_floor as floor
    join public.match_players as member on member.match_id = floor.match_id
    join public.profiles as profile on profile.player_id = member.player_id
  ), match_totals as (
    select
      entry.user_id,
      count(entry.match_id) filter (where entry.is_prediction) as predictions_count,
      count(entry.match_id) filter (where entry.is_scored) as scored_count,
      count(entry.match_id) filter (where entry.is_exact) as exact_count,
      count(entry.match_id) filter (where entry.is_tendency) as tendency_count,
      count(entry.match_id) filter (where entry.is_passive) as passive_count,
      sum(entry.awarded_points)::bigint as points
    from leaderboard_entries as entry
    group by entry.user_id
  ), bonus_results as materialized (
    select * from private.get_prediction_bonus_results(p_season_id)
  ), bonus_totals as (
    select
      selection.user_id,
      count(distinct selection.question_id)::bigint as predictions_count,
      coalesce(sum(case
        when result.resolved and selection.answer = any(result.correct_answers)
          then question.points_per_correct
        else 0
      end), 0)::bigint as bonus_points
    from public.prediction_bonus_selections as selection
    join public.prediction_bonus_questions as question on question.id = selection.question_id
    join bonus_results as result on result.question_type = question.question_type
    where question.season_id = p_season_id
    group by selection.user_id
  ), leaderboard_users as (
    select user_id from match_totals
    union
    select user_id from bonus_totals
  )
  select
    profile.id,
    profile.display_name,
    profile.player_id is not null,
    coalesce(match_totals.predictions_count, 0) + coalesce(bonus_totals.predictions_count, 0),
    coalesce(match_totals.scored_count, 0),
    coalesce(match_totals.exact_count, 0),
    coalesce(match_totals.tendency_count, 0),
    coalesce(match_totals.passive_count, 0),
    coalesce(bonus_totals.bonus_points, 0),
    coalesce(match_totals.points, 0) + coalesce(bonus_totals.bonus_points, 0)
  from leaderboard_users
  join public.profiles as profile on profile.id = leaderboard_users.user_id
  left join match_totals on match_totals.user_id = leaderboard_users.user_id
  left join bonus_totals on bonus_totals.user_id = leaderboard_users.user_id;
$$;

revoke all on function private.get_prediction_leaderboard_rows(text) from public;
revoke all on function private.get_prediction_leaderboard_rows(text) from anon, authenticated;

-- Die Rangliste liefert die Benchmark-Kennung; das Vorjahres-Podium ignoriert Benchmark-Konten.
drop function public.get_prediction_leaderboard(text);

create function public.get_prediction_leaderboard(p_season_id text)
returns table (
  user_id uuid,
  display_name text,
  is_player boolean,
  is_benchmark boolean,
  company text,
  previous_prediction_winner boolean,
  previous_prediction_season_label text,
  previous_prediction_rank integer,
  predictions_count bigint,
  scored_count bigint,
  exact_count bigint,
  tendency_count bigint,
  passive_count bigint,
  bonus_points bigint,
  points bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with current_season as (
    select season.starts_on
    from public.seasons as season
    where season.id = p_season_id
  ), previous_league_season as (
    select season.id, season.label
    from public.seasons as season
    cross join current_season
    where season.id <> p_season_id
      and season.completed_at is not null
      and season.counts_for_profile
      and season.visual_theme <> 'cup'
      and (current_season.starts_on is null or season.starts_on < current_season.starts_on)
    order by season.starts_on desc nulls last, season.completed_at desc, season.id
    limit 1
  ), previous_prediction_winner as (
    select
      previous_entry.user_id,
      previous_season.label as season_label,
      (row_number() over (
        order by
          previous_entry.points desc,
          previous_entry.exact_count desc,
          previous_entry.tendency_count desc,
          previous_entry.display_name asc,
          previous_entry.user_id
      ))::integer as final_rank
    from previous_league_season as previous_season
    cross join lateral private.get_prediction_leaderboard_rows(previous_season.id) as previous_entry
    where not private.is_benchmark_account(previous_entry.user_id)
    order by final_rank
    limit 3
  )
  select
    current_entry.user_id,
    current_entry.display_name,
    current_entry.is_player,
    coalesce(profile.is_benchmark, false),
    case when coalesce(profile.is_benchmark, false) then null else coalesce(player.company, profile.company) end,
    coalesce(previous_winner.final_rank = 1, false),
    previous_winner.season_label,
    previous_winner.final_rank,
    current_entry.predictions_count,
    current_entry.scored_count,
    current_entry.exact_count,
    current_entry.tendency_count,
    current_entry.passive_count,
    current_entry.bonus_points,
    current_entry.points
  from private.get_prediction_leaderboard_rows(p_season_id) as current_entry
  left join public.profiles as profile on profile.id = current_entry.user_id
  left join public.players as player on player.id = profile.player_id
  left join previous_prediction_winner as previous_winner
    on previous_winner.user_id = current_entry.user_id
  order by
    current_entry.points desc,
    current_entry.exact_count desc,
    current_entry.tendency_count desc,
    current_entry.display_name asc;
$$;

revoke all on function public.get_prediction_leaderboard(text) from public;
revoke all on function public.get_prediction_leaderboard(text) from anon, authenticated;
grant execute on function public.get_prediction_leaderboard(text) to anon, authenticated;

create or replace function public.get_prediction_match_floors(p_season_id text)
returns table (
  match_id text,
  prediction text,
  awarded_points bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with prediction_scores as (
    select
      prediction.match_id,
      prediction.prediction,
      case when match.format = 'single-set'
        then replace(substring(match.result_details from '([0-9]+\s*:\s*[0-9]+)'), ' ', '')
        else match.actual_sets
      end as actual_value,
      case when match.format = 'single-set'
        then split_part(prediction.prediction, ':', 1)::integer > split_part(prediction.prediction, ':', 2)::integer
        else prediction.prediction in ('2:0', '2:1')
      end as predicted_team_one,
      case when match.format = 'single-set'
        then split_part(replace(substring(match.result_details from '([0-9]+\s*:\s*[0-9]+)'), ' ', ''), ':', 1)::integer
          > split_part(replace(substring(match.result_details from '([0-9]+\s*:\s*[0-9]+)'), ' ', ''), ':', 2)::integer
        else match.actual_sets in ('2:0', '2:1')
      end as actual_team_one
    from public.predictions as prediction
    join public.matches as match on match.id = prediction.match_id
    where match.season_id = p_season_id
      and match.cancelled_at is null
      and match.actual_sets is not null
      and not private.is_benchmark_account(prediction.user_id)
      and not exists (
        select 1
        from public.profiles as own_profile
        join public.match_players as own_member on own_member.player_id = own_profile.player_id
        where own_profile.id = prediction.user_id
          and own_member.match_id = prediction.match_id
      )
  ), scored_predictions as (
    select
      match_id,
      prediction,
      case
        when prediction = actual_value then 4
        when predicted_team_one = actual_team_one then 2
        else 0
      end::bigint as awarded_points
    from prediction_scores
  ), match_floor as (
    select match_id, min(awarded_points)::bigint as awarded_points
    from scored_predictions
    group by match_id
  )
  select distinct scored.match_id, scored.prediction, scored.awarded_points
  from scored_predictions as scored
  join match_floor as floor
    on floor.match_id = scored.match_id
   and floor.awarded_points = scored.awarded_points
  order by scored.match_id, scored.prediction;
$$;

revoke all on function public.get_prediction_match_floors(text) from public;
grant execute on function public.get_prediction_match_floors(text) to anon, authenticated;

create or replace function public.get_prediction_overview(p_season_id text)
returns table (
  user_id uuid,
  item_type text,
  item_id text,
  prediction text,
  answers text[],
  is_tipped boolean,
  points integer,
  is_passive boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with prediction_scores as (
    select
      prediction.user_id,
      prediction.match_id,
      prediction.prediction,
      match.actual_sets,
      match.cancelled_at,
      match.actual_sets is not null
        or match.cancelled_at is not null
        or (match.match_at is not null and match.match_at <= now()) as is_visible,
      case when match.format = 'single-set'
        then replace(substring(match.result_details from '([0-9]+\s*:\s*[0-9]+)'), ' ', '')
        else match.actual_sets
      end as actual_value,
      case when match.format = 'single-set'
        then split_part(prediction.prediction, ':', 1)::integer > split_part(prediction.prediction, ':', 2)::integer
        else prediction.prediction in ('2:0', '2:1')
      end as predicted_team_one,
      case when match.format = 'single-set'
        then split_part(replace(substring(match.result_details from '([0-9]+\s*:\s*[0-9]+)'), ' ', ''), ':', 1)::integer
          > split_part(replace(substring(match.result_details from '([0-9]+\s*:\s*[0-9]+)'), ' ', ''), ':', 2)::integer
        else match.actual_sets in ('2:0', '2:1')
      end as actual_team_one
    from public.predictions as prediction
    join public.matches as match on match.id = prediction.match_id
    where match.season_id = p_season_id
      and not exists (
        select 1
        from public.profiles as own_profile
        join public.match_players as own_member on own_member.player_id = own_profile.player_id
        where own_profile.id = prediction.user_id
          and own_member.match_id = prediction.match_id
      )
  ), scored_predictions as (
    select
      prediction_scores.*,
      case
        when cancelled_at is not null or actual_sets is null then null
        when prediction = actual_value then 4
        when predicted_team_one = actual_team_one then 2
        else 0
      end::integer as awarded_points
    from prediction_scores
  ), match_floor as (
    select match_id, min(awarded_points)::integer as awarded_points
    from scored_predictions
    where awarded_points is not null
      and not private.is_benchmark_account(user_id)
    group by match_id
  ), bonus_results as materialized (
    select * from private.get_prediction_bonus_results(p_season_id)
  ), bonus_entries as (
    select
      selection.user_id,
      question.id as question_id,
      now() >= question.lock_at as is_visible,
      coalesce(result.resolved, false) as resolved,
      array_agg(selection.answer order by selection.answer) as answers,
      (count(*) filter (
        where coalesce(result.resolved, false)
          and selection.answer = any(result.correct_answers)
      ) * question.points_per_correct)::integer as awarded_points
    from public.prediction_bonus_selections as selection
    join public.prediction_bonus_questions as question on question.id = selection.question_id
    left join bonus_results as result on result.question_type = question.question_type
    where question.season_id = p_season_id
    group by selection.user_id, question.id, question.lock_at, question.points_per_correct, result.resolved
  )
  select
    scored.user_id,
    'match',
    scored.match_id,
    case when scored.is_visible then scored.prediction end,
    null::text[],
    true,
    case when scored.is_visible then scored.awarded_points end,
    false
  from scored_predictions as scored

  union all

  select
    profile.id,
    'match',
    floor.match_id,
    null,
    null::text[],
    false,
    floor.awarded_points,
    true
  from match_floor as floor
  join public.match_players as member on member.match_id = floor.match_id
  join public.profiles as profile on profile.player_id = member.player_id

  union all

  select
    bonus.user_id,
    'bonus',
    bonus.question_id,
    null,
    case when bonus.is_visible then bonus.answers end,
    true,
    case when bonus.is_visible and bonus.resolved then bonus.awarded_points end,
    false
  from bonus_entries as bonus;
$$;

revoke all on function public.get_prediction_overview(text) from public;
grant execute on function public.get_prediction_overview(text) to anon, authenticated;

-- Öffentliche Tippverteilung und Rückschau-Hinweis zählen nur echte Tipper.
create or replace function private.get_match_forecast_state(
  p_match_id text,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_match record;
  selected_season record;
  selected_mode text;
  selected_prediction text;
  selected_vote smallint;
  team_one_votes integer;
  team_two_votes integer;
  total_votes integer;
  team_one_percentage integer;
  team_two_percentage integer;
  test_mode boolean;
  lone_winner_name text;
begin
  select match.* into selected_match
  from public.matches as match
  where match.id = p_match_id;
  if not found then return null; end if;

  select season.* into selected_season
  from public.seasons as season
  where season.id = selected_match.season_id;
  if not found then return null; end if;

  test_mode := not selected_season.counts_for_profile
    and selected_season.id in ('test-2026', '2026-test');
  selected_mode := private.match_forecast_mode(p_match_id);
  if selected_mode is null then return null; end if;

  select
    count(*) filter (where prediction.prediction in ('2:0', '2:1'))::integer,
    count(*) filter (where prediction.prediction in ('1:2', '0:2'))::integer
  into team_one_votes, team_two_votes
  from public.predictions as prediction
  where prediction.match_id = p_match_id
    and not private.is_benchmark_account(prediction.user_id);

  team_one_votes := coalesce(team_one_votes, 0);
  team_two_votes := coalesce(team_two_votes, 0);
  total_votes := team_one_votes + team_two_votes;
  team_one_percentage := case
    when total_votes = 0 then 0
    else round(team_one_votes * 100.0 / total_votes)::integer
  end;
  team_two_percentage := case
    when total_votes = 0 then 0
    else 100 - team_one_percentage
  end;

  -- Rückschau: Hat nur ein Tipper das Siegerteam getippt, alle anderen aber das Verliererteam,
  -- wird dessen Kontoname geliefert. Voraussetzung sind mindestens fünf abgegebene Tipps.
  if selected_mode = 'analysis' and total_votes >= 5
    and selected_match.actual_sets in ('2:0', '2:1', '1:2', '0:2') then
    if selected_match.actual_sets in ('2:0', '2:1') and team_one_votes = 1 then
      select profile.display_name into lone_winner_name
      from public.predictions as prediction
      join public.profiles as profile on profile.id = prediction.user_id
      where prediction.match_id = p_match_id
        and not private.is_benchmark_account(prediction.user_id)
        and prediction.prediction in ('2:0', '2:1');
    elsif selected_match.actual_sets in ('1:2', '0:2') and team_two_votes = 1 then
      select profile.display_name into lone_winner_name
      from public.predictions as prediction
      join public.profiles as profile on profile.id = prediction.user_id
      where prediction.match_id = p_match_id
        and not private.is_benchmark_account(prediction.user_id)
        and prediction.prediction in ('1:2', '0:2');
    end if;
  end if;

  if p_user_id is not null then
    select prediction.prediction into selected_prediction
    from public.predictions as prediction
    where prediction.match_id = p_match_id
      and prediction.user_id = p_user_id;
  end if;

  selected_vote := case
    when selected_prediction in ('2:0', '2:1') then 1
    when selected_prediction in ('1:2', '0:2') then 2
    else null
  end;

  return jsonb_build_object(
    'matchId', selected_match.id,
    'mode', selected_mode,
    'open', selected_mode = 'preview'
      and selected_match.betting_open
      and (selected_season.predictions_enabled or test_mode)
      and selected_match.winner is null
      and selected_match.actual_sets is null
      and (selected_match.match_at is null or selected_match.match_at > now()),
    'totalVotes', total_votes,
    'team1Percentage', team_one_percentage,
    'team2Percentage', team_two_percentage,
    'userVote', selected_vote,
    'userPrediction', selected_prediction,
    'loneWinnerTipper', lone_winner_name
  );
end;
$$;

notify pgrst, 'reload schema';

commit;
