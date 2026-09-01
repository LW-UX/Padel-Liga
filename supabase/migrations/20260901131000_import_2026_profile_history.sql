insert into public.players (id, display_name, initials, company) values
  ('agnes_k','Agnes K.','AK','Headsquare'),
  ('andreas_l','Andreas L.','AL','Headsquare'),
  ('chris_m','Chris M.','ChM','Envidual'),
  ('christoph_l','Christoph L.','CL','Headsquare'),
  ('cristian_b','Cristian B.','CB','Hanako'),
  ('florian_z','Florian Z.','FZ','Hanako'),
  ('greta_p','Greta P.','GP','Hanako'),
  ('irene_w','Irene W.','IW','Headsquare'),
  ('jonas_l','Jonas L.','JL','Envidual'),
  ('leonie_r','Leonie R.','LR','Hanako'),
  ('luca_w','Luca W.','LW','Envidual'),
  ('ludwig_w','Ludwig W.','LuW','Envidual'),
  ('lukas_p','Lukas P.','LP','Headsquare'),
  ('marcel_m','Marcel M.','MzM','Envidual'),
  ('marco_m','Marco M.','MaMay','Headsquare'),
  ('martin_b','Martin B.','MB','Headsquare'),
  ('niklas_k','Niklas K.','NK','Hanako'),
  ('raphael_h','Raphael H.','RH','Headsquare')
on conflict (id) do update set
  display_name = excluded.display_name,
  initials = excluded.initials,
  company = excluded.company;

insert into public.seasons (
  id, label, title, starts_on, is_active, counts_for_profile,
  organizations, short_info, elo_final_date
) values (
  '2026',
  'Sommer 2026',
  'Padel-Liga Sommer 2026',
  '2026-05-11',
  true,
  true,
  array['Headsquare', 'Hanako', 'Envidual'],
  array[
    'Jeder Teilnehmer hat 6 Partien.',
    'Partner und Gegner werden jede Partie neu gelost.',
    'Es gibt kein fixes Datum, sondern Zeitfenster. Die Spieler stimmen sich selbst ab.',
    'Eine Partie hat 2 Gewinnsätze, bei 1:1 entscheidet der Match-Tie-Break bis 10 Punkte.',
    'Die Top 4 nach jeweils 6 Partien qualifizieren sich für das Final Four.'
  ],
  '2026-10-01'
)
on conflict (id) do update set
  label = excluded.label,
  title = excluded.title,
  starts_on = excluded.starts_on,
  is_active = excluded.is_active,
  counts_for_profile = excluded.counts_for_profile,
  organizations = excluded.organizations,
  short_info = excluded.short_info,
  elo_final_date = excluded.elo_final_date;

update public.seasons
set is_active = false, counts_for_profile = false
where id = 'test-2026';

insert into public.leagues (season_id, id, label, is_default)
values ('2026', 'main', 'Padel-Liga Sommer 2026', true)
on conflict (season_id, id) do update set
  label = excluded.label,
  is_default = excluded.is_default;

insert into public.season_players (season_id, league_id, player_id, start_elo) values
  ('2026','main','agnes_k',750),
  ('2026','main','andreas_l',1100),
  ('2026','main','chris_m',900),
  ('2026','main','christoph_l',850),
  ('2026','main','cristian_b',800),
  ('2026','main','florian_z',800),
  ('2026','main','greta_p',900),
  ('2026','main','irene_w',750),
  ('2026','main','jonas_l',800),
  ('2026','main','leonie_r',800),
  ('2026','main','luca_w',800),
  ('2026','main','ludwig_w',1100),
  ('2026','main','lukas_p',1150),
  ('2026','main','marcel_m',1000),
  ('2026','main','marco_m',1050),
  ('2026','main','martin_b',800),
  ('2026','main','niklas_k',850),
  ('2026','main','raphael_h',1100)
on conflict (season_id, league_id, player_id) do update set
  start_elo = excluded.start_elo;

insert into public.season_matchdays (season_id, matchday, starts_on, ends_on, title) values
  ('2026',1,'2026-05-11','2026-05-22',null),
  ('2026',2,'2026-05-25','2026-06-05',null),
  ('2026',3,'2026-06-08','2026-06-19',null),
  ('2026',4,'2026-06-22','2026-07-03',null),
  ('2026',5,'2026-07-06','2026-07-17',null),
  ('2026',6,'2026-07-20','2026-07-31',null),
  ('2026',7,'2026-08-03','2026-08-14',null),
  ('2026',8,null,null,'Final Four')
on conflict (season_id, matchday) do update set
  starts_on = excluded.starts_on,
  ends_on = excluded.ends_on,
  title = excluded.title;

