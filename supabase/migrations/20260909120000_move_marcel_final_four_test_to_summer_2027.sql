begin;

update public.player_achievements
set
  season_id = null,
  league_id = null,
  subtitle = 'Padel-Liga Sommer 2027',
  priority = 110
where player_id = 'marcel_m'
  and season_id = '2026'
  and league_id = 'main'
  and kind = 'final_four'
  and title = 'Final 4 Teilnehmer'
  and subtitle = 'Padel-Liga Sommer 2026'
  and achieved_on = '2026-09-09'
  and priority = 100;

do $$
begin
  if exists (
    select 1
    from public.player_achievements as achievement
    where achievement.player_id = 'marcel_m'
      and achievement.season_id = '2026'
      and achievement.league_id = 'main'
      and achievement.kind = 'final_four'
      and achievement.subtitle = 'Padel-Liga Sommer 2026'
      and achievement.achieved_on = '2026-09-09'
  ) then
    raise exception 'Marcels temporärer Sommer-2026-Final-Four-Testeintrag wurde nicht verschoben.';
  end if;

  if (
    select count(*)
    from public.player_achievements as achievement
    where achievement.player_id = 'marcel_m'
      and achievement.season_id is null
      and achievement.league_id is null
      and achievement.kind = 'final_four'
      and achievement.title = 'Final 4 Teilnehmer'
      and achievement.subtitle = 'Padel-Liga Sommer 2027'
      and achievement.achieved_on = '2026-09-09'
      and achievement.priority = 110
  ) <> 1 then
    raise exception 'Marcels temporäre Sommer-2027-Final-Four-Auszeichnung wurde nicht eindeutig angelegt.';
  end if;
end
$$;

commit;
