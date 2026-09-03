begin;

create or replace function private.profile_match_weight(
  p_kind text,
  p_result_details text
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  with scores as (
    select
      (capture)[1]::integer as team_one,
      (capture)[2]::integer as team_two
    from regexp_matches(
      regexp_replace(coalesce(p_result_details, ''), '\([^)]*\)', '', 'g'),
      '([0-9]+)\s*:\s*([0-9]+)',
      'g'
    ) as score(capture)
  ), regular_sets as (
    select count(*) filter (where team_one <= 7 and team_two <= 7) as set_count
    from scores
  )
  select case
    when p_kind = 'training' and set_count = 1 then 0.5::numeric
    else 1::numeric
  end
  from regular_sets;
$$;

create or replace function public.get_player_profile(p_player_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with selected_player as (
    select player.* from public.players as player where player.id = p_player_id
  ), career as (
    select
      history.*,
      private.profile_match_weight(history.kind, history.result_details) as match_weight
    from private.player_profile_match_rows as history
    where history.player_id = p_player_id
  ), scored_career as (
    select * from career where is_complete
  ), elo_events as (
    select
      participant.season_id,
      season.label as season_label,
      season.starts_on as event_date,
      null::text as display_time,
      'Start'::text as label,
      participant.start_elo as elo,
      0 as event_order
    from public.season_players as participant
    join public.seasons as season
      on season.id = participant.season_id
     and season.counts_for_profile
    where participant.player_id = p_player_id
    union all
    select
      match.season_id,
      season.label,
      match.scheduled_date,
      match.display_time,
      coalesce(match.display_label, 'Partie ' || match.matchday),
      change.new_elo,
      1
    from public.match_elo_changes as change
    join public.matches as match on match.id = change.match_id and match.counts_for_elo
    join public.seasons as season on season.id = match.season_id and season.counts_for_profile
    where change.player_id = p_player_id
  ), ordered_elo as (
    select * from elo_events
    order by event_date nulls last, display_time nulls last, event_order, label
  )
  select case when exists (select 1 from selected_player) then jsonb_build_object(
    'identity', (
      select jsonb_build_object(
        'id', player.id,
        'displayName', player.display_name,
        'initials', player.initials,
        'company', player.company
      ) from selected_player as player
    ),
    'summary', jsonb_build_object(
      'currentElo', (select elo from ordered_elo order by event_date desc nulls last, display_time desc nulls last, event_order desc limit 1),
      'peakElo', (select max(elo) from ordered_elo),
      'matches', coalesce((select sum(match_weight) from scored_career), 0),
      'wins', coalesce((select sum(match_weight) from scored_career where outcome = 'win'), 0),
      'losses', coalesce((select sum(match_weight) from scored_career where outcome = 'loss'), 0),
      'gamesFor', coalesce((select sum(games_for) from scored_career), 0),
      'gamesAgainst', coalesce((select sum(games_against) from scored_career), 0),
      'gameDiff', coalesce((select sum(games_for - games_against) from scored_career), 0)
    ),
    'eloSeries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'seasonId', event.season_id,
        'seasonLabel', event.season_label,
        'date', event.event_date,
        'label', event.label,
        'elo', event.elo
      ) order by event.event_date nulls last, event.display_time nulls last, event.event_order, event.label)
      from ordered_elo as event
    ), '[]'::jsonb),
    'participations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'seasonId', stats.season_id,
        'seasonLabel', stats.season_label,
        'isActive', stats.is_active,
        'rank', stats.rank,
        'matches', stats.matches,
        'wins', stats.wins,
        'losses', stats.matches - stats.wins,
        'points', stats.points,
        'gameDiff', stats.games_for - stats.games_against
      ) order by stats.is_active desc, stats.season_id desc)
      from private.season_player_statistics as stats
      where stats.player_id = p_player_id
    ), '[]'::jsonb),
    'achievements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', achievement.id,
        'kind', achievement.kind,
        'title', achievement.title,
        'subtitle', achievement.subtitle,
        'achievedOn', achievement.achieved_on,
        'seasonId', achievement.season_id
      ) order by achievement.priority desc, achievement.achieved_on desc nulls last, achievement.id)
      from public.player_achievements as achievement
      left join public.seasons as season on season.id = achievement.season_id
      where achievement.player_id = p_player_id
        and (achievement.season_id is null or season.counts_for_profile)
    ), '[]'::jsonb),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', history.row_id,
        'kind', history.kind,
        'matchWeight', history.match_weight,
        'date', history.played_on,
        'seasonId', history.season_id,
        'seasonLabel', history.season_label,
        'resultDetails', history.result_details,
        'team', history.team,
        'outcome', history.outcome,
        'isComplete', history.is_complete,
        'trainingSessionId', history.training_session_id,
        'trainingRoundNumber', history.training_round_number,
        'partnerNames', to_jsonb(history.partner_names),
        'opponentNames', to_jsonb(history.opponent_names)
      ) order by history.played_on desc nulls last, history.display_time desc nulls last,
        history.training_session_id desc nulls last, history.training_round_number asc nulls last, history.row_id desc)
      from career as history
    ), '[]'::jsonb)
  ) else null end;
$$;

revoke execute on function public.get_player_profile(text) from public;
grant execute on function public.get_player_profile(text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
