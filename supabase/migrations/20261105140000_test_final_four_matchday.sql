begin;

-- Die drei Final-Four-Partien der Test-Saison stehen wie bei Winter 2026 auf Spieltag 8
-- mit dem Titel „Final Four“ ohne Zeitfenster statt unter Spieltag 3 und heißen „Final Four 1–3“.
insert into public.season_matchdays (season_id, matchday, starts_on, ends_on, title)
values ('test-2026', 8, null, null, 'Final Four')
on conflict (season_id, matchday) do update set
  starts_on = excluded.starts_on,
  ends_on = excluded.ends_on,
  title = excluded.title;

update public.matches as match
set matchday = 8,
    display_label = 'Final Four ' || substring(match.id from '([0-9]+)$')
where match.season_id = 'test-2026'
  and match.competition_stage = 'final_four'
  and match.id in ('test-2026-live-1', 'test-2026-live-2', 'test-2026-live-3');

commit;
