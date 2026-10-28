begin;

create table public.prediction_bonus_questions (
  id text primary key,
  season_id text not null references public.seasons(id) on update cascade on delete cascade,
  question_type text not null check (question_type in (
    'final_four_players', 'champion', 'league_elo_gain',
    'league_winner', 'league_game_difference', 'company_winner'
  )),
  label text not null,
  explanation text,
  max_selections smallint not null check (max_selections between 1 and 4),
  points_per_correct smallint not null default 4 check (points_per_correct > 0),
  lock_at timestamptz not null,
  sort_order smallint not null check (sort_order > 0),
  created_at timestamptz not null default now(),
  unique (season_id, question_type),
  unique (season_id, sort_order)
);

create table public.prediction_bonus_selections (
  question_id text not null references public.prediction_bonus_questions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  answer text not null check (char_length(trim(answer)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (question_id, user_id, answer)
);

create index prediction_bonus_selections_user_idx
  on public.prediction_bonus_selections(user_id, question_id);

create trigger prediction_bonus_selections_set_updated_at
before update on public.prediction_bonus_selections
for each row execute function private.set_updated_at();

alter table public.prediction_bonus_questions enable row level security;
alter table public.prediction_bonus_selections enable row level security;
revoke all on public.prediction_bonus_questions from public, anon, authenticated;
revoke all on public.prediction_bonus_selections from public, anon, authenticated;

insert into public.prediction_bonus_questions (
  id, season_id, question_type, label, explanation,
  max_selections, points_per_correct, lock_at, sort_order
)
select
  question.id,
  season.id,
  question.question_type,
  question.label,
  question.explanation,
  question.max_selections,
  4,
  '2026-11-16 00:00:00 Europe/Berlin'::timestamptz,
  question.sort_order
from (
  select id
  from public.seasons
  where id in ('2026-winter', 'winter-2026')
  order by (id = '2026-winter') desc
  limit 1
) as season
cross join (values
  ('winter-2026-bonus-final-four', 'final_four_players',
    'Welche vier Spieler erreichen das Final Four?', 'Wähle bis zu vier Spieler.', 4::smallint, 1::smallint),
  ('winter-2026-bonus-champion', 'champion',
    'Wer gewinnt die Liga?', 'Gesucht ist der Champion nach dem Final Four.', 1::smallint, 2::smallint),
  ('winter-2026-bonus-elo', 'league_elo_gain',
    'Wer hat den größten Elo-Zuwachs?', 'Es zählt nur die reguläre Ligaphase.', 1::smallint, 3::smallint),
  ('winter-2026-bonus-league-winner', 'league_winner',
    'Wer gewinnt die reguläre Ligaphase?', 'Maßgeblich ist Platz 1 nach sechs Spieltagen.', 1::smallint, 4::smallint),
  ('winter-2026-bonus-game-difference', 'league_game_difference',
    'Wer erreicht die beste Spiel-Differenz?', 'Es zählt nur die reguläre Ligaphase.', 1::smallint, 5::smallint),
  ('winter-2026-bonus-company', 'company_winner',
    'Welche Firma gewinnt die Firmenrangliste?', 'Entscheidend sind die Ø Punkte je Saisonteilnehmer.', 1::smallint, 6::smallint)
) as question(id, question_type, label, explanation, max_selections, sort_order)
on conflict (season_id, question_type) do update set
  label = excluded.label,
  explanation = excluded.explanation,
  max_selections = excluded.max_selections,
  points_per_correct = excluded.points_per_correct,
  lock_at = excluded.lock_at,
  sort_order = excluded.sort_order;

do $$
begin
  if (
    select count(*)
    from public.prediction_bonus_questions as question
    where question.season_id in ('2026-winter', 'winter-2026')
  ) <> 6 then
    raise exception 'Die sechs Bonustipps für Winter 2026 konnten nicht vollständig angelegt werden.';
  end if;
end;
$$;

create or replace function private.get_prediction_bonus_results(p_season_id text)
returns table (
  question_type text,
  resolved boolean,
  correct_answers text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with default_league as (
    select league.id
    from public.leagues as league
    where league.season_id = p_season_id
    order by league.is_default desc, league.id
    limit 1
  ), league_status as (
    select
      count(*) > 0
      and bool_and(match.actual_sets is not null or match.cancelled_at is not null) as complete
    from public.matches as match
    where match.season_id = p_season_id
      and match.competition_stage = 'league'
  ), league_stats as (
    select
      stats.player_id,
      stats.points,
      stats.games_for,
      stats.games_against,
      stats.games_for - stats.games_against as game_difference
    from private.season_player_statistics as stats
    where stats.season_id = p_season_id
      and stats.league_id = (select id from default_league)
  ), league_ranking as (
    select
      league_stats.*,
      dense_rank() over (
        order by points desc, game_difference desc, games_for desc
      ) as position
    from league_stats
  ), difference_ranking as (
    select
      league_stats.*,
      dense_rank() over (order by game_difference desc) as position
    from league_stats
  ), league_elo_values as (
    select
      participant.player_id,
      coalesce(sum(change.delta) filter (where match.id is not null), 0)::integer as elo_gain
    from public.season_players as participant
    left join public.match_elo_changes as change on change.player_id = participant.player_id
    left join public.matches as match
      on match.id = change.match_id
     and match.season_id = participant.season_id
     and match.competition_stage = 'league'
     and match.counts_for_elo
    where participant.season_id = p_season_id
      and participant.league_id = (select id from default_league)
    group by participant.player_id
  ), league_elo_ranking as (
    select
      league_elo_values.*,
      dense_rank() over (order by elo_gain desc) as position
    from league_elo_values
  ), company_values as (
    select
      player.company,
      sum(stats.points)::numeric / count(*)::numeric as average_points,
      sum(stats.games_for - stats.games_against)::integer as game_difference
    from league_stats as stats
    join public.players as player on player.id = stats.player_id
    group by player.company
  ), company_ranking as (
    select
      company_values.*,
      dense_rank() over (
        order by average_points desc, game_difference desc
      ) as position
    from company_values
  ), final_four_values as (
    select
      finalist.player_id,
      finalist.league_rank,
      count(*) filter (where match.winner = member.team)::integer as wins,
      coalesce(sum(case member.team
        when 1 then score.team_one
        else score.team_two
      end), 0)::integer as games_won,
      coalesce(sum(case member.team
        when 1 then score.team_one - score.team_two
        else score.team_two - score.team_one
      end), 0)::integer as game_difference
    from public.season_tournament_players as finalist
    join public.match_players as member on member.player_id = finalist.player_id
    join public.matches as match
      on match.id = member.match_id
     and match.season_id = finalist.season_id
     and match.competition_stage = 'final_four'
    cross join lateral (
      select
        (score_parts.capture)[1]::integer as team_one,
        (score_parts.capture)[2]::integer as team_two
      from regexp_matches(match.result_details, '([0-9]+)\s*:\s*([0-9]+)', 'g')
        as score_parts(capture)
      limit 1
    ) as score
    where finalist.season_id = p_season_id
      and finalist.stage = 'final_four'
    group by finalist.player_id, finalist.league_rank
  ), final_four_ranking as (
    select
      final_four_values.*,
      dense_rank() over (
        order by wins desc, game_difference desc, games_won desc, league_rank, player_id
      ) as position
    from final_four_values
  ), semifinal_status as (
    select
      count(*) = 2
      and count(*) filter (where match.actual_sets is not null and match.winner is not null) = 2 as complete
    from public.matches as match
    where match.season_id = p_season_id
      and match.competition_stage = 'semifinal'
  ), final_four_status as (
    select
      count(*) = 3
      and count(*) filter (where match.actual_sets is not null and match.winner is not null) = 3 as complete
    from public.matches as match
    where match.season_id = p_season_id
      and match.competition_stage = 'final_four'
  )
  select
    'final_four_players'::text,
    semifinal_status.complete,
    case when semifinal_status.complete then coalesce((
      select array_agg(member.player_id order by match.id, member.position)
      from public.matches as match
      join public.match_players as member
        on member.match_id = match.id
       and member.team = match.winner
      where match.season_id = p_season_id
        and match.competition_stage = 'semifinal'
    ), '{}'::text[]) else '{}'::text[] end
  from semifinal_status

  union all

  select
    'champion'::text,
    final_four_status.complete,
    case when final_four_status.complete then coalesce((
      select array_agg(player_id order by player_id)
      from final_four_ranking
      where position = 1
    ), '{}'::text[]) else '{}'::text[] end
  from final_four_status

  union all

  select
    'league_elo_gain'::text,
    league_status.complete,
    case when league_status.complete then coalesce((
      select array_agg(player_id order by player_id)
      from league_elo_ranking
      where position = 1
    ), '{}'::text[]) else '{}'::text[] end
  from league_status

  union all

  select
    'league_winner'::text,
    league_status.complete,
    case when league_status.complete then coalesce((
      select array_agg(player_id order by player_id)
      from league_ranking
      where position = 1
    ), '{}'::text[]) else '{}'::text[] end
  from league_status

  union all

  select
    'league_game_difference'::text,
    league_status.complete,
    case when league_status.complete then coalesce((
      select array_agg(player_id order by player_id)
      from difference_ranking
      where position = 1
    ), '{}'::text[]) else '{}'::text[] end
  from league_status

  union all

  select
    'company_winner'::text,
    league_status.complete,
    case when league_status.complete then coalesce((
      select array_agg(company order by company)
      from company_ranking
      where position = 1
    ), '{}'::text[]) else '{}'::text[] end
  from league_status;
$$;

revoke all on function private.get_prediction_bonus_results(text)
  from public, anon, authenticated;

create or replace function public.get_prediction_bonus_state(p_season_id text)
returns table (
  question_id text,
  question_type text,
  label text,
  explanation text,
  max_selections smallint,
  points_per_correct smallint,
  lock_at timestamptz,
  sort_order smallint,
  is_open boolean,
  resolved boolean,
  answers text[],
  correct_answers text[],
  points integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with results as materialized (
    select * from private.get_prediction_bonus_results(p_season_id)
  )
  select
    question.id,
    question.question_type,
    question.label,
    question.explanation,
    question.max_selections,
    question.points_per_correct,
    question.lock_at,
    question.sort_order,
    now() < question.lock_at,
    coalesce(result.resolved, false),
    coalesce((
      select array_agg(selection.answer order by selection.answer)
      from public.prediction_bonus_selections as selection
      where selection.question_id = question.id
        and selection.user_id = (select auth.uid())
    ), '{}'::text[]),
    case when coalesce(result.resolved, false)
      then coalesce(result.correct_answers, '{}'::text[])
      else '{}'::text[]
    end,
    case when coalesce(result.resolved, false) then coalesce((
      select count(*)::integer * question.points_per_correct
      from public.prediction_bonus_selections as selection
      where selection.question_id = question.id
        and selection.user_id = (select auth.uid())
        and selection.answer = any(result.correct_answers)
    ), 0) else 0 end
  from public.prediction_bonus_questions as question
  left join results as result on result.question_type = question.question_type
  where question.season_id = p_season_id
  order by question.sort_order;
$$;

revoke all on function public.get_prediction_bonus_state(text) from public;
grant execute on function public.get_prediction_bonus_state(text) to anon, authenticated;

create or replace function public.save_prediction_bonus_answers(
  p_question_id text,
  p_answers text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  selected_question public.prediction_bonus_questions%rowtype;
  cleaned_answers text[];
begin
  if current_user_id is null then
    raise exception 'Bitte zuerst einloggen.';
  end if;
  if not private.user_email_is_confirmed(current_user_id) then
    raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen.';
  end if;

  select question.* into selected_question
  from public.prediction_bonus_questions as question
  where question.id = p_question_id
  for update;

  if not found then raise exception 'Diese Bonusfrage existiert nicht.'; end if;
  if now() >= selected_question.lock_at then
    raise exception 'Der Tippschluss für diese Bonusfrage ist erreicht.';
  end if;

  select coalesce(array_agg(answer order by input_order), '{}'::text[])
  into cleaned_answers
  from (
    select trim(value) as answer, input_order
    from unnest(coalesce(p_answers, '{}'::text[])) with ordinality as input(value, input_order)
    where nullif(trim(value), '') is not null
  ) as normalized;

  if cardinality(cleaned_answers) <> (
    select count(distinct answer)
    from unnest(cleaned_answers) as submitted(answer)
  ) then
    raise exception 'Eine Antwort darf nicht mehrfach ausgewählt werden.';
  end if;

  if cardinality(cleaned_answers) > selected_question.max_selections then
    raise exception 'Für diese Bonusfrage sind höchstens % Antworten erlaubt.', selected_question.max_selections;
  end if;

  if selected_question.question_type = 'company_winner' then
    if exists (
      select 1
      from unnest(cleaned_answers) as answer(value)
      where not exists (
        select 1
        from public.seasons as season
        where season.id = selected_question.season_id
          and answer.value = any(season.organizations)
      )
    ) then raise exception 'Diese Firma gehört nicht zur Saison.'; end if;
  elsif exists (
    select 1
    from unnest(cleaned_answers) as answer(value)
    where not exists (
      select 1
      from public.season_players as participant
      where participant.season_id = selected_question.season_id
        and participant.player_id = answer.value
    )
  ) then
    raise exception 'Dieser Spieler gehört nicht zur Saison.';
  end if;

  delete from public.prediction_bonus_selections as selection
  where selection.question_id = selected_question.id
    and selection.user_id = current_user_id;

  insert into public.prediction_bonus_selections (question_id, user_id, answer)
  select selected_question.id, current_user_id, answer.value
  from unnest(cleaned_answers) as answer(value);
end;
$$;

revoke all on function public.save_prediction_bonus_answers(text, text[]) from public;
grant execute on function public.save_prediction_bonus_answers(text, text[]) to authenticated;

drop function public.get_prediction_leaderboard(text);

create function public.get_prediction_leaderboard(p_season_id text)
returns table (
  user_id uuid,
  display_name text,
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
    coalesce(match_totals.predictions_count, 0),
    coalesce(match_totals.scored_count, 0),
    coalesce(match_totals.exact_count, 0),
    coalesce(match_totals.tendency_count, 0),
    coalesce(match_totals.passive_count, 0),
    coalesce(bonus_totals.bonus_points, 0),
    coalesce(match_totals.points, 0) + coalesce(bonus_totals.bonus_points, 0)
  from leaderboard_users
  join public.profiles as profile on profile.id = leaderboard_users.user_id
  left join match_totals on match_totals.user_id = leaderboard_users.user_id
  left join bonus_totals on bonus_totals.user_id = leaderboard_users.user_id
  order by
    coalesce(match_totals.points, 0) + coalesce(bonus_totals.bonus_points, 0) desc,
    coalesce(match_totals.exact_count, 0) desc,
    coalesce(match_totals.tendency_count, 0) desc,
    profile.display_name asc;
$$;

revoke all on function public.get_prediction_leaderboard(text) from public;
revoke all on function public.get_prediction_leaderboard(text) from anon, authenticated;
grant execute on function public.get_prediction_leaderboard(text) to anon, authenticated;

commit;
