begin;

create or replace view private.player_profile_match_rows as
select
  member.player_id,
  match.id as row_id,
  case when match.competition_stage = 'final_four' then 'final-four' else 'league' end::text as kind,
  (match.match_at at time zone 'Europe/Berlin')::date as played_on,
  to_char(match.match_at at time zone 'Europe/Berlin', 'HH24.MI') as display_time,
  match.season_id,
  season.label as season_label,
  member.team,
  match.result_details,
  case when match.winner = member.team then 'win' else 'loss' end::text as outcome,
  coalesce((
    select array_agg(player.display_name order by teammate.position)
    from public.match_players as teammate
    join public.players as player on player.id = teammate.player_id
    where teammate.match_id = match.id and teammate.team = member.team
      and teammate.player_id <> member.player_id
  ), '{}')::text[] as partner_names,
  coalesce((
    select array_agg(player.display_name order by opponent.position)
    from public.match_players as opponent
    join public.players as player on player.id = opponent.player_id
    where opponent.match_id = match.id and opponent.team <> member.team
  ), '{}')::text[] as opponent_names,
  case member.team
    when 1 then (private.profile_regular_game_totals(match.result_details))[1]
    else (private.profile_regular_game_totals(match.result_details))[2]
  end as games_for,
  case member.team
    when 1 then (private.profile_regular_game_totals(match.result_details))[2]
    else (private.profile_regular_game_totals(match.result_details))[1]
  end as games_against,
  case
    when not match.counts_for_ranking then 0
    when member.team = 1 and match.actual_sets = '2:0' then 3
    when member.team = 1 and match.actual_sets = '2:1' then 2
    when member.team = 1 and match.actual_sets = '1:2' then 1
    when member.team = 2 and match.actual_sets = '0:2' then 3
    when member.team = 2 and match.actual_sets = '1:2' then 2
    when member.team = 2 and match.actual_sets = '2:1' then 1
    else 0
  end as points,
  match.counts_for_ranking,
  true as is_complete,
  null::bigint as training_session_id,
  null::integer as training_round_number
from public.matches as match
join public.seasons as season on season.id = match.season_id and season.counts_for_profile
join public.match_players as member on member.match_id = match.id
where match.actual_sets is not null and match.winner is not null
  and match.match_type in ('season', 'final')

union all

select
  participant.player_id,
  'training-' || session.id || '-' || round.round_number,
  'training'::text,
  session.played_on,
  to_char(session.display_time, 'HH24.MI'),
  null::text,
  'Training'::text,
  case when participant.player_id = any(round.team_one_ids) then 1 else 2 end::smallint,
  round.result_details,
  case
    when not round.is_complete then 'unfinished'
    when (private.profile_set_win_totals(round.result_details, round.set_count))[1]
       = (private.profile_set_win_totals(round.result_details, round.set_count))[2] then 'draw'
    when participant.player_id = any(round.team_one_ids)
      then case when (private.profile_set_win_totals(round.result_details, round.set_count))[1]
                   > (private.profile_set_win_totals(round.result_details, round.set_count))[2]
                then 'win' else 'loss' end
    else case when (private.profile_set_win_totals(round.result_details, round.set_count))[2]
                 > (private.profile_set_win_totals(round.result_details, round.set_count))[1]
              then 'win' else 'loss' end
  end::text,
  coalesce((
    select array_agg(player.display_name order by member.ordinality)
    from unnest(case when participant.player_id = any(round.team_one_ids)
      then round.team_one_ids else round.team_two_ids end)
      with ordinality as member(player_id, ordinality)
    join public.players as player on player.id = member.player_id
    where member.player_id <> participant.player_id
  ), '{}')::text[],
  coalesce((
    select array_agg(player.display_name order by member.ordinality)
    from unnest(case when participant.player_id = any(round.team_one_ids)
      then round.team_two_ids else round.team_one_ids end)
      with ordinality as member(player_id, ordinality)
    join public.players as player on player.id = member.player_id
  ), '{}')::text[],
  case when participant.player_id = any(round.team_one_ids)
    then (private.profile_regular_game_totals(round.result_details))[1]
    else (private.profile_regular_game_totals(round.result_details))[2] end,
  case when participant.player_id = any(round.team_one_ids)
    then (private.profile_regular_game_totals(round.result_details))[2]
    else (private.profile_regular_game_totals(round.result_details))[1] end,
  0,
  false,
  round.is_complete,
  session.id,
  round.round_number
