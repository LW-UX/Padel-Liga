begin;

create or replace function public.get_public_all_time_statistics()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with completed_matches as materialized (
    select
      match.*,
      season.label as season_label,
      season.visual_theme as season_visual_theme
    from public.matches as match
    join public.seasons as season
      on season.id = match.season_id
     and season.counts_for_profile
    where match.actual_sets is not null
      and match.winner is not null
      and match.match_type in ('season', 'final')
  ), career_players as (
    select player.*
    from public.players as player
    where exists (
      select 1
      from completed_matches as match
      join public.match_players as member on member.match_id = match.id
      where member.player_id = player.id
    )
  ), ranking_players as (
    select player.*
    from public.players as player
    where exists (
      select 1
      from public.season_players as participant
      join public.seasons as season
        on season.id = participant.season_id
       and season.counts_for_profile
       and season.tournament_mode in ('none', 'direct_final_four', 'top8_semifinals')
      where participant.player_id = player.id
    )
  ), training_round_metrics as materialized (
    select
      session.id as session_id,
      session.played_on,
      session.display_time,
      round.round_number,
      round.team_one_ids,
      round.team_two_ids,
      private.profile_training_metrics(round.result_details) as metrics,
      (
        select array[
          count(*) filter (where (score.capture)[1]::integer > (score.capture)[2]::integer),
          count(*) filter (where (score.capture)[2]::integer > (score.capture)[1]::integer)
        ]::integer[]
        from regexp_matches(
          (regexp_split_to_array(
            regexp_replace(coalesce(round.result_details, ''), '\([^)]*\)', '', 'g'),
            '\s*[–-]\s*'
          ))[1],
          '([0-9]+)\s*:\s*([0-9]+)',
          'g'
        ) as score(capture)
        where private.training_regular_set_state(
          (score.capture)[1]::integer,
          (score.capture)[2]::integer
        ) = 'complete'
      ) as set_wins
    from public.training_sessions as session
    join public.training_rounds as round on round.session_id = session.id
    where session.status = 'confirmed'
  ), scored_training_rounds as (
    select
      metric.*,
      -- Ein durch Match-Tiebreak entschiedenes Training zählt als volle Partie mit 2:1 Sätzen.
      metric.metrics[1] = 2
        and metric.set_wins[1] = 1
        and metric.set_wins[2] = 1
        and metric.metrics[2] + metric.metrics[3] = 2 as decided_by_match_tiebreak
    from training_round_metrics as metric
    where metric.metrics[1] > 0
  ), training_players as (
    select player.*
    from public.players as player
    where exists (
      select 1
      from scored_training_rounds as round
      where player.id = any(round.team_one_ids || round.team_two_ids)
    )
  )
  select jsonb_build_object(
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'playerId', player.id,
        'currentElo', coalesce((
          select change.new_elo
          from public.match_elo_changes as change
          join completed_matches as match on match.id = change.match_id
          where change.player_id = player.id
            and match.counts_for_elo
          order by match.match_at desc, match.id desc
          limit 1
        ), player.initial_elo),
        'eloHistory', coalesce((
          select jsonb_agg(event.payload order by event.event_at, event.event_order, event.match_id)
          from (
            select
              first_participation.starts_on::timestamp at time zone 'Europe/Berlin' as event_at,
              0 as event_order,
              ''::text as match_id,
              jsonb_build_object(
                'eventType', 'initial',
                'matchId', null,
                'seasonId', first_participation.season_id,
                'seasonLabel', first_participation.season_label,
                'matchAt', first_participation.starts_on::timestamp at time zone 'Europe/Berlin',
                'date', first_participation.starts_on,
                'label', 'Start',
                'oldElo', null,
                'elo', player.initial_elo,
                'delta', null
              ) as payload
            from (
              select
                participant.season_id,
                season.label as season_label,
                season.starts_on
              from public.season_players as participant
              join public.seasons as season
                on season.id = participant.season_id
               and season.counts_for_profile
              where participant.player_id = player.id
              order by season.starts_on nulls last, season.id
              limit 1
            ) as first_participation
            where player.initial_elo is not null

            union all

            select
              match.match_at,
              1,
              match.id,
              jsonb_build_object(
                'eventType', 'match',
                'matchId', match.id,
                'seasonId', match.season_id,
                'seasonLabel', match.season_label,
                'matchAt', match.match_at,
                'date', (match.match_at at time zone 'Europe/Berlin')::date,
                'label', coalesce(match.display_label, 'Partie ' || match.matchday),
                'oldElo', change.old_elo,
                'elo', change.new_elo,
                'delta', change.delta
              )
            from public.match_elo_changes as change
            join completed_matches as match on match.id = change.match_id
            where change.player_id = player.id
              and match.counts_for_elo
          ) as event
        ), '[]'::jsonb)
      ) order by player.display_name)
      from career_players as player
    ), '[]'::jsonb),
    'rankingPlayers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'playerId', player.id,
        'currentElo', coalesce((
          select change.new_elo
          from public.match_elo_changes as change
          join completed_matches as match on match.id = change.match_id
          where change.player_id = player.id
            and match.counts_for_elo
          order by match.match_at desc, match.id desc
          limit 1
        ), player.initial_elo)
      ) order by player.display_name)
      from ranking_players as player
    ), '[]'::jsonb),
    'trainingPlayers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'playerId', player.id,
        'currentElo', coalesce((
          select change.new_elo
          from public.match_elo_changes as change
          join completed_matches as match on match.id = change.match_id
          where change.player_id = player.id
            and match.counts_for_elo
          order by match.match_at desc, match.id desc
          limit 1
        ), player.initial_elo)
      ) order by player.display_name)
      from training_players as player
    ), '[]'::jsonb),
    'trainingRounds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', 'training-' || round.session_id || '-' || round.round_number,
        'playedOn', round.played_on,
        'team1', jsonb_build_object('playerIds', coalesce((
          select jsonb_agg(member.player_id order by member.ordinality)
          from unnest(round.team_one_ids) with ordinality as member(player_id, ordinality)
          where exists (select 1 from public.players as player where player.id = member.player_id)
        ), '[]'::jsonb)),
        'team2', jsonb_build_object('playerIds', coalesce((
          select jsonb_agg(member.player_id order by member.ordinality)
          from unnest(round.team_two_ids) with ordinality as member(player_id, ordinality)
          where exists (select 1 from public.players as player where player.id = member.player_id)
        ), '[]'::jsonb)),
        'matchWeight', round.metrics[1] * 0.5,
        'team1Wins', round.metrics[2] * 0.5,
        'team2Wins', round.metrics[3] * 0.5,
        'team1Points', case
          when round.decided_by_match_tiebreak then case when round.metrics[2] = 2 then 2 else 1 end
          else round.set_wins[1] * 1.5
        end,
        'team2Points', case
          when round.decided_by_match_tiebreak then case when round.metrics[3] = 2 then 2 else 1 end
          else round.set_wins[2] * 1.5
        end,
        'team1Games', round.metrics[4],
        'team2Games', round.metrics[5]
      ) order by round.played_on, round.display_time, round.session_id, round.round_number)
      from scored_training_rounds as round
    ), '[]'::jsonb),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', match.id,
        'type', 'season',
        'stage', replace(match.competition_stage, '_', '-'),
        'seasonId', match.season_id,
        'seasonLabel', match.season_label,
        'seasonVisualTheme', match.season_visual_theme,
        'leagueId', match.league_id,
        'format', match.format,
        'countsForRanking', match.counts_for_ranking,
        'countsForElo', match.counts_for_elo,
        'matchday', match.matchday,
        'matchAt', match.match_at,
        'result', match.result_details,
        'sets', match.actual_sets,
        'winner', match.winner,
        'displayLabel', match.display_label,
        'team1', jsonb_build_object(
          'playerIds', coalesce((
            select jsonb_agg(member.player_id order by member.position)
            from public.match_players as member
            where member.match_id = match.id and member.team = 1
          ), '[]'::jsonb)
        ),
        'team2', jsonb_build_object(
          'playerIds', coalesce((
            select jsonb_agg(member.player_id order by member.position)
            from public.match_players as member
            where member.match_id = match.id and member.team = 2
          ), '[]'::jsonb)
        )
      ) order by match.match_at, match.id)
      from completed_matches as match
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.get_public_all_time_statistics() from public;
grant execute on function public.get_public_all_time_statistics() to anon, authenticated;

notify pgrst, 'reload schema';

commit;
