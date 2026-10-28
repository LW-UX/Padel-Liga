update public.prediction_bonus_questions
set
  label = 'Welche Firma gewinnt nach Ø-Punkten je Teilnehmer?',
  explanation = 'Entscheidend sind die Ø-Punkte je Saisonteilnehmer.'
where question_type = 'company_winner'
  and season_id in ('2026-winter', 'winter-2026');
