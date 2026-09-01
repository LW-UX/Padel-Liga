update public.seasons
set label = 'Sommer 2026',
    title = 'Padel-Liga Sommer 2026'
where id = '2026';

update public.leagues
set label = 'Padel-Liga Sommer 2026'
where season_id = '2026'
  and id = 'main';

insert into public.player_achievements (
  player_id,
  season_id,
  league_id,
  kind,
  title,
  subtitle,
  achieved_on,
  priority
)
select
  finalist.player_id,
  '2026',
  'main',
  'final_four',
  'Final 4 Teilnehmer',
  'Padel-Liga Sommer 2026',
  null,
  100
from (values ('luca_w'), ('marco_m')) as finalist(player_id)
where not exists (
  select 1
  from public.player_achievements as achievement
  where achievement.player_id = finalist.player_id
    and achievement.season_id = '2026'
    and achievement.league_id = 'main'
    and achievement.kind = 'final_four'
);

do $$
begin
  if (
    select count(*)
    from public.player_achievements
    where player_id in ('luca_w', 'marco_m')
      and season_id = '2026'
      and league_id = 'main'
      and kind = 'final_four'
      and title = 'Final 4 Teilnehmer'
      and subtitle = 'Padel-Liga Sommer 2026'
  ) <> 2 then
    raise exception 'Die beiden Final-4-Auszeichnungen wurden nicht vollständig angelegt.';
  end if;
end
$$;
