begin;

-- Ludwig W. plays here with a real account, so calendar mail can also be checked
-- in a mailbox that is not one of the internal test addresses.
insert into public.matches (
  id,
  season_id,
  league_id,
  matchday,
  match_type,
  competition_stage,
  format,
  match_at,
  display_label,
  counts_for_ranking,
  counts_for_elo,
  team_one_label,
  team_two_label,
  betting_open
) values (
  'test-2026-partie-10',
  'test-2026',
  'main',
  5,
  'season',
  'league',
  'best-of-three',
  null,
  null,
  true,
  true,
  'Test GMX / Test Ionos',
  'Test Gmail / Ludwig W.',
  true
);

insert into public.match_players (match_id, player_id, team, position) values
  ('test-2026-partie-10', 'ludi_gmx', 1, 1),
  ('test-2026-partie-10', 'ludi_ionos', 1, 2),
  ('test-2026-partie-10', 'ludi_gmail', 2, 1),
  ('test-2026-partie-10', 'ludwig_w', 2, 2);

commit;
