begin;

create or replace function private.get_match_forecast_state(
  p_match_id text,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_match record;
  selected_season record;
  selected_mode text;
  selected_prediction text;
  selected_vote smallint;
  team_one_votes integer;
  team_two_votes integer;
  total_votes integer;
  team_one_percentage integer;
  team_two_percentage integer;
  test_mode boolean;
  lone_winner_name text;
begin
  select match.* into selected_match
  from public.matches as match
  where match.id = p_match_id;
  if not found then return null; end if;

  select season.* into selected_season
  from public.seasons as season
  where season.id = selected_match.season_id;
  if not found then return null; end if;

  test_mode := not selected_season.counts_for_profile
    and selected_season.id in ('test-2026', '2026-test');
  selected_mode := private.match_forecast_mode(p_match_id);
  if selected_mode is null then return null; end if;

  select
    count(*) filter (where prediction.prediction in ('2:0', '2:1'))::integer,
    count(*) filter (where prediction.prediction in ('1:2', '0:2'))::integer
  into team_one_votes, team_two_votes
  from public.predictions as prediction
  where prediction.match_id = p_match_id;

  team_one_votes := coalesce(team_one_votes, 0);
  team_two_votes := coalesce(team_two_votes, 0);
  total_votes := team_one_votes + team_two_votes;
  team_one_percentage := case
    when total_votes = 0 then 0
    else round(team_one_votes * 100.0 / total_votes)::integer
  end;
  team_two_percentage := case
    when total_votes = 0 then 0
    else 100 - team_one_percentage
  end;

  -- Rückschau: Hat nur ein Tipper das Siegerteam getippt, alle anderen aber das Verliererteam,
  -- wird dessen Kontoname geliefert. Voraussetzung sind mindestens fünf abgegebene Tipps.
  if selected_mode = 'analysis' and total_votes >= 5
    and selected_match.actual_sets in ('2:0', '2:1', '1:2', '0:2') then
    if selected_match.actual_sets in ('2:0', '2:1') and team_one_votes = 1 then
      select profile.display_name into lone_winner_name
      from public.predictions as prediction
      join public.profiles as profile on profile.id = prediction.user_id
      where prediction.match_id = p_match_id and prediction.prediction in ('2:0', '2:1');
    elsif selected_match.actual_sets in ('1:2', '0:2') and team_two_votes = 1 then
      select profile.display_name into lone_winner_name
      from public.predictions as prediction
      join public.profiles as profile on profile.id = prediction.user_id
      where prediction.match_id = p_match_id and prediction.prediction in ('1:2', '0:2');
    end if;
  end if;

  if p_user_id is not null then
    select prediction.prediction into selected_prediction
    from public.predictions as prediction
    where prediction.match_id = p_match_id
      and prediction.user_id = p_user_id;
  end if;

  selected_vote := case
    when selected_prediction in ('2:0', '2:1') then 1
    when selected_prediction in ('1:2', '0:2') then 2
    else null
  end;

  return jsonb_build_object(
    'matchId', selected_match.id,
    'mode', selected_mode,
    'open', selected_mode = 'preview'
      and selected_match.betting_open
      and (selected_season.predictions_enabled or test_mode)
      and selected_match.winner is null
      and selected_match.actual_sets is null
      and (selected_match.match_at is null or selected_match.match_at > now()),
    'totalVotes', total_votes,
    'team1Percentage', team_one_percentage,
    'team2Percentage', team_two_percentage,
    'userVote', selected_vote,
    'userPrediction', selected_prediction,
    'loneWinnerTipper', lone_winner_name
  );
end;
$$;

notify pgrst, 'reload schema';

commit;
