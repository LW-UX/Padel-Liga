begin;

insert into public.players (id, display_name, initials, company)
values ('ludi_ionos', 'Ludi Ionos', 'LION', 'Test')
on conflict (id) do update set
  display_name = excluded.display_name,
  initials = excluded.initials,
  company = excluded.company;

commit;
