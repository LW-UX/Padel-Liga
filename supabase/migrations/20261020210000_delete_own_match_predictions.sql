begin;

delete from public.predictions as prediction
using public.profiles as profile, public.match_players as member
where profile.id = prediction.user_id
  and member.player_id = profile.player_id
  and member.match_id = prediction.match_id;

commit;
