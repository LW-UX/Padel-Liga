begin;

delete from private.signup_email_domains
where domain not in (
  'envidual.com',
  'headsquare.group',
  'hanako-health.com'
);

insert into private.signup_email_domains (domain) values
  ('envidual.com'),
  ('headsquare.group'),
  ('hanako-health.com')
on conflict (domain) do nothing;

commit;
