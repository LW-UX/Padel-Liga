do $$
declare
  stored_sets text;
begin
  select actual_sets
  into stored_sets
  from public.matches
  where id = 'season-2026-partie-25';

  if not found then
    raise exception 'Partie 25 wurde nicht gefunden.';
  end if;

  if stored_sets is not null and stored_sets <> '2:0' then
    raise exception 'Partie 25 besitzt bereits das abweichende Ergebnis %.', stored_sets;
  end if;

  update public.matches
  set
    result_details = '6:3, 6:3',
    actual_sets = '2:0',
    winner = 1,
    betting_open = false
  where id = 'season-2026-partie-25';
end;
$$;
