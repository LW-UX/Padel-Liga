begin;

-- Preserve every existing match-detail decorator and add each league
-- participant's rank immediately before a completed match.
alter function public.get_public_match_detail(text)
  rename to get_public_match_detail_without_rank_changes;

alter function public.get_public_match_detail_without_rank_changes(text)
  set schema private;

revoke all on function private.get_public_match_detail_without_rank_changes(text)
  from public, anon, authenticated;

create function public.get_public_match_detail(p_match_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with match_context as (
    select match.*,
      match.winner is not null and match.actual_sets is not null as completed
    from public.matches match
    where match.id = p_match_id
  ), detail as (
    select private.get_public_match_detail_without_rank_changes(p_match_id) as value
  ), table_before as (
    select private.match_detail_table(
      match_context.season_id,
      match_context.match_at,
      match_context.id,
      false
    ) as value
    from match_context
    where match_context.completed and match_context.match_at is not null
  ), ranking_with_changes as (
    select coalesce(jsonb_agg(
      case
        when table_before.value -> (ranked.value ->> 'playerId') -> 'rank' is null then ranked.value
        else jsonb_set(
          ranked.value,
          '{statistics,previousRank}',
          table_before.value -> (ranked.value ->> 'playerId') -> 'rank',
          true
        )
      end
      order by ranked.ordinality
    ), '[]'::jsonb) as value
    from detail
    join match_context on true
    left join table_before on true
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(detail.value -> 'ranking') = 'array'
        then detail.value -> 'ranking' else '[]'::jsonb end
    ) with ordinality as ranked(value, ordinality)
  )
  select case
    when detail.value is null
      or not match_context.completed
      or jsonb_typeof(detail.value -> 'ranking') <> 'array'
      then detail.value
    else jsonb_set(detail.value, '{ranking}', ranking_with_changes.value, false)
  end
  from detail
  join match_context on true
  left join ranking_with_changes on true;
$$;

revoke all on function public.get_public_match_detail(text) from public;
grant execute on function public.get_public_match_detail(text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
