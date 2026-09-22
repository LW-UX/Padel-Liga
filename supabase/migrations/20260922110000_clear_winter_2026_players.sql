delete from public.season_players
where season_id = 'winter-2026';

do $$
begin
  if exists (
    select 1
    from public.season_players
    where season_id = 'winter-2026'
  ) then
    raise exception 'Winter 2026 still contains season players.';
  end if;
end;
$$;
