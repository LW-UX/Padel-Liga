begin;

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
    -- The hidden statistics fixture is deliberately separate from its six
    -- interactive league matches and must not become a seventh history dot.
    and league_match.id <> 'test-2026-statistics-history';
$$;

create or replace function private.add_final_four_prematch_league_history(
  p_payload jsonb,
  p_season_id text
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
          (player.value - 'form') || jsonb_build_object(
            'leagueHistory', private.final_four_prematch_league_history(
              p_season_id,
              player.value ->> 'playerId'
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
  rename to build_final_four_prematch_facts_base;

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
  select private.add_final_four_prematch_league_history(
    private.build_final_four_prematch_facts_base(
      p_season_id,
      p_at,
      p_context_match_id
    ),
    p_season_id
  );
$$;

-- Existing frozen snapshots keep every original fact and receive only the new
-- league-history property. Their capture time and source match stay unchanged.
update public.final_four_prematch_snapshots as snapshot
set payload = private.add_final_four_prematch_league_history(
  snapshot.payload,
  snapshot.season_id
);

revoke all on function private.final_four_prematch_league_history(text, text)
  from public, anon, authenticated;
revoke all on function private.add_final_four_prematch_league_history(jsonb, text)
  from public, anon, authenticated;
revoke all on function private.build_final_four_prematch_facts_base(text, timestamptz, text)
  from public, anon, authenticated;
revoke all on function private.build_final_four_prematch_facts(text, timestamptz, text)
  from public, anon, authenticated;

commit;
