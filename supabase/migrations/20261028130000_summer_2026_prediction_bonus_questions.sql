begin;

insert into public.prediction_bonus_questions (
  id,
  season_id,
  question_type,
  label,
  explanation,
  max_selections,
  points_per_correct,
  lock_at,
  sort_order
)
select
  question.id,
  season.id,
  question.question_type,
  question.label,
  question.explanation,
  question.max_selections,
  4,
  '2026-05-24T22:00:00Z'::timestamptz,
  question.sort_order
from public.seasons as season
cross join (values
  ('summer-2026-bonus-champion', 'champion',
    'Wer gewinnt die Liga nach dem Final Four?', 'Gesucht ist der Champion nach dem Final Four.', 1::smallint, 1::smallint),
  ('summer-2026-bonus-final-four', 'final_four_players',
    'Welche vier Spieler erreichen das Final Four?', 'Gesucht sind die vier sportlichen Qualifikanten.', 4::smallint, 2::smallint),
  ('summer-2026-bonus-league-winner', 'league_winner',
    'Wer belegt nach sechs Spieltagen Platz 1?', 'Maßgeblich ist die abgeschlossene Ligatabelle.', 1::smallint, 3::smallint),
  ('summer-2026-bonus-game-difference', 'league_game_difference',
    'Wer hat die beste Spiel-Differenz?', 'Es zählt nur die reguläre Ligaphase.', 1::smallint, 4::smallint),
  ('summer-2026-bonus-elo', 'league_elo_gain',
    'Wer hat den größten Elo-Zuwachs?', 'Es zählt nur die reguläre Ligaphase.', 1::smallint, 5::smallint),
  ('summer-2026-bonus-company', 'company_winner',
    'Welche Firma gewinnt nach Ø-Punkten je Teilnehmer?', 'Entscheidend sind die Ø-Punkte je Saisonteilnehmer.', 1::smallint, 6::smallint)
) as question(id, question_type, label, explanation, max_selections, sort_order)
where season.id = '2026'
on conflict (season_id, question_type) do update set
  label = excluded.label,
  explanation = excluded.explanation,
  max_selections = excluded.max_selections,
  points_per_correct = excluded.points_per_correct,
  lock_at = excluded.lock_at,
  sort_order = excluded.sort_order;

alter function private.get_prediction_bonus_results(text)
  rename to get_prediction_bonus_results_without_direct_final_four;

create function private.get_prediction_bonus_results(p_season_id text)
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
  with base_results as materialized (
    select *
    from private.get_prediction_bonus_results_without_direct_final_four(p_season_id)
  ), semifinal_status as (
    select count(*)::integer as match_count
    from public.matches as match
    where match.season_id = p_season_id
      and match.competition_stage = 'semifinal'
  ), direct_qualification as (
    select
      count(distinct achievement.player_id) = 4 as complete,
      coalesce(
        array_agg(distinct achievement.player_id order by achievement.player_id),
        '{}'::text[]
      ) as correct_answers
    from public.player_achievements as achievement
    where achievement.season_id = p_season_id
      and achievement.kind in ('winner', 'final_four')
  ), base_final_four as (
    select result.resolved, result.correct_answers
    from base_results as result
    where result.question_type = 'final_four_players'
  )
  select result.question_type, result.resolved, result.correct_answers
  from base_results as result
  where result.question_type <> 'final_four_players'

  union all

  select
    'final_four_players'::text,
    case
      when semifinal_status.match_count > 0 then base_final_four.resolved
      else direct_qualification.complete
    end,
    case
      when semifinal_status.match_count > 0 then base_final_four.correct_answers
      when direct_qualification.complete then direct_qualification.correct_answers
      else '{}'::text[]
    end
  from semifinal_status
  cross join direct_qualification
  cross join base_final_four;
$$;

revoke all on function private.get_prediction_bonus_results(text)
  from public, anon, authenticated;

do $$
begin
  if (
    select count(*)
    from public.prediction_bonus_questions as question
    where question.season_id = '2026'
  ) <> 6 then
    raise exception 'Die sechs Bonustipps für Sommer 2026 konnten nicht vollständig angelegt werden.';
  end if;

  if not (
    select result.resolved
    from private.get_prediction_bonus_results('2026') as result
    where result.question_type = 'final_four_players'
  ) then
    raise exception 'Die Final-Four-Qualifikation von Sommer 2026 konnte nicht aufgelöst werden.';
  end if;
end;
$$;

commit;
