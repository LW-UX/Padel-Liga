begin;

-- Completed, ranked league matches expose their chronological position within
-- their season and league. The established match_at/id tuple keeps ties stable.
alter function public.get_public_match_detail(text)
  rename to get_public_match_detail_without_played_order;

alter function public.get_public_match_detail_without_played_order(text)
  set schema private;

revoke all on function private.get_public_match_detail_without_played_order(text)
  from public, anon, authenticated;

create function public.get_public_match_detail(p_match_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with detail as (
    select private.get_public_match_detail_without_played_order(p_match_id) as value
  ), match_context as (
    select match.*
    from public.matches match
    where match.id = p_match_id
  ), played_order as (
    select count(*)::integer as value
    from match_context
    join public.matches played
      on played.season_id = match_context.season_id
      and played.league_id = match_context.league_id
      and played.competition_stage = 'league'
      and played.counts_for_ranking
      and played.cancelled_at is null
      and played.winner is not null
      and played.actual_sets is not null
      and played.match_at is not null
      and (played.match_at, played.id) <= (match_context.match_at, match_context.id)
  )
  select case
    when detail.value is null
      or detail.value ->> 'availability' <> 'analysis'
      or match_context.competition_stage <> 'league'
      or not match_context.counts_for_ranking
      or match_context.cancelled_at is not null
      or match_context.match_at is null
      then detail.value
    else detail.value || jsonb_build_object('leaguePlayedOrdinal', played_order.value)
  end
  from detail
  left join match_context on true
  left join played_order on true;
$$;

revoke all on function public.get_public_match_detail(text) from public;
grant execute on function public.get_public_match_detail(text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
