begin;

-- Apply only after the separate PadelPong site is live and the league no
-- longer serves the embedded game.
drop function public.get_arcade_leaderboard(uuid, text, text);
drop function public.submit_arcade_win(uuid, text, integer, integer, integer, integer, text, text);

notify pgrst, 'reload schema';

commit;
