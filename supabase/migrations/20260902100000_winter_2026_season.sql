insert into public.seasons (
  id,
  label,
  title,
  starts_on,
  is_active,
  results_entry_enabled,
  counts_for_profile,
  organizations,
  short_info,
  elo_final_date
) values (
  'winter-2026',
  'Winter 2026',
  'Padel-Liga Winter 2026',
  '2026-10-01',
  true,
  true,
  true,
  array['Headsquare', 'Hanako', 'Envidual'],
  array[
    'Die neue Saison wird vorbereitet.',
    'Weitere Teilnehmer und der Spielplan folgen.'
  ],
  null
)
on conflict (id) do update set
  label = excluded.label,
  title = excluded.title,
  starts_on = excluded.starts_on,
  is_active = excluded.is_active,
  results_entry_enabled = excluded.results_entry_enabled,
  counts_for_profile = excluded.counts_for_profile,
  organizations = excluded.organizations,
  short_info = excluded.short_info,
  elo_final_date = excluded.elo_final_date;

update public.seasons
set is_active = false
where id <> 'winter-2026'
  and is_active;

insert into public.leagues (season_id, id, label, is_default)
values ('winter-2026', 'main', 'Padel-Liga Winter 2026', true)
on conflict (season_id, id) do update set
  label = excluded.label,
  is_default = excluded.is_default;

insert into public.season_players (season_id, league_id, player_id, start_elo) values
  ('winter-2026', 'main', 'marcel_m', 1170),
  ('winter-2026', 'main', 'chris_m', 934),
  ('winter-2026', 'main', 'luca_w', 1051),
  ('winter-2026', 'main', 'marco_m', 1187),
  ('winter-2026', 'main', 'ludwig_w', 1134),
  ('winter-2026', 'main', 'greta_p', 847),
  ('winter-2026', 'main', 'agnes_k', 580),
  ('winter-2026', 'main', 'niklas_k', 784),
  ('winter-2026', 'main', 'andreas_l', 1051),
  ('winter-2026', 'main', 'jonas_l', 986)
on conflict (season_id, league_id, player_id) do update set
  start_elo = excluded.start_elo;
