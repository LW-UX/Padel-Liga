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
  'winner',
  'Gewinner',
  'Padel-Liga Sommer 2026',
  null,
  200
where not exists (
  select 1
  from public.player_achievements as achievement
  where achievement.player_id = 'marcel_m'
    and achievement.season_id = '2026'
    and achievement.league_id = 'main'
    and achievement.kind = 'winner'
);

do $$
begin
  if (
    select count(*)
    from public.player_achievements
    where player_id = 'marcel_m'
      and season_id = '2026'
      and league_id = 'main'
      and kind = 'winner'
      and title = 'Gewinner'
      and subtitle = 'Padel-Liga Sommer 2026'
      and priority = 200
  ) <> 1 then
    raise exception 'Die Gewinner-Auszeichnung für Marcel M. wurde nicht eindeutig angelegt.';
  end if;
end
$$;