from public.training_sessions as session
join public.training_rounds as round on round.session_id = session.id
cross join lateral unnest(session.player_ids) as participant(player_id)
where session.status = 'confirmed';

create or replace function private.profile_match_weight(
  p_kind text,
  p_result_details text
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kind = 'training' then (private.profile_training_metrics(p_result_details))[1] * 0.5::numeric
    when p_kind = 'final-four' then 0.5::numeric
    else 1::numeric
  end;
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
  ), career_source as (
    select history.*, private.profile_training_metrics(history.result_details) as training_metrics,
      private.profile_match_weight(history.kind, history.result_details) as match_weight
    from private.player_profile_match_rows as history
    where history.player_id = p_player_id
  ), career as (
    select source.*,
      case
        when source.kind <> 'training' then source.outcome
        when (source.training_metrics)[1] = 0 then 'unfinished'
        when (case when source.team = 1 then (source.training_metrics)[2] else (source.training_metrics)[3] end)
           = (case when source.team = 1 then (source.training_metrics)[3] else (source.training_metrics)[2] end) then 'draw'
        when (case when source.team = 1 then (source.training_metrics)[2] else (source.training_metrics)[3] end)
           > (case when source.team = 1 then (source.training_metrics)[3] else (source.training_metrics)[2] end) then 'win'
        else 'loss'
      end::text as weighted_outcome,
      case
        when source.kind = 'training'
          then (case when source.team = 1 then (source.training_metrics)[2] else (source.training_metrics)[3] end) * 0.5::numeric
        when source.kind = 'final-four' and source.outcome = 'win' then 0.5::numeric
        else case when source.outcome = 'win' then 1::numeric else 0::numeric end
      end as win_weight,
      case
        when source.kind = 'training'
          then (case when source.team = 1 then (source.training_metrics)[3] else (source.training_metrics)[2] end) * 0.5::numeric
        when source.kind = 'final-four' and source.outcome = 'loss' then 0.5::numeric
        else case when source.outcome = 'loss' then 1::numeric else 0::numeric end
      end as loss_weight,
      case when source.kind = 'training'
        then case when source.team = 1 then (source.training_metrics)[4] else (source.training_metrics)[5] end
        else source.games_for end as weighted_games_for,
      case when source.kind = 'training'
        then case when source.team = 1 then (source.training_metrics)[5] else (source.training_metrics)[4] end
        else source.games_against end as weighted_games_against
    from career_source as source
  ), scored_career as (
    select * from career where match_weight > 0
  ), first_participation as (
    select participant.season_id, season.label, season.starts_on
    from public.season_players as participant
    join public.seasons as season on season.id = participant.season_id and season.counts_for_profile
    where participant.player_id = p_player_id
    order by season.starts_on nulls last, season.id
    limit 1
  ), elo_events as (
    select first_participation.season_id, first_participation.label as season_label,
      first_participation.starts_on::timestamp at time zone 'Europe/Berlin' as event_at,
      'Start'::text as label, player.initial_elo as elo, null::integer as old_elo,
      null::integer as delta, 'initial'::text as event_type, null::text as match_id
    from selected_player as player
    cross join first_participation
    where player.initial_elo is not null
    union all
    select match.season_id, season.label, match.match_at,
      coalesce(match.display_label, 'Partie ' || match.matchday), change.new_elo,
      change.old_elo, change.delta, 'match', match.id
    from public.match_elo_changes as change
    join public.matches as match on match.id = change.match_id and match.counts_for_elo
    join public.seasons as season on season.id = match.season_id and season.counts_for_profile
    where change.player_id = p_player_id
  ), ordered_elo as (
    select * from elo_events order by event_at nulls last, match_id nulls first
  )
  select case when exists (select 1 from selected_player) then jsonb_build_object(
    'identity', (select jsonb_build_object(
      'id', player.id, 'displayName', player.display_name,
      'initials', player.initials, 'company', player.company
    ) from selected_player as player),
    'summary', jsonb_build_object(
      'currentElo', coalesce(
        (select elo from ordered_elo order by event_at desc nulls last, match_id desc nulls last limit 1),
        (select initial_elo from selected_player)
      ),
      'peakElo', (select max(elo) from ordered_elo),
      'matches', coalesce((select sum(match_weight) from scored_career), 0),
      'wins', coalesce((select sum(win_weight) from scored_career), 0),
      'losses', coalesce((select sum(loss_weight) from scored_career), 0),
      'gamesFor', coalesce((select sum(weighted_games_for) from scored_career), 0),
      'gamesAgainst', coalesce((select sum(weighted_games_against) from scored_career), 0),
      'gameDiff', coalesce((select sum(weighted_games_for - weighted_games_against) from scored_career), 0)
    ),
    'eloSeries', coalesce((select jsonb_agg(jsonb_build_object(
      'eventType', event.event_type,
      'matchId', event.match_id,
      'seasonId', event.season_id,
      'seasonLabel', event.season_label,
      'matchAt', event.event_at,
      'date', (event.event_at at time zone 'Europe/Berlin')::date,
      'label', event.label,
      'oldElo', event.old_elo,
      'elo', event.elo,
      'delta', event.delta
    ) order by event.event_at nulls last, event.match_id nulls first)
      from ordered_elo as event), '[]'::jsonb),
    'participations', coalesce((select jsonb_agg(jsonb_build_object(
      'seasonId', stats.season_id, 'seasonLabel', stats.season_label, 'isActive', stats.is_active,
      'rank', stats.rank, 'matches', stats.matches, 'wins', stats.wins,
      'losses', stats.matches - stats.wins, 'points', stats.points,
      'gameDiff', stats.games_for - stats.games_against
    ) order by stats.is_active desc, stats.season_id desc)
      from private.season_player_statistics as stats where stats.player_id = p_player_id), '[]'::jsonb),
    'achievements', coalesce((select jsonb_agg(jsonb_build_object(
      'id', achievement.id, 'kind', achievement.kind, 'title', achievement.title,
      'subtitle', achievement.subtitle, 'achievedOn', achievement.achieved_on,
      'seasonId', achievement.season_id
    ) order by achievement.priority desc, achievement.achieved_on desc nulls last, achievement.id)
      from public.player_achievements as achievement
      left join public.seasons as season on season.id = achievement.season_id
      where achievement.player_id = p_player_id
        and (achievement.season_id is null or season.counts_for_profile)), '[]'::jsonb),
    'matches', coalesce((select jsonb_agg(jsonb_build_object(
      'id', history.row_id, 'kind', history.kind, 'matchWeight', history.match_weight,
      'winWeight', history.win_weight, 'lossWeight', history.loss_weight,
      'date', history.played_on, 'seasonId', history.season_id,
      'seasonLabel', history.season_label, 'resultDetails', history.result_details,
      'team', history.team, 'outcome', history.weighted_outcome,
      'isComplete', history.is_complete, 'trainingSessionId', history.training_session_id,
      'trainingRoundNumber', history.training_round_number,
      'partnerNames', to_jsonb(history.partner_names), 'opponentNames', to_jsonb(history.opponent_names)
    ) order by history.played_on desc nulls last, history.display_time desc nulls last,
      history.training_session_id desc nulls last, history.training_round_number asc nulls last, history.row_id desc)
      from career as history), '[]'::jsonb)
  ) else null end;
$$;

commit;
