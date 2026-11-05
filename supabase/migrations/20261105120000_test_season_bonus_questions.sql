begin;

-- Die Test-Saison führt Firmen und Kurzinfos wie alle anderen Saisons in der Datenbank.
-- Die Firmen entsprechen den Firmen der Testteilnehmer, damit die Firmenfrage beantwort- und auswertbar ist.
update public.seasons
set organizations = array['Test', 'Envidual'],
    short_info = array[
      'Diese Saison dient ausschließlich zum Testen der neuen Ergebnis- und Bestätigungsabläufe.',
      'Ein Spieler trägt das Ergebnis ein, ein Spieler des gegnerischen Teams bestätigt oder macht einen Gegenvorschlag.',
      'Bestätigte Ergebnisse aktualisieren Rangliste und isoliertes Test-Elo automatisch.'
    ]
where id = 'test-2026';

-- Dieselben sechs Bonusfragen wie Winter 2026; Tippschluss am 1. November 2026 um 12:00 Uhr.
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
  '2026-11-01 12:00:00 Europe/Berlin'::timestamptz,
  question.sort_order
from public.seasons as season
cross join (values
  ('test-2026-bonus-final-four', 'final_four_players',
    'Welche vier Spieler erreichen das Final Four?', 'Wähle bis zu vier Spieler.', 4::smallint, 1::smallint),
  ('test-2026-bonus-champion', 'champion',
    'Wer wird der nächste PadelLiga-Champion?', 'Gesucht ist der nächste PadelLiga-Champion.', 1::smallint, 2::smallint),
  ('test-2026-bonus-elo', 'league_elo_gain',
    'Wer hat den größten Elo-Zuwachs?', 'Es zählt nur die reguläre Ligaphase.', 1::smallint, 3::smallint),
  ('test-2026-bonus-league-winner', 'league_winner',
    'Wer belegt nach der Ligaphase Platz 1?', 'Maßgeblich ist Platz 1 nach der abgeschlossenen Ligaphase.', 1::smallint, 4::smallint),
  ('test-2026-bonus-game-difference', 'league_game_difference',
    'Wer erreicht die beste Spiel-Differenz?', 'Es zählt nur die reguläre Ligaphase.', 1::smallint, 5::smallint),
  ('test-2026-bonus-company', 'company_winner',
    'Welche Firma gewinnt nach Ø-Punkten je Teilnehmer?', 'Entscheidend sind die Ø-Punkte je Saisonteilnehmer.', 1::smallint, 6::smallint)
) as question(id, question_type, label, explanation, max_selections, sort_order)
where season.id = 'test-2026'
on conflict (season_id, question_type) do update set
  label = excluded.label,
  explanation = excluded.explanation,
  max_selections = excluded.max_selections,
  points_per_correct = excluded.points_per_correct,
  lock_at = excluded.lock_at,
  sort_order = excluded.sort_order;

commit;
