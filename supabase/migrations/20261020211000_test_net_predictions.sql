begin;

insert into public.predictions(user_id, match_id, prediction)
select profile.id, match_id, '2:1'
from public.profiles as profile
cross join unnest(array['test-2026-partie-1', 'test-2026-partie-2']) as match_id
where profile.player_id = 'test_net'
on conflict (user_id, match_id) do update
  set prediction = excluded.prediction,
      updated_at = now();

commit;