insert into public.matches (
  id, season_id, league_id, matchday, match_type, format,
  scheduled_date, display_time, display_label, counts_for_ranking, counts_for_elo,
  team_one_label, team_two_label, result_details, actual_sets, winner,
  team_one_qualifier_ranks, team_two_qualifier_ranks
) values
  ('season-2026-partie-1','2026','main',1,'season','best-of-three','2026-06-11','12.30',null,true,true,'Greta P. / Agnes K.','Christoph L. / Marco M.','1:6, 3:6','0:2',2,'{}','{}'),
  ('season-2026-partie-2','2026','main',1,'season','best-of-three','2026-05-20','12.30',null,true,true,'Leonie R. / Cristian B.','Jonas L. / Luca W.','2:6, 0:6','0:2',2,'{}','{}'),
  ('season-2026-partie-3','2026','main',1,'season','best-of-three','2026-06-17','13.00',null,true,true,'Martin B. / Chris M.','Marcel M. / Irene W.','4:6, 3:6','0:2',2,'{}','{}'),
  ('season-2026-partie-4','2026','main',1,'season','best-of-three','2026-05-13','17.30',null,true,true,'Ludwig W. / Raphael H.','Florian Z. / Niklas K.','6:3, 6:2','2:0',1,'{}','{}'),
  ('season-2026-partie-5','2026','main',2,'season','best-of-three','2026-06-10','12.00',null,true,true,'Lukas P. / Martin B.','Luca W. / Andreas L.','0:6, 4:6','0:2',2,'{}','{}'),
  ('season-2026-partie-6','2026','main',2,'season','best-of-three','2026-05-19','13.00',null,true,true,'Ludwig W. / Cristian B.','Niklas K. / Greta P.','7:5, 6:1','2:0',1,'{}','{}'),
  ('season-2026-partie-7','2026','main',2,'season','best-of-three','2026-06-12','07.30',null,true,true,'Christoph L. / Raphael H.','Marco M. / Marcel M.','1:6, 1:6','0:2',2,'{}','{}'),
  ('season-2026-partie-8','2026','main',2,'season','best-of-three','2026-06-17','12.00',null,true,true,'Chris M. / Jonas L.','Irene W. / Leonie R.','6:0, 6:2','2:0',1,'{}','{}'),
  ('season-2026-partie-9','2026','main',3,'season','best-of-three','2026-07-07','07.30',null,true,true,'Cristian B. / Chris M.','Raphael H. / Leonie R.','1:6, 6:3 – 10:5','2:1',1,'{}','{}'),
  ('season-2026-partie-10','2026','main',3,'season','best-of-three','2026-06-08',null,null,true,true,'Agnes K. / Lukas P.','Ludwig W. / Marco M.',null,null,null,'{}','{}'),
  ('season-2026-partie-11','2026','main',3,'season','best-of-three','2026-07-09','07.30',null,true,true,'Christoph L. / Florian Z.','Luca W. / Irene W.','4:6, 6:2 – 7:10','1:2',2,'{}','{}'),
  ('season-2026-partie-12','2026','main',3,'season','best-of-three','2026-06-03','12.30',null,true,true,'Greta P. / Andreas L.','Marcel M. / Jonas L.','1:6, 6:3 – 6:10','1:2',2,'{}','{}'),
  ('season-2026-partie-13','2026','main',4,'season','best-of-three','2026-06-23','07.30',null,true,true,'Chris M. / Raphael H.','Ludwig W. / Irene W.','7:6 (11:9), 6:2','2:0',1,'{}','{}'),
  ('season-2026-partie-14','2026','main',4,'season','best-of-three','2026-06-25','12.00',null,true,true,'Cristian B. / Lukas P.','Christoph L. / Martin B.','6:1, 6:0','2:0',1,'{}','{}'),
  ('season-2026-partie-15','2026','main',4,'season','best-of-three','2026-08-19','18.00',null,true,true,'Marco M. / Andreas L.','Leonie R. / Niklas K.','6:2, 6:0','2:0',1,'{}','{}'),
  ('season-2026-partie-16','2026','main',4,'season','best-of-three','2026-07-16','07.15',null,true,true,'Marcel M. / Florian Z.','Agnes K. / Jonas L.','6:3, 6:1','2:0',1,'{}','{}'),
  ('season-2026-partie-17','2026','main',5,'season','best-of-three','2026-07-15','07.30',null,true,true,'Martin B. / Luca W.','Florian Z. / Ludwig W.','7:6 (7:4), 2:6 – 2:10','1:2',2,'{}','{}'),
  ('season-2026-partie-18','2026','main',5,'season','best-of-three','2026-07-30','10.00',null,true,true,'Chris M. / Agnes K.','Jonas L. / Greta P.','0:6, 0:6','0:2',2,'{}','{}'),
  ('season-2026-partie-19','2026','main',5,'season','best-of-three','2026-07-06',null,null,true,true,'Raphael H. / Andreas L.','Lukas P. / Niklas K.',null,null,null,'{}','{}'),
  ('season-2026-partie-20','2026','main',5,'season','best-of-three','2026-08-27','8.00',null,true,true,'Christoph L. / Irene W.','Marco M. / Cristian B.','3:6, 4:6','0:2',2,'{}','{}'),
  ('season-2026-partie-21','2026','main',6,'season','best-of-three','2026-07-14','12.30',null,true,true,'Florian Z. / Leonie R.','Andreas L. / Ludwig W.','0:6, 0:6','0:2',2,'{}','{}'),
  ('season-2026-partie-22','2026','main',6,'season','best-of-three','2026-08-26','14.00',null,true,true,'Irene W. / Cristian B.','Greta P. / Christoph L.',null,null,null,'{}','{}'),
  ('season-2026-partie-23','2026','main',6,'season','best-of-three','2026-09-03','7.00',null,true,true,'Jonas L. / Marco M.','Agnes K. / Martin B.',null,null,null,'{}','{}'),
  ('season-2026-partie-24','2026','main',6,'season','best-of-three','2026-06-24','12.00',null,true,true,'Marcel M. / Niklas K.','Lukas P. / Luca W.','4:6, 4:6','0:2',2,'{}','{}'),
  ('season-2026-partie-25','2026','main',7,'season','best-of-three','2026-07-16','12.30',null,true,true,'Niklas K. / Chris M.','Agnes K. / Andreas L.','6:3, 6:3','2:0',1,'{}','{}'),
  ('season-2026-partie-26','2026','main',7,'season','best-of-three','2026-08-06','7.30',null,true,true,'Florian Z. / Raphael H.','Marcel M. / Luca W.','0:6, 0:6','0:2',2,'{}','{}'),
  ('season-2026-partie-27','2026','main',7,'season','best-of-three','2026-08-03',null,null,true,true,'Leonie R. / Lukas P.','Greta P. / Martin B.',null,null,null,'{}','{}'),
  ('season-2026-partie-28','2026','main',8,'final','single-set',null,null,'Final 1',false,true,'Erster / Zweiter','Dritter / Vierter',null,null,null,array[1,2],array[3,4]),
  ('season-2026-partie-29','2026','main',8,'final','single-set',null,null,'Final 2',false,true,'Erster / Vierter','Zweiter / Dritter',null,null,null,array[1,4],array[2,3]),
  ('season-2026-partie-30','2026','main',8,'final','single-set',null,null,'Final 3',false,true,'Erster / Dritter','Zweiter / Vierter',null,null,null,array[1,3],array[2,4])
