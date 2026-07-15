create index if not exists matches_league_idx on public.matches(season_id, league_id);
create index if not exists match_players_player_id_idx on public.match_players(player_id);
create index if not exists season_players_player_id_idx on public.season_players(player_id);

create or replace function public.update_my_profile(p_display_name text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  clean_name text := trim(p_display_name);
begin
  if (select auth.uid()) is null then
    raise exception 'Nicht angemeldet.';
  end if;
  if char_length(clean_name) not between 2 and 40 then
    raise exception 'Der Anzeigename muss zwischen 2 und 40 Zeichen lang sein.';
  end if;

  update public.profiles
  set display_name = clean_name
  where id = (select auth.uid());
end;
$$;

drop policy if exists "Users update their display name" on public.profiles;
create policy "Users update their display name" on public.profiles for update to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = id)
with check ((select auth.uid()) is not null and (select auth.uid()) = id);

grant update(display_name) on public.profiles to authenticated;
