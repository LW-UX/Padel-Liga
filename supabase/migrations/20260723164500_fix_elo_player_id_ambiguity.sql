begin;

create or replace function private.recalculate_season_elo(p_season_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ratings jsonb := '{}'::jsonb;
  played_match record;
  team_one_ids text[];
  team_two_ids text[];
  score_one integer[];
  score_two integer[];
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
  delete from public.match_elo_changes as change
  using public.matches as match
  where change.match_id = match.id
    and match.season_id = p_season_id;

  select coalesce(jsonb_object_agg(participant.player_id, participant.start_elo), '{}'::jsonb)
  into ratings
  from public.season_players as participant
  where participant.season_id = p_season_id;

  for played_match in
    select match.*
    from public.matches as match
    where match.season_id = p_season_id
      and match.actual_sets is not null
      and match.winner is not null
      and match.match_type in ('season', 'final')
    order by match.scheduled_date nulls last, match.display_time nulls last, match.id
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

    select
      array_agg((score.capture)[1]::integer order by score.ordinality),
      array_agg((score.capture)[2]::integer order by score.ordinality)
    into score_one, score_two
    from regexp_matches(
      regexp_replace(played_match.result_details, '\([^)]*\)', '', 'g'),
      '([0-9]+)\s*:\s*([0-9]+)',
      'g'
    ) with ordinality as score(capture, ordinality);

    if cardinality(score_one) < 2 then
      raise exception 'Für % ist kein vollständiges Satzergebnis vorhanden.', played_match.id;
    end if;

    regular_difference := abs((score_one[1] + score_one[2]) - (score_two[1] + score_two[2]));
    tiebreak_difference := case
      when cardinality(score_one) >= 3 then (abs(score_one[3] - score_two[3])::numeric / 10) * 3
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
      select change.new_elo
      into player_new
      from public.match_elo_changes as change
      where change.match_id = played_match.id
        and change.player_id = current_player_id;
      ratings := jsonb_set(ratings, array[current_player_id], to_jsonb(player_new), true);
    end loop;
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;
