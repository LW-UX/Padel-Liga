-- Read-only comparison for the two supplied booking confirmations.
select id, season_id, display_label, team_one_label, team_two_label,
  match_at, actual_sets, cancelled_at,
  exists (select 1 from public.result_proposals p where p.match_id = matches.id and p.status = 'pending') as pending_result
from public.matches
where match_at in ('2026-11-11T11:00:00Z', '2026-11-12T11:00:00Z')
order by match_at, id;
