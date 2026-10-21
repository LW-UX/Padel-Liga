begin;

-- The renamed Final Four fact is specifically the longest winning streak.
-- Keep the established cross-season cutoff and official-match-only scope.
create or replace function private.final_four_prematch_longest_streak(
  p_player_id text,
  p_at timestamptz,
  p_context_match_id text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with history as materialized (
    select
      match_history.outcome,
      row_number() over (
        order by match_history.event_at, match_history.event_id
      ) as event_position,
      row_number() over (
        order by match_history.event_at, match_history.event_id
      ) - row_number() over (
        partition by match_history.outcome
        order by match_history.event_at, match_history.event_id
      ) as streak_group
    from private.match_detail_history(
      array[p_player_id], p_at, p_context_match_id, false
    ) as match_history
    where match_history.kind <> 'training'
      and match_history.complete
      and match_history.outcome in ('win', 'loss')
  ), winning_streaks as (
    select count(*)::integer as length
    from history
    where history.outcome = 'win'
    group by history.streak_group
  )
  select (
    select jsonb_build_object('outcome', 'win', 'length', winning_streak.length)
    from winning_streaks as winning_streak
    where winning_streak.length >= 3
    order by winning_streak.length desc
    limit 1
  );
$$;

update public.final_four_prematch_snapshots as snapshot
set payload = private.add_final_four_prematch_longest_streak(
  snapshot.payload,
  snapshot.captured_at,
  snapshot.source_match_id
);

update public.final_four_replacements as replacement
set original_prematch_facts = private.add_final_four_prematch_longest_streak(
  jsonb_build_object('players', jsonb_build_array(replacement.original_prematch_facts)),
  replacement.replaced_at,
  coalesce((
    select match.id
    from public.matches as match
    where match.season_id = replacement.season_id
      and match.competition_stage = 'final_four'
      and match.cancelled_at is null
    order by match.match_at nulls last, match.id
    limit 1
  ), 'final-four')
) -> 'players' -> 0;

revoke all on function private.final_four_prematch_longest_streak(text, timestamptz, text)
  from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
