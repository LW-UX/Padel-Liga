begin;

-- The match detail exposes the three latest ranked season matches before the
-- viewed match. Keeping the cutoff in SQL preserves historical analyses and
-- prevents later results from leaking into an older match detail.
create function private.match_detail_recent_form(
  p_player_id text,
  p_season_id text,
  p_league_id text,
  p_cutoff_at timestamptz,
  p_cutoff_id text
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with recent as (
    select
      match.id,
      match.match_at,
      match.display_label,
      match.matchday,
      match.result_details,
      match.actual_sets,
      match.winner,
      match_player.team
    from public.matches match
    join public.match_players match_player
      on match_player.match_id = match.id
      and match_player.player_id = p_player_id
    where match.season_id = p_season_id
      and match.league_id = p_league_id
      and match.competition_stage = 'league'
      and match.counts_for_ranking
      and match.cancelled_at is null
      and match.winner is not null
      and match.actual_sets is not null
      and match.match_at is not null
      and (match.match_at, match.id) < (p_cutoff_at, p_cutoff_id)
    order by match.match_at desc, match.id desc
    limit 3
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'matchId', recent.id,
    'label', coalesce(recent.display_label, 'Partie ' || coalesce(substring(recent.id from '([0-9]+)$'), recent.matchday::text)),
    'date', recent.match_at,
    'result', recent.result_details,
    'outcome', case when recent.winner = recent.team then 'win' else 'loss' end,
    'decidedByMatchTiebreak', recent.actual_sets in ('2:1', '1:2')
  ) order by recent.match_at, recent.id), '[]'::jsonb)
  from recent;
$$;

revoke all on function private.match_detail_recent_form(text,text,text,timestamptz,text)
  from public, anon, authenticated;

alter function public.get_public_match_detail(text)
  rename to get_public_match_detail_without_recent_form;

alter function public.get_public_match_detail_without_recent_form(text)
  set schema private;

revoke all on function private.get_public_match_detail_without_recent_form(text)
  from public, anon, authenticated;

create function public.get_public_match_detail(p_match_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with match_context as (
    select
      match.*,
      not season.counts_for_profile and season.id in ('test-2026', '2026-test') as test_mode,
      match.winner is not null and match.actual_sets is not null as completed
    from public.matches match
    join public.seasons season on season.id = match.season_id
    where match.id = p_match_id
  ), detail as (
    select private.get_public_match_detail_without_recent_form(p_match_id) as value
  ), enriched_players as (
    select coalesce(jsonb_agg(
      player.value || jsonb_build_object(
        'form', private.match_detail_recent_form(
          player.value ->> 'playerId',
          match_context.season_id,
          match_context.league_id,
          case when match_context.completed then match_context.match_at else now() end,
          case when match_context.completed or match_context.test_mode then match_context.id else chr(65535) end
        )
      )
      order by player.ordinality
    ), '[]'::jsonb) as value
    from detail
    join match_context on true
    cross join lateral jsonb_array_elements(detail.value -> 'players') with ordinality player(value, ordinality)
  )
  select case
    when detail.value is null
      or detail.value ->> 'availability' = 'basic'
      or jsonb_typeof(detail.value -> 'players') <> 'array'
      then detail.value
    else jsonb_set(detail.value, '{players}', enriched_players.value, false)
  end
  from detail
  left join enriched_players on true;
$$;

revoke all on function public.get_public_match_detail(text) from public;
grant execute on function public.get_public_match_detail(text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
