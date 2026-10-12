begin;

alter table public.leagues
  drop constraint if exists leagues_season_id_fkey;
alter table public.leagues
  add constraint leagues_season_id_fkey
  foreign key (season_id) references public.seasons(id)
  on update cascade on delete cascade;

alter table public.season_players
  drop constraint if exists season_players_season_id_league_id_fkey;
alter table public.season_players
  add constraint season_players_season_id_league_id_fkey
  foreign key (season_id, league_id) references public.leagues(season_id, id)
  on update cascade on delete cascade;

alter table public.matches
  drop constraint if exists matches_season_id_league_id_fkey;
alter table public.matches
  add constraint matches_season_id_league_id_fkey
  foreign key (season_id, league_id) references public.leagues(season_id, id)
  on update cascade on delete cascade;

alter table public.season_matchdays
  drop constraint if exists season_matchdays_season_id_fkey;
alter table public.season_matchdays
  add constraint season_matchdays_season_id_fkey
  foreign key (season_id) references public.seasons(id)
  on update cascade on delete cascade;

alter table public.player_achievements
  drop constraint if exists player_achievements_season_id_league_id_fkey;
alter table public.player_achievements
  add constraint player_achievements_season_id_league_id_fkey
  foreign key (season_id, league_id) references public.leagues(season_id, id)
  on update cascade on delete set null;

alter table public.season_tournament_players
  drop constraint if exists season_tournament_players_season_id_fkey;
alter table public.season_tournament_players
  add constraint season_tournament_players_season_id_fkey
  foreign key (season_id) references public.seasons(id)
  on update cascade on delete cascade;

do $$
begin
  if exists (
    select 1 from public.seasons
    where id in ('2026-sommer', '2026-winter', '2026-test', '2027-cup')
  ) then
    raise exception 'Mindestens eine neue Saison-ID ist bereits vergeben.';
  end if;

  if (
    select count(*) from public.seasons
    where id in ('2026', 'winter-2026', 'test-2026', 'cup-2027')
  ) <> 4 then
    raise exception 'Die vier umzubenennenden Saison-IDs wurden nicht vollständig gefunden.';
  end if;
end;
$$;

update public.seasons
set id = case id
      when '2026' then '2026-sommer'
      when 'winter-2026' then '2026-winter'
      when 'test-2026' then '2026-test'
      when 'cup-2027' then '2027-cup'
    end,
    label = case id
      when '2026' then 'Sommer 2026'
      when 'winter-2026' then 'Winter 2026'
      when 'test-2026' then 'Test-Saison'
      when 'cup-2027' then 'Cup 2027'
    end,
    title = case when id = '2026' then 'Padel-Liga Sommer 2026' else title end
where id in ('2026', 'winter-2026', 'test-2026', 'cup-2027');

do $$
begin
  if exists (
    select 1 from public.seasons
    where id in ('2026', 'winter-2026', 'test-2026', 'cup-2027')
  ) then
    raise exception 'Mindestens eine alte Saison-ID ist noch vorhanden.';
  end if;

  if (
    select count(*) from public.seasons
    where id in ('2026-sommer', '2026-winter', '2026-test', '2027-cup')
  ) <> 4 then
    raise exception 'Die vier neuen Saison-IDs fehlen oder sind unvollständig.';
  end if;
end;
$$;

commit;
