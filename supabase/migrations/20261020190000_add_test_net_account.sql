begin;

insert into public.players (id, display_name, initials, company, initial_elo)
values ('test_net', 'Test Net', 'TNET', 'Test', 800);

insert into private.player_email_allowlist (email_hash, player_id, app_role)
values (
  decode('0ae76e26e22e74c7cf70a1a46dd29bed4d3db7523516b6c08931a8469d3aa624', 'hex'),
  'test_net',
  'player'
);

commit;
