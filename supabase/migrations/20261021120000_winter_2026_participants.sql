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
    select 1 from public.season_players
    where season_id = winter_season_id
  ) then
    raise exception 'Winter 2026 enthält bereits Teilnehmer.';
  end if;

  insert into public.season_players (season_id, league_id, player_id, start_elo)
  select winter_season_id, 'main', participant.player_id, participant.start_elo
  from (values
    ('marco_m', 1199),
    ('luca_w', 1090),
    ('jonas_l', 953),
    ('marcel_m', 1179),
    ('ludwig_w', 1145),
    ('chris_m', 934),
    ('andreas_l', 1051),
    ('lukas_p', 1155),
    ('greta_p', 838),
    ('raphael_h', 936),
    ('christoph_l', 787),
    ('leonie_r', 704),
    ('niklas_k', 784),
    ('martin_b', 566),
    ('agnes_k', 564),
    ('florian_z', 814),
    ('lisa_s', 800),
    ('christian_h', 800),
    ('lukas_t', 750),
    ('yonatan_g', 800)
  ) as participant(player_id, start_elo);

  if (
    select count(*) from public.season_players
    where season_id = winter_season_id
  ) <> 20 then
    raise exception 'Winter 2026 enthält nicht genau 20 Teilnehmer.';
  end if;
end;
$$;

commit;