on conflict (id) do update set
  season_id = excluded.season_id,
  league_id = excluded.league_id,
  matchday = excluded.matchday,
  match_type = excluded.match_type,
  format = excluded.format,
  scheduled_date = excluded.scheduled_date,
  display_time = excluded.display_time,
  display_label = excluded.display_label,
  counts_for_ranking = excluded.counts_for_ranking,
  counts_for_elo = excluded.counts_for_elo,
  team_one_label = excluded.team_one_label,
  team_two_label = excluded.team_two_label,
  result_details = excluded.result_details,
  actual_sets = excluded.actual_sets,
  winner = excluded.winner,
  team_one_qualifier_ranks = excluded.team_one_qualifier_ranks,
  team_two_qualifier_ranks = excluded.team_two_qualifier_ranks;

update public.matches as match
set lock_at = case
  when match.scheduled_date is not null and nullif(match.display_time, '') is not null
    then (match.scheduled_date + replace(match.display_time, '.', ':')::time) at time zone 'Europe/Berlin'
  else null
end
where match.season_id = '2026';

insert into public.match_players (match_id, player_id, team, position)
select match.id, player.id, team_member.team, team_member.position
from public.matches as match
cross join lateral (
  select 1::smallint as team, member.name, member.ordinality::smallint as position
  from unnest(string_to_array(match.team_one_label, ' / ')) with ordinality as member(name, ordinality)
  union all
  select 2::smallint, member.name, member.ordinality::smallint
  from unnest(string_to_array(match.team_two_label, ' / ')) with ordinality as member(name, ordinality)
) as team_member
join public.players as player on player.display_name = team_member.name
where match.season_id = '2026'
on conflict (match_id, player_id) do update set
  team = excluded.team,
  position = excluded.position;

select private.recalculate_season_elo('2026');

do $$
begin
  if (select count(*) from public.season_players where season_id = '2026') <> 18 then
    raise exception 'Der 2026-Import enthält nicht genau 18 Teilnehmer.';
  end if;
  if (select count(*) from public.matches where season_id = '2026') <> 30 then
    raise exception 'Der 2026-Import enthält nicht genau 30 Partien.';
  end if;
  if (select count(*) from public.matches where season_id = '2026' and actual_sets is not null) <> 22 then
    raise exception 'Der 2026-Import enthält nicht genau 22 Ergebnisse.';
  end if;
  if (
    select count(*)
    from public.match_players as member
    join public.matches as match on match.id = member.match_id
    where match.season_id = '2026'
  ) <> 108 then
    raise exception 'Der 2026-Import enthält nicht genau 108 Spielerzuordnungen.';
  end if;
  if (
    select count(*)
    from public.match_elo_changes as change
    join public.matches as match on match.id = change.match_id
    where match.season_id = '2026'
  ) <> 88 then
    raise exception 'Der 2026-Import enthält nicht genau 88 Elo-Änderungen.';
  end if;
end;
$$;
