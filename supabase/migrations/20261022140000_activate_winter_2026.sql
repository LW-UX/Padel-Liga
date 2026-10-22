begin;

do $$
declare
  winter_season_id text;
begin
  select id into winter_season_id
  from public.seasons
  where id in ('2026-winter', 'winter-2026');

  if winter_season_id is null then
    raise exception 'Die Saison Winter 2026 wurde nicht gefunden.';
  end if;

  if exists (
    select 1 from public.seasons
    where is_active
      and id <> winter_season_id
      and completed_at is null
  ) then
    raise exception 'Eine noch nicht abgeschlossene Saison ist aktiv.';
  end if;

  update public.seasons
  set is_active = false
  where is_active
    and id <> winter_season_id;

  update public.seasons
  set is_active = true
  where id = winter_season_id;
end;
$$;

commit;
