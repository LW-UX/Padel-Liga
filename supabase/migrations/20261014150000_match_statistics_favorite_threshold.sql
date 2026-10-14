begin;

-- The match modal and statistics page use the same inclusive 55 percent
-- boundary for favorites. Upsets use an inclusive 45 percent boundary.
create or replace function private.match_detail_result_impact(p_winner integer, p_probability numeric)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with probability as (
    select case when p_winner=1 then p_probability else 1-p_probability end value
  )
  select case
    when value<=0.45 or value>=0.55 then jsonb_build_object(
      'kind', case when value<=0.45 then 'upset' else 'favoriteConfirmed' end,
      'team', p_winner,
      'probability', value
    )
    else null
  end
  from probability;
$$;

revoke all on function private.match_detail_result_impact(integer,numeric)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
