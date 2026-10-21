begin;

-- The Final Four overview shows a player's best completed run before the
-- snapshot cutoff, not only the run that happened to be active at that time.
-- Training remains excluded because this fact is explicitly about official
-- competitive matches.
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
  ), streaks as (
    select
      history.outcome,
      count(*)::integer as length,
      max(history.event_position) as ended_position
    from history
    group by history.outcome, history.streak_group
  ), longest as (
    select streak.outcome, streak.length
    from streaks as streak
    where streak.length >= 3
    order by
      streak.length desc,
      streak.ended_position desc,
      case streak.outcome when 'win' then 1 else 2 end
    limit 1
  )
  select (
    select jsonb_build_object(
      'outcome', longest.outcome,
      'length', longest.length
    )
    from longest
  );
$$;

create or replace function private.add_final_four_prematch_longest_streak(
  p_payload jsonb,
  p_at timestamptz,
  p_context_match_id text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_payload is null then null
    else jsonb_set(
      p_payload,
      '{players}',
      coalesce((
        select jsonb_agg(
          player.value || jsonb_build_object(
            'streak', private.final_four_prematch_longest_streak(
              player.value ->> 'playerId',
              p_at,
              p_context_match_id
            )
          )
          order by player.ordinality
        )
        from jsonb_array_elements(coalesce(p_payload -> 'players', '[]'::jsonb))
          with ordinality as player(value, ordinality)
      ), '[]'::jsonb),
      true
    )
  end;
$$;

alter function private.build_final_four_prematch_facts(text, timestamptz, text)
  rename to build_final_four_prematch_facts_with_current_streak;

create function private.build_final_four_prematch_facts(
  p_season_id text,
  p_at timestamptz,
  p_context_match_id text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.add_final_four_prematch_longest_streak(
    private.build_final_four_prematch_facts_with_current_streak(
      p_season_id,
      p_at,
      p_context_match_id
    ),
    p_at,
    p_context_match_id
  );
$$;

-- Preserve the original cutoff of already frozen Final Four facts while
-- correcting only the meaning of their official-match streak property.
update public.final_four_prematch_snapshots as snapshot
set payload = private.add_final_four_prematch_longest_streak(
  snapshot.payload,
  snapshot.captured_at,
  snapshot.source_match_id
);

-- A withdrawn qualifier's facts are stored outside the normal snapshot.
-- Recalculate that one field at the original replacement time as well.
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
revoke all on function private.add_final_four_prematch_longest_streak(jsonb, timestamptz, text)
  from public, anon, authenticated;
revoke all on function private.build_final_four_prematch_facts_with_current_streak(text, timestamptz, text)
  from public, anon, authenticated;
revoke all on function private.build_final_four_prematch_facts(text, timestamptz, text)
  from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
