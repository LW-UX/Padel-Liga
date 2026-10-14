begin;

-- The individual Final Four title forecast is deliberately sharper than the
-- probability shown for a normal two-team match. It keeps the existing
-- rotating-team model and changes only its Elo divisor from 500 to 300.
create or replace function private.build_final_four_prematch_facts_base(
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
  with final_matches as materialized (
    select match.id
    from public.matches as match
    where match.season_id = p_season_id
      and match.competition_stage = 'final_four'
      and match.cancelled_at is null
  ), finalists as materialized (
    select
      finalist.player_id,
      finalist.seed::integer as seed,
      finalist.league_rank::integer as league_rank,
      player.display_name,
      player.initial_elo
    from public.season_tournament_players as finalist
    join public.players as player on player.id = finalist.player_id
    where finalist.season_id = p_season_id
      and finalist.stage = 'final_four'
  ), final_members as materialized (
    select member.match_id, member.player_id, member.team::integer, member.position::integer
    from public.match_players as member
    join final_matches as match on match.id = member.match_id
  ), validation as (
    select 1
    where (select count(*) from final_matches) = 3
      and (select count(*) from finalists) = 4
      and (select count(distinct player_id) from final_members) = 4
      and not exists (
        select match.id
        from final_matches as match
        left join final_members as member on member.match_id = match.id
        group by match.id
        having count(member.player_id) <> 4
          or count(distinct member.player_id) <> 4
          or count(*) filter (where member.team = 1) <> 2
          or count(*) filter (where member.team = 2) <> 2
      )
      and not exists (
        select finalist.player_id
        from finalists as finalist
        left join final_members as member on member.player_id = finalist.player_id
        group by finalist.player_id
        having count(member.match_id) <> 3
      )
      and not exists (
        select 1
        from final_members as member
        where not exists (
          select 1 from finalists as finalist where finalist.player_id = member.player_id
        )
      )
  ), player_elos as materialized (
    select finalist.*,
      round(coalesce(
        (private.match_detail_elo(
          finalist.player_id, p_season_id, p_at, p_context_match_id, false
        )->>'before')::numeric,
        finalist.initial_elo
      ))::integer as elo
    from finalists as finalist
  ), match_strengths as (
    select
      member.match_id,
      min(player.elo) filter (where member.team = 1) * 0.7
        + max(player.elo) filter (where member.team = 1) * 0.3 as team_one_elo,
      min(player.elo) filter (where member.team = 2) * 0.7
        + max(player.elo) filter (where member.team = 2) * 0.3 as team_two_elo
    from final_members as member
    join player_elos as player on player.player_id = member.player_id
    group by member.match_id
  ), match_probabilities as (
    select match_id,
      1 / (1 + power(10::numeric, (team_two_elo - team_one_elo) / 300)) as team_one
    from match_strengths
  ), player_expectations as (
    select member.player_id,
      sum(case when member.team = 1 then probability.team_one else 1 - probability.team_one end) as expected_wins
    from final_members as member
    join match_probabilities as probability on probability.match_id = member.match_id
    group by member.player_id
  ), forecast_base as (
    select player.player_id, player.league_rank,
      expectation.expected_wins * 100 / 6 as exact_percent,
      floor(expectation.expected_wins * 100 / 6)::integer as base_percent
    from player_elos as player
    join player_expectations as expectation on expectation.player_id = player.player_id
  ), forecast_ranked as (
    select *,
      row_number() over (
        order by exact_percent - base_percent desc, league_rank, player_id
      ) as remainder_rank,
      100 - sum(base_percent) over () as remainder_count
    from forecast_base
  ), forecasts as (
    select player_id,
      base_percent + case when remainder_rank <= remainder_count then 1 else 0 end as title_forecast
    from forecast_ranked
  ), finalist_ids as (
    select array_agg(player_id order by league_rank, seed, player_id) as ids
    from finalists
  ), player_facts as (
    select
      player.player_id,
      player.display_name,
      player.seed,
      player.league_rank,
      player.elo,
      forecast.title_forecast,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', recent.event_id,
          'kind', recent.kind,
          'outcome', recent.outcome,
          'date', recent.event_at,
          'label', recent.season_label
        ) order by recent.event_at desc, recent.event_id desc)
        from (
          select history.*
          from private.match_detail_history(
            array[player.player_id], p_at, p_context_match_id, false
          ) as history
          where history.complete
            and history.outcome in ('win', 'loss', 'draw')
          order by history.event_at desc, history.event_id desc
          limit 5
        ) as recent
      ), '[]'::jsonb) as form,
      case
        when coalesce((streak.value->>'length')::integer, 0) >= 3 then streak.value
        else null
      end as streak,
      private.final_four_prematch_relationships(
        player.player_id, finalist_ids.ids, p_at, p_context_match_id
      ) as relationships
    from player_elos as player
    join forecasts as forecast on forecast.player_id = player.player_id
    cross join finalist_ids
    cross join lateral (
      select private.match_detail_streak(
        player.player_id, p_at, p_context_match_id, false
      ) as value
    ) as streak
  )
  select jsonb_build_object(
    'seasonId', p_season_id,
    'players', jsonb_agg(jsonb_build_object(
      'playerId', player.player_id,
      'displayName', player.display_name,
      'seed', player.seed,
      'leagueRank', player.league_rank,
      'elo', player.elo,
      'titleForecast', player.title_forecast,
      'form', player.form,
      'streak', player.streak,
      'relationships', player.relationships
    ) order by player.league_rank, player.seed, player.player_id)
  )
  from player_facts as player
  cross join validation
  group by p_season_id;
$$;

revoke all on function private.build_final_four_prematch_facts_base(text, timestamptz, text)
  from public, anon, authenticated;

commit;
