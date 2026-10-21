begin;

update public.matches as match
set display_label = case match.display_label
  when 'Final 1' then 'Final Four 1'
  when 'Final 2' then 'Final Four 2'
  when 'Final 3' then 'Final Four 3'
end,
updated_at = now()
where match.competition_stage = 'final_four'
  and match.display_label in ('Final 1', 'Final 2', 'Final 3');

commit;
