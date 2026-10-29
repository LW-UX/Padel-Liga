begin;

-- Five chronological form events before the viewed match. An official match is
-- one event; all rated pairings of one confirmed training session share one
-- event so the client can render them as an overlapping group.
create or replace function private.match_detail_recent_form(
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
  with viewed_context as (
    select
      not season.counts_for_profile
        and season.id in ('test-2026', '2026-test') as test_mode
    from public.seasons as season
    where season.id = p_season_id
  ), official_events as (
    select
      match.match_at as event_at,
      match.id as event_id,
      jsonb_build_object(
        'groupId', match.id,
        'kind', 'official',
        'date', match.match_at,
        'competition', season.label,
        'matches', jsonb_build_array(jsonb_build_object(
          'matchId', match.id,
          'label', coalesce(match.display_label, 'Partie ' || coalesce(substring(match.id from '([0-9]+)$'), match.matchday::text)),
          'date', match.match_at,
          'competition', season.label,
          'result', match.result_details,
          'outcome', case when match.winner = member.team then 'win' else 'loss' end,
          'decidedByMatchTiebreak', match.actual_sets in ('2:1', '1:2'),
          'partnerNames', to_jsonb(array(
            select player.display_name
            from public.match_players as teammate
            join public.players as player on player.id = teammate.player_id
            where teammate.match_id = match.id
              and teammate.team = member.team
              and teammate.player_id <> p_player_id
            order by teammate.position
          )),
          'opponentNames', to_jsonb(array(
            select player.display_name
            from public.match_players as opponent
            join public.players as player on player.id = opponent.player_id
            where opponent.match_id = match.id
              and opponent.team <> member.team
            order by opponent.position
          ))
        ))
      ) as value
    from public.matches as match
    join public.match_players as member
      on member.match_id = match.id
     and member.player_id = p_player_id
    join public.seasons as season on season.id = match.season_id
    cross join viewed_context as context
    where match.cancelled_at is null
      and match.winner is not null
      and match.actual_sets is not null
      and match.result_details is not null
      and match.match_at is not null
      and match.match_type in ('season', 'final')
      and (match.competition_stage <> 'league' or match.counts_for_ranking)
      and (match.match_at, match.id) < (p_cutoff_at, p_cutoff_id)
      and (
        (context.test_mode and match.season_id = p_season_id)
        or (not context.test_mode and season.counts_for_profile)
      )
  ), training_round_source as (
    select
      session.id as session_id,
      session.played_on,
      session.display_time,
      session.guest_names,
      round.round_number,
      round.team_one_ids,
      round.team_two_ids,
      round.result_details,
      private.profile_training_metrics(round.result_details) as metrics,
      private.training_session_at(session.played_on, session.display_time) as event_at
    from public.training_sessions as session
    join public.training_rounds as round on round.session_id = session.id
    cross join viewed_context as context
    where session.status = 'confirmed'
      and round.is_complete
      and p_player_id = any(round.team_one_ids || round.team_two_ids)
      and private.training_session_at(session.played_on, session.display_time) < p_cutoff_at
      and (
        (context.test_mode and session.player_ids && array['ludi_gmail', 'ludi_gmx', 'ludi_ionos', 'test_net']::text[])
        or (not context.test_mode and not (session.player_ids && array['ludi_gmail', 'ludi_gmx', 'ludi_ionos', 'test_net']::text[]))
      )
  ), rated_training_rounds as (
    select source.*
    from training_round_source as source
    where source.metrics[1] > 0
      and source.metrics[2] <> source.metrics[3]
  ), training_events as (
    select
      round.event_at,
      'training-' || round.session_id as event_id,
      jsonb_build_object(
        'groupId', 'training-' || round.session_id,
        'kind', 'training',
        'date', round.event_at,
        'competition', 'Training',
        'matches', jsonb_agg(jsonb_build_object(
          'matchId', 'training-' || round.session_id || '-' || round.round_number,
          'label', 'Training · Paarung ' || round.round_number,
          'date', round.event_at,
          'competition', 'Training',
          'result', round.result_details,
          'outcome', case
            when p_player_id = any(round.team_one_ids)
              then case when round.metrics[2] > round.metrics[3] then 'win' else 'loss' end
            else case when round.metrics[3] > round.metrics[2] then 'win' else 'loss' end
          end,
          'decidedByMatchTiebreak', round.result_details ~ '[–-]',
          'partnerNames', to_jsonb(array(
            select private.training_participant_display_name(participant.player_id, round.guest_names)
            from unnest(case when p_player_id = any(round.team_one_ids)
              then round.team_one_ids else round.team_two_ids end)
              with ordinality as participant(player_id, ordinality)
            where participant.player_id <> p_player_id
            order by participant.ordinality
          )),
          'opponentNames', to_jsonb(array(
            select private.training_participant_display_name(participant.player_id, round.guest_names)
            from unnest(case when p_player_id = any(round.team_one_ids)
              then round.team_two_ids else round.team_one_ids end)
              with ordinality as participant(player_id, ordinality)
            order by participant.ordinality
          ))
        ) order by round.round_number)
      ) as value
    from rated_training_rounds as round
    group by round.session_id, round.event_at
  ), form_events as (
    select event_at, event_id, value from official_events
    union all
    select event_at, event_id, value from training_events
  ), recent as (
    select event_at, event_id, value
    from form_events
    order by event_at desc, event_id desc
    limit 5
  )
  select coalesce(jsonb_agg(recent.value order by recent.event_at, recent.event_id), '[]'::jsonb)
  from recent;
$$;

revoke all on function private.match_detail_recent_form(text,text,text,timestamptz,text)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
