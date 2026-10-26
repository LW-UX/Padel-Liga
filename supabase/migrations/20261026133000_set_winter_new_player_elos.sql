begin;

create temporary table new_player_start_elos (
  player_id text primary key,
  start_elo integer not null
) on commit drop;

insert into new_player_start_elos (player_id, start_elo) values
  ('christian_h', 550),
  ('lisa_s', 550),
  ('lukas_t', 550),
  ('yonatan_g', 550);

do $$
declare
  winter_season_id text;
  affected_rows integer;
begin
  select id into winter_season_id
  from public.seasons
  where id in ('2026-winter', 'winter-2026');

  if winter_season_id is null then
    raise exception 'Die Saison Winter 2026 wurde nicht gefunden.';
  end if;

  if (
    select count(*)
    from public.season_players as participant
    join new_player_start_elos as desired on desired.player_id = participant.player_id
    where participant.season_id = winter_season_id
  ) <> 4 then
    raise exception 'Die vier neuen Winter-Spieler wurden nicht vollständig gefunden.';
  end if;

  if exists (
    select 1
    from public.match_elo_changes as change
    join new_player_start_elos as desired on desired.player_id = change.player_id
  ) then
    raise exception 'Für mindestens einen neuen Winter-Spieler existiert bereits ein Elo-Ereignis.';
  end if;

  update public.season_players as participant
  set start_elo = desired.start_elo
  from new_player_start_elos as desired
  where participant.season_id = winter_season_id
    and participant.player_id = desired.player_id;

  get diagnostics affected_rows = row_count;
  if affected_rows <> 4 then
    raise exception 'Es wurden nicht alle vier Saisonstartwerte aktualisiert.';
  end if;

  update public.players as player
  set initial_elo = desired.start_elo
  from new_player_start_elos as desired
  where player.id = desired.player_id;

  get diagnostics affected_rows = row_count;
  if affected_rows <> 4 then
    raise exception 'Es wurden nicht alle vier globalen Initialwerte aktualisiert.';
  end if;
end;
$$;

commit;
