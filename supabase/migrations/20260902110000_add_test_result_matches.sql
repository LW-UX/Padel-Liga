begin;

insert into public.matches (
  id, season_id, league_id, matchday, scheduled_date, display_time, lock_at,
  team_one_label, team_two_label, betting_open
) values
  ('test-2026-partie-5', 'test-2026', 'main', 3, '2026-08-24', '18.00', '2026-08-24 18:00:00+02', 'Ludi GMX / Ludwig W.', 'Ludi Gmail / Agnes K.', true),
  ('test-2026-partie-6', 'test-2026', 'main', 3, '2026-08-26', '18.00', '2026-08-26 18:00:00+02', 'Ludi Gmail / Greta P.', 'Ludi GMX / Raphael H.', true),
  ('test-2026-partie-7', 'test-2026', 'main', 3, '2026-08-28', '18.00', '2026-08-28 18:00:00+02', 'Ludi GMX / Luca W.', 'Ludi Gmail / Lukas P.', true),
  ('test-2026-partie-8', 'test-2026', 'main', 4, '2026-12-08', '18.00', '2026-12-08 18:00:00+01', 'Ludi Gmail / Ludwig W.', 'Ludi GMX / Greta P.', true),
  ('test-2026-partie-9', 'test-2026', 'main', 4, '2026-12-10', '18.00', '2026-12-10 18:00:00+01', 'Ludi GMX / Raphael H.', 'Ludi Gmail / Luca W.', true),
  ('test-2026-partie-10', 'test-2026', 'main', 4, '2026-12-15', '18.00', '2026-12-15 18:00:00+01', 'Ludi Gmail / Agnes K.', 'Ludi GMX / Lukas P.', true)
on conflict (id) do update set
  season_id = excluded.season_id,
  league_id = excluded.league_id,
  matchday = excluded.matchday,
  scheduled_date = excluded.scheduled_date,
  display_time = excluded.display_time,
  lock_at = excluded.lock_at,
  team_one_label = excluded.team_one_label,
  team_two_label = excluded.team_two_label,
  betting_open = excluded.betting_open;

insert into public.match_players (match_id, player_id, team, position) values
  ('test-2026-partie-5', 'ludi_gmx', 1, 1),
  ('test-2026-partie-5', 'ludwig_w', 1, 2),
  ('test-2026-partie-5', 'ludi_gmail', 2, 1),
  ('test-2026-partie-5', 'agnes_k', 2, 2),
  ('test-2026-partie-6', 'ludi_gmail', 1, 1),
  ('test-2026-partie-6', 'greta_p', 1, 2),
  ('test-2026-partie-6', 'ludi_gmx', 2, 1),
  ('test-2026-partie-6', 'raphael_h', 2, 2),
  ('test-2026-partie-7', 'ludi_gmx', 1, 1),
  ('test-2026-partie-7', 'luca_w', 1, 2),
  ('test-2026-partie-7', 'ludi_gmail', 2, 1),
  ('test-2026-partie-7', 'lukas_p', 2, 2),
  ('test-2026-partie-8', 'ludi_gmail', 1, 1),
  ('test-2026-partie-8', 'ludwig_w', 1, 2),
  ('test-2026-partie-8', 'ludi_gmx', 2, 1),
  ('test-2026-partie-8', 'greta_p', 2, 2),
  ('test-2026-partie-9', 'ludi_gmx', 1, 1),
  ('test-2026-partie-9', 'raphael_h', 1, 2),
  ('test-2026-partie-9', 'ludi_gmail', 2, 1),
  ('test-2026-partie-9', 'luca_w', 2, 2),
  ('test-2026-partie-10', 'ludi_gmail', 1, 1),
  ('test-2026-partie-10', 'agnes_k', 1, 2),
  ('test-2026-partie-10', 'ludi_gmx', 2, 1),
  ('test-2026-partie-10', 'lukas_p', 2, 2)
on conflict (match_id, player_id) do update set
  team = excluded.team,
  position = excluded.position;

commit;
