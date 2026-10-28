begin;

do $$
declare
  updated_count integer;
begin
  update public.prediction_bonus_questions as question
  set
    label = case question.question_type
      when 'champion' then 'Wer wird der nächste Padel-Liga-Champion?'
      when 'league_winner' then 'Wer belegt nach der Ligaphase Platz 1?'
    end,
    explanation = case question.question_type
      when 'champion' then 'Gesucht ist der nächste Padel-Liga-Champion.'
      when 'league_winner' then 'Maßgeblich ist Platz 1 nach der abgeschlossenen Ligaphase.'
    end
  where question.season_id in ('2026', 'winter-2026')
    and question.question_type in ('champion', 'league_winner');

  get diagnostics updated_count = row_count;
  if updated_count <> 4 then
    raise exception 'Erwartet wurden 4 aktualisierte Bonusfragen, gefunden wurden %.', updated_count;
  end if;
end
$$;

commit;
