begin;

-- The Final Four Prematch history uses the same orange-tinted result circles as
-- other recent-form views when a league match was decided by match tiebreak.
create or replace function private.final_four_prematch_league_history(
  p_season_id text,
  p_player_id text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', league_match.id,
    'outcome', case
      when league_match.cancelled_at is not null
        or league_match.winner is null
        or league_match.actual_sets is null then 'unfinished'
      when league_match.winner = member.team then 'win'
      else 'loss'
    end,
    'decidedByMatchTiebreak', league_match.actual_sets in ('2:1', '1:2'),
    'date', league_match.match_at,
    'label', coalesce(
      league_match.display_label,
      'Spieltag ' || league_match.matchday::text
    )
  ) order by
    league_match.matchday,
    league_match.match_at nulls last,
    league_match.id), '[]'::jsonb)
  from public.matches as league_match
  join public.match_players as member on member.match_id = league_match.id
  where league_match.season_id = p_season_id
    and league_match.competition_stage = 'league'
    and member.player_id = p_player_id
    and league_match.id <> 'test-2026-statistics-history';
$$;

-- Preserve every frozen fact and enrich only its existing history entries.
create function private.add_final_four_prematch_match_tiebreak_markers(
  p_payload jsonb
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_payload is null or jsonb_typeof(p_payload -> 'players') <> 'array'
      then p_payload
    else jsonb_set(
      p_payload,
      '{players}',
      coalesce((
        select jsonb_agg(
          case
            when jsonb_typeof(player.value -> 'leagueHistory') = 'array' then
              jsonb_set(
                player.value,
                '{leagueHistory}',
                coalesce((
                  select jsonb_agg(
                    history.value || jsonb_build_object(
                      'decidedByMatchTiebreak', coalesce(
                        league_match.actual_sets in ('2:1', '1:2'),
                        false
                      )
                    )
                    order by history.ordinality
                  )
                  from jsonb_array_elements(player.value -> 'leagueHistory')
                    with ordinality as history(value, ordinality)
                  left join public.matches as league_match
                    on league_match.id = history.value ->> 'id'
                ), '[]'::jsonb),
                false
              )
            else player.value
          end
          order by player.ordinality
        )
        from jsonb_array_elements(p_payload -> 'players')
          with ordinality as player(value, ordinality)
      ), '[]'::jsonb),
      false
    )
  end;
$$;

update public.final_four_prematch_snapshots as snapshot
set payload = private.add_final_four_prematch_match_tiebreak_markers(snapshot.payload);

update public.final_four_replacements as replacement
set original_prematch_facts = private.add_final_four_prematch_match_tiebreak_markers(
  replacement.original_prematch_facts
);

revoke all on function private.final_four_prematch_league_history(text, text)
  from public, anon, authenticated;

drop function private.add_final_four_prematch_match_tiebreak_markers(jsonb);

commit;
