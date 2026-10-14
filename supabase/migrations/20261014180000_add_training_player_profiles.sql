begin;

insert into public.players (id, display_name, initials, company, initial_elo)
values
  ('lukas_t', 'Lukas T.', 'LT', 'Envidual', null),
  ('christian_h', 'Christian H.', 'CH', 'Headsquare', 800),
  ('lisa_s', 'Lisa S.', 'LS', 'Envidual', 800)
on conflict (id) do update set
  display_name = excluded.display_name,
  initials = excluded.initials,
  company = excluded.company,
  initial_elo = excluded.initial_elo;

commit;
