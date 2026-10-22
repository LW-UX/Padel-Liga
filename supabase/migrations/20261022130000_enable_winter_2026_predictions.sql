begin;

do $$
declare
  updated_count integer;
begin
  update public.seasons
  set predictions_enabled = true
  where id in ('2026-winter', 'winter-2026');

  get diagnostics updated_count = row_count;

  if updated_count <> 1 then
    raise exception 'Die Saison Winter 2026 wurde nicht eindeutig gefunden.';
  end if;
end;
$$;

commit;
