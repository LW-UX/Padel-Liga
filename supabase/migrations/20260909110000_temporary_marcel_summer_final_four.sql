begin;

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
  'marcel_m',
  '2026',
  'main',
  'final_four',
  'Final 4 Teilnehmer',
  'Padel-Liga Sommer 2026',
  '2026-09-09'::date,
  100
where not exists (
  select 1
  from public.player_achievements as achievement
  where achievement.player_id = 'marcel_m'
    and achievement.season_id = '2026'
    and achievement.league_id = 'main'
    and achievement.kind = 'final_four'
);

do $$
begin
  if (
    select count(*)
    from public.player_achievements as achievement
    where achievement.player_id = 'marcel_m'
      and achievement.season_id = '2026'
      and achievement.league_id = 'main'
      and achievement.kind = 'final_four'
      and achievement.title = 'Final 4 Teilnehmer'
      and achievement.subtitle = 'Padel-Liga Sommer 2026'
      and achievement.achieved_on = '2026-09-09'
      and achievement.priority = 100
  ) <> 1 then
    raise exception 'Marcels temporäre Sommer-2026-Final-Four-Auszeichnung wurde nicht eindeutig angelegt.';
  end if;
end
$$;

commit;
