begin;

do $$
declare
  target_season_id text;
begin
  select season.id
  into target_season_id
  from public.seasons as season
  where season.id in ('2026-test', 'test-2026')
    and season.results_entry_enabled
  order by case season.id when '2026-test' then 1 else 2 end
  limit 1;

  if target_season_id is null then
    raise exception 'Die aktive Test-Saison fehlt.';
  end if;

  insert into public.season_matchdays (
    season_id,
    matchday,
    starts_on,
    ends_on,
    title
  ) values
    (target_season_id, 3, '2026-10-05', '2026-11-12', null),
    (target_season_id, 4, '2026-11-15', '2026-12-15', null),
    (target_season_id, 5, '2027-01-01', '2027-01-21', null)
  on conflict (season_id, matchday) do update set
    starts_on = excluded.starts_on,
    ends_on = excluded.ends_on;

  if exists (
    select 1
    from (
      values
        (3, date '2026-10-05', date '2026-11-12'),
        (4, date '2026-11-15', date '2026-12-15'),
        (5, date '2027-01-01', date '2027-01-21')
    ) as expected(matchday, starts_on, ends_on)
    left join public.season_matchdays as actual
      on actual.season_id = target_season_id
      and actual.matchday = expected.matchday
    where actual.starts_on is distinct from expected.starts_on
      or actual.ends_on is distinct from expected.ends_on
  ) then
    raise exception 'Die Zeiträume der Test-Spieltage wurden nicht korrekt gespeichert.';
  end if;
end;
$$;

commit;
