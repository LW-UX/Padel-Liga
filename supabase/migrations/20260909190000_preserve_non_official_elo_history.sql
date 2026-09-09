begin;

create or replace function private.recalculate_global_elo_from_point(
  p_replay_at timestamptz,
  p_replay_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ratings jsonb := '{}'::jsonb;
  previous_rating record;
  played_match record;
  team_one_ids text[];
  team_two_ids text[];
  score_one integer[];
  score_two integer[];
  regular_set_count integer;
  regular_difference numeric;
  tiebreak_difference numeric;
  point_factor numeric;
  current_player_id text;
  player_old integer;
  player_new integer;
  opponent_one integer;
  opponent_two integer;
  expected numeric;
  won_score integer;
begin
  perform pg_advisory_xact_lock(70317, 20270909);

  if p_replay_at is null or p_replay_id is null then
    raise exception 'Für die globale Elo-Neuberechnung fehlt der Startpunkt.';
  end if;

  if exists (
    select 1
    from public.matches as first_match
    join public.seasons as first_season
      on first_season.id = first_match.season_id
     and first_season.counts_for_profile
    join public.match_players as first_member on first_member.match_id = first_match.id
    join public.matches as second_match
      on second_match.match_at = first_match.match_at
     and second_match.id > first_match.id
     and second_match.counts_for_elo
     and second_match.actual_sets is not null
     and second_match.winner is not null
    join public.seasons as second_season
      on second_season.id = second_match.season_id
     and second_season.counts_for_profile
    join public.match_players as second_member
      on second_member.match_id = second_match.id
     and second_member.player_id = first_member.player_id
    where first_match.counts_for_elo
      and first_match.actual_sets is not null
      and first_match.winner is not null
      and first_match.match_at is not null
  ) then
    raise exception 'Ein Spieler kann nicht zwei offizielle Elo-Partien zum gleichen Zeitpunkt bestreiten.';
  end if;

  select coalesce(jsonb_object_agg(player.id, player.initial_elo), '{}'::jsonb)
  into ratings
  from public.players as player
  where player.initial_elo is not null;

  for previous_rating in
    select distinct on (change.player_id)
      change.player_id,
      change.new_elo
    from public.match_elo_changes as change
    join public.matches as match on match.id = change.match_id
    join public.seasons as season
      on season.id = match.season_id
     and season.counts_for_profile
    where match.counts_for_elo
      and (match.match_at, match.id) < (p_replay_at, p_replay_id)
    order by change.player_id, match.match_at desc, match.id desc
  loop
    ratings := jsonb_set(
      ratings,
      array[previous_rating.player_id],
      to_jsonb(previous_rating.new_elo),
      true
    );
  end loop;

  delete from public.match_elo_changes as change
  using public.matches as match, public.seasons as season
  where change.match_id = match.id
    and season.id = match.season_id
    and season.counts_for_profile
    and (
      match.id = p_replay_id
      or (match.match_at, match.id) >= (p_replay_at, p_replay_id)
    );

  for played_match in
    select match.*
    from public.matches as match
    join public.seasons as season
      on season.id = match.season_id
     and season.counts_for_profile
    where match.counts_for_elo
      and match.actual_sets is not null
      and match.winner is not null
      and match.match_at is not null
      and (match.match_at, match.id) >= (p_replay_at, p_replay_id)
    order by match.match_at, match.id
  loop
    select
      array_agg(member.player_id order by member.position) filter (where member.team = 1),
      array_agg(member.player_id order by member.position) filter (where member.team = 2)
    into team_one_ids, team_two_ids
    from public.match_players as member
    where member.match_id = played_match.id;

    if cardinality(team_one_ids) <> 2 or cardinality(team_two_ids) <> 2 then
      raise exception 'Für % fehlen vollständige Teams.', played_match.id;
    end if;

    foreach current_player_id in array team_one_ids || team_two_ids loop
      if not ratings ? current_player_id then
        raise exception 'Für Spieler % fehlt der globale Initial-Elo.', current_player_id;
      end if;
    end loop;

    select
      array_agg((score.capture)[1]::integer order by score.ordinality),
      array_agg((score.capture)[2]::integer order by score.ordinality)
    into score_one, score_two
    from regexp_matches(
      regexp_replace(played_match.result_details, '\([^)]*\)', '', 'g'),
      '([0-9]+)\s*:\s*([0-9]+)',
      'g'
    ) with ordinality as score(capture, ordinality);

    regular_set_count := case when played_match.format = 'single-set' then 1 else 2 end;
    if cardinality(score_one) < regular_set_count then
      raise exception 'Für % ist kein vollständiges Ergebnis vorhanden.', played_match.id;
    end if;

    select abs(sum(score_one[position]) - sum(score_two[position]))
    into regular_difference
    from generate_series(1, regular_set_count) as positions(position);

    tiebreak_difference := case
      when played_match.format <> 'single-set' and cardinality(score_one) >= 3
        then (abs(score_one[3] - score_two[3])::numeric / 10) * 3
      else 0
    end;
    point_factor := power(log(10::numeric, regular_difference + tiebreak_difference + 1), 3) + 2;

    foreach current_player_id in array team_one_ids loop
      player_old := (ratings ->> current_player_id)::integer;
      opponent_one := (ratings ->> team_two_ids[1])::integer;
      opponent_two := (ratings ->> team_two_ids[2])::integer;
      expected := (
        1 / (1 + power(10::numeric, (opponent_one - player_old)::numeric / 500))
        + 1 / (1 + power(10::numeric, (opponent_two - player_old)::numeric / 500))
      ) / 2;
      won_score := case when played_match.winner = 1 then 1 else 0 end;
      player_new := round(player_old + point_factor * 50 * (won_score - expected));
      insert into public.match_elo_changes (match_id, player_id, old_elo, new_elo)
      values (played_match.id, current_player_id, player_old, player_new);
    end loop;

    foreach current_player_id in array team_two_ids loop
      player_old := (ratings ->> current_player_id)::integer;
      opponent_one := (ratings ->> team_one_ids[1])::integer;
      opponent_two := (ratings ->> team_one_ids[2])::integer;
      expected := (
        1 / (1 + power(10::numeric, (opponent_one - player_old)::numeric / 500))
        + 1 / (1 + power(10::numeric, (opponent_two - player_old)::numeric / 500))
      ) / 2;
      won_score := case when played_match.winner = 2 then 1 else 0 end;
      player_new := round(player_old + point_factor * 50 * (won_score - expected));
      insert into public.match_elo_changes (match_id, player_id, old_elo, new_elo)
      values (played_match.id, current_player_id, player_old, player_new);
    end loop;

    foreach current_player_id in array team_one_ids || team_two_ids loop
      select change.new_elo into player_new
      from public.match_elo_changes as change
      where change.match_id = played_match.id
        and change.player_id = current_player_id;
      ratings := jsonb_set(ratings, array[current_player_id], to_jsonb(player_new), true);
    end loop;
  end loop;

  update public.season_players as participant
  set end_elo = coalesce((
    select change.new_elo
    from public.match_elo_changes as change
    join public.matches as match on match.id = change.match_id
    join public.seasons as event_season
      on event_season.id = match.season_id
     and event_season.counts_for_profile
    where change.player_id = participant.player_id
      and match.counts_for_elo
      and match.match_at <= completed_season.season_end_at
    order by match.match_at desc, match.id desc
    limit 1
  ), (
    select player.initial_elo
    from public.players as player
    where player.id = participant.player_id
  ), participant.start_elo)
  from (
    select season.id, max(match.match_at) as season_end_at
    from public.seasons as season
    join public.matches as match on match.season_id = season.id
    where season.completed_at is not null
    group by season.id
    having max(match.match_at) >= p_replay_at
  ) as completed_season
  where participant.season_id = completed_season.id;

  update public.seasons as season
  set elo_final_date = (
    select (max(match.match_at) at time zone 'Europe/Berlin')::date
    from public.matches as match
    where match.season_id = season.id
  )
  where season.completed_at is not null
    and exists (
      select 1
      from public.matches as match
      where match.season_id = season.id
      group by match.season_id
      having max(match.match_at) >= p_replay_at
    );
end;
$$;

commit;
