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
  requested.player_id,
  requested.season_id,
  'main',
  requested.kind,
  requested.title,
  requested.subtitle,
  '2026-09-09'::date,
  requested.priority
from (values
  ('marcel_m', '2026', 'winner', 'Gewinner', 'Padel-Liga Sommer 2026', 200),
  ('marcel_m', 'winter-2026', 'final_four', 'Final 4 Teilnehmer', 'Padel-Liga Winter 2026', 100),
  ('ludwig_w', '2026', 'final_four', 'Final 4 Teilnehmer', 'Padel-Liga Sommer 2026', 100)
) as requested(player_id, season_id, kind, title, subtitle, priority)
where not exists (
  select 1
  from public.player_achievements as achievement
  where achievement.player_id = requested.player_id
    and achievement.season_id = requested.season_id
    and achievement.league_id = 'main'
    and achievement.kind = requested.kind
);

do $$
begin
  if (
    select count(*)
    from public.player_achievements as achievement
    where achievement.achieved_on = '2026-09-09'
      and (achievement.player_id, achievement.season_id, achievement.kind) in (
        ('marcel_m', '2026', 'winner'),
        ('marcel_m', 'winter-2026', 'final_four'),
        ('ludwig_w', '2026', 'final_four')
      )
  ) <> 3 then
    raise exception 'Die drei temporären Testauszeichnungen wurden nicht vollständig angelegt.';
  end if;
end
$$;

commit;
