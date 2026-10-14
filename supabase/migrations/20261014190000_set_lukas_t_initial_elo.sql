begin;

update public.players
set initial_elo = 750
where id = 'lukas_t';

commit;
