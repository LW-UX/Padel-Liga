begin;

-- Die frühe Test-Vorgeschichtspartie heißt in der Oberfläche „Partie 0“ statt „Statistik-Vorgeschichte“.
update public.matches
set display_label = 'Partie 0'
where id = 'test-2026-statistics-history'
  and season_id = 'test-2026';

commit;
