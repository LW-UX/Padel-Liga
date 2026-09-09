begin;

alter table public.seasons drop constraint if exists seasons_tournament_mode_check;
alter table public.seasons add constraint seasons_tournament_mode_check
  check (tournament_mode in ('none', 'direct_final_four', 'top8_semifinals', 'knockout_redraw'));

alter table public.matches drop constraint if exists matches_competition_stage_check;
alter table public.matches add constraint matches_competition_stage_check
  check (competition_stage in ('league', 'quarterfinal', 'semifinal', 'final_four', 'final'));

insert into public.seasons (
  id, label, title, starts_on, is_active, results_entry_enabled, counts_for_profile,
  organizations, short_info, elo_final_date, tournament_mode, qualification_places,
  home_ranking_limit, regular_schedule_locked, predictions_enabled
) values (
  'cup-2027',
  'Cup 2027',
  'Padel-Cup 2027',
  '2027-01-01',
  false,
  true,
  true,
  array['Headsquare', 'Hanako', 'Envidual'],
  array[
    '16 Teilnehmer starten direkt im Viertelfinale.',
    'Partner und Gegner werden vor jeder Runde neu ausgelost.',
    'Eine Partie hat 2 Gewinnsätze, bei 1:1 entscheidet der Match-Tie-Break bis 10 Punkte.',
    'Die beiden Spieler des siegreichen Finalteams gewinnen den Cup gemeinsam.'
  ],
  null,
  'knockout_redraw',
  0,
  4,
  true,
  false
)
on conflict (id) do update set
  label = excluded.label,
  title = excluded.title,
  starts_on = excluded.starts_on,
  is_active = excluded.is_active,
  results_entry_enabled = excluded.results_entry_enabled,
  counts_for_profile = excluded.counts_for_profile,
  organizations = excluded.organizations,
  short_info = excluded.short_info,
  elo_final_date = excluded.elo_final_date,
  tournament_mode = excluded.tournament_mode,
  qualification_places = excluded.qualification_places,
  home_ranking_limit = excluded.home_ranking_limit,
  regular_schedule_locked = excluded.regular_schedule_locked,
  predictions_enabled = excluded.predictions_enabled;

insert into public.leagues (season_id, id, label, is_default)
values ('cup-2027', 'main', 'Padel-Cup 2027', true)
on conflict (season_id, id) do update set
  label = excluded.label,
  is_default = excluded.is_default;

insert into public.season_matchdays (season_id, matchday, starts_on, ends_on, title) values
  ('cup-2027', 1, null, null, 'Viertelfinale'),
  ('cup-2027', 2, null, null, 'Halbfinale'),
  ('cup-2027', 3, null, null, 'Finale')
on conflict (season_id, matchday) do update set
  starts_on = excluded.starts_on,
  ends_on = excluded.ends_on,
  title = excluded.title;

insert into public.matches as existing (
  id, season_id, league_id, matchday, match_type, competition_stage, format,
  scheduled_date, display_time, lock_at, display_label,
  counts_for_ranking, counts_for_elo,
  team_one_label, team_two_label, result_details, actual_sets, winner,
  betting_open, team_one_qualifier_ranks, team_two_qualifier_ranks
) values
  ('cup-2027-quarterfinal-1','cup-2027','main',1,'final','quarterfinal','best-of-three',null,null,null,'Viertelfinale 1',false,true,'Teilnehmer 01 / Teilnehmer 02','Teilnehmer 03 / Teilnehmer 04',null,null,null,false,'{}','{}'),
  ('cup-2027-quarterfinal-2','cup-2027','main',1,'final','quarterfinal','best-of-three',null,null,null,'Viertelfinale 2',false,true,'Teilnehmer 05 / Teilnehmer 06','Teilnehmer 07 / Teilnehmer 08',null,null,null,false,'{}','{}'),
  ('cup-2027-quarterfinal-3','cup-2027','main',1,'final','quarterfinal','best-of-three',null,null,null,'Viertelfinale 3',false,true,'Teilnehmer 09 / Teilnehmer 10','Teilnehmer 11 / Teilnehmer 12',null,null,null,false,'{}','{}'),
  ('cup-2027-quarterfinal-4','cup-2027','main',1,'final','quarterfinal','best-of-three',null,null,null,'Viertelfinale 4',false,true,'Teilnehmer 13 / Teilnehmer 14','Teilnehmer 15 / Teilnehmer 16',null,null,null,false,'{}','{}'),
  ('cup-2027-semifinal-1','cup-2027','main',2,'final','semifinal','best-of-three',null,null,null,'Halbfinale 1',false,true,'Neu ausgelost / Neu ausgelost','Neu ausgelost / Neu ausgelost',null,null,null,false,'{}','{}'),
  ('cup-2027-semifinal-2','cup-2027','main',2,'final','semifinal','best-of-three',null,null,null,'Halbfinale 2',false,true,'Neu ausgelost / Neu ausgelost','Neu ausgelost / Neu ausgelost',null,null,null,false,'{}','{}'),
  ('cup-2027-final-1','cup-2027','main',3,'final','final','best-of-three',null,null,null,'Finale',false,true,'Neu ausgelost / Neu ausgelost','Neu ausgelost / Neu ausgelost',null,null,null,false,'{}','{}')
on conflict (id) do update set
  season_id = excluded.season_id,
  league_id = excluded.league_id,
  matchday = excluded.matchday,
  match_type = excluded.match_type,
  competition_stage = excluded.competition_stage,
  format = excluded.format,
  display_label = excluded.display_label,
  counts_for_ranking = excluded.counts_for_ranking,
  counts_for_elo = excluded.counts_for_elo,
  betting_open = existing.betting_open,
  team_one_label = case when exists (select 1 from public.match_players where match_id = existing.id) then existing.team_one_label else excluded.team_one_label end,
  team_two_label = case when exists (select 1 from public.match_players where match_id = existing.id) then existing.team_two_label else excluded.team_two_label end,
  team_one_qualifier_ranks = excluded.team_one_qualifier_ranks,
  team_two_qualifier_ranks = excluded.team_two_qualifier_ranks;

notify pgrst, 'reload schema';

commit;
