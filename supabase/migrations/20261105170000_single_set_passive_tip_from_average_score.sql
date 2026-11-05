begin;

-- Der Passiv-Tipp im Ein-Satz-Format folgt dem durchschnittlichen getippten Ergebnis statt der
-- Siegerverteilung: Die Spiele beider Teams werden über alle wertbaren Fremdtipps gemittelt,
-- das Team mit dem höheren Durchschnitt ist Sieger und wird auf 6 Spiele normalisiert. Der
-- Verlierer wird im selben Verhältnis umgerechnet und gerundet (,5 zum knapperen Ergebnis),
-- höchstens auf 4 Spiele; ab 5,5 Spielen lautet der Passiv-Tipp 7:6. Bei gleichem Durchschnitt
-- erhält jedes Team ein 6:4 für sich. Best of three folgt weiter der Siegerverteilung.

create or replace function private.get_prediction_own_match_tips(p_season_id text)
returns table (
  match_id text,
  team smallint,
  prediction text,
  awarded_points bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with source_predictions as (
    select
      prediction.match_id,
      match.format,
      case when match.format = 'single-set'
        then split_part(prediction.prediction, ':', 1)::integer > split_part(prediction.prediction, ':', 2)::integer
        else prediction.prediction in ('2:0', '2:1')
      end as predicted_team_one,
      case when match.format = 'single-set' then split_part(prediction.prediction, ':', 1)::integer end as team_one_games,
      case when match.format = 'single-set' then split_part(prediction.prediction, ':', 2)::integer end as team_two_games
    from public.predictions as prediction
    join public.matches as match on match.id = prediction.match_id
    where match.season_id = p_season_id
      and match.cancelled_at is null
      and match.actual_sets is not null
      and not private.is_benchmark_account(prediction.user_id)
      and not exists (
        select 1
        from public.profiles as own_profile
        join public.match_players as own_member on own_member.player_id = own_profile.player_id
        where own_profile.id = prediction.user_id
          and own_member.match_id = prediction.match_id
      )
  ), match_shares as (
    select
      source.match_id,
      source.format,
      count(*) as tip_count,
      count(*) filter (where source.predicted_team_one) as team_one_count,
      sum(source.team_one_games) as team_one_games,
      sum(source.team_two_games) as team_two_games
    from source_predictions as source
    group by source.match_id, source.format
  ), team_tips as (
    select
      share.match_id,
      side.team,
      share.format,
      share.tip_count,
      greatest(share.team_one_count, share.tip_count - share.team_one_count) as majority_count,
      greatest(share.team_one_games, share.team_two_games) as winner_games,
      least(share.team_one_games, share.team_two_games) as loser_games,
      case
        when share.format = 'single-set' then
          case
            when share.team_one_games > share.team_two_games then 1
            when share.team_one_games < share.team_two_games then 2
            else side.team
          end
        when 2 * share.team_one_count > share.tip_count then 1
        when 2 * share.team_one_count < share.tip_count then 2
        else side.team
      end as winner_team
    from match_shares as share
    cross join (values (1::smallint), (2::smallint)) as side(team)
  ), graded_tips as (
    select
      tip.match_id,
      tip.team,
      tip.winner_team,
      case
        when tip.format = 'single-set' then
          case
            -- Gleichstand der Durchschnitte: 6:4 für das eigene Team.
            when tip.winner_games = tip.loser_games then '6:4'
            -- Verlierer normalisiert ab 5,5 Spielen: 7:6.
            when 12 * tip.loser_games >= 11 * tip.winner_games then '7:6'
            -- Sonst Verlierer gerundet (,5 zum knapperen Ergebnis), höchstens 4 Spiele.
            else '6:' || least(4, ((12 * tip.loser_games + tip.winner_games) / (2 * tip.winner_games))::integer)::text
          end
        when 4 * tip.majority_count >= 3 * tip.tip_count then '2:0'
        else '2:1'
      end as winner_score
    from team_tips as tip
  ), named_tips as (
    select
      tip.match_id,
      tip.team,
      case when tip.winner_team = 1
        then tip.winner_score
        else split_part(tip.winner_score, ':', 2) || ':' || split_part(tip.winner_score, ':', 1)
      end as prediction
    from graded_tips as tip
  ), scored_tips as (
    select
      tip.match_id,
      tip.team,
      tip.prediction,
      match.format,
      case when match.format = 'single-set'
        then replace(substring(match.result_details from '([0-9]+\s*:\s*[0-9]+)'), ' ', '')
        else match.actual_sets
      end as actual_value,
      case when match.format = 'single-set'
        then split_part(tip.prediction, ':', 1)::integer > split_part(tip.prediction, ':', 2)::integer
        else tip.prediction in ('2:0', '2:1')
      end as predicted_team_one,
      case when match.format = 'single-set'
        then split_part(replace(substring(match.result_details from '([0-9]+\s*:\s*[0-9]+)'), ' ', ''), ':', 1)::integer
          > split_part(replace(substring(match.result_details from '([0-9]+\s*:\s*[0-9]+)'), ' ', ''), ':', 2)::integer
        else match.actual_sets in ('2:0', '2:1')
      end as actual_team_one
    from named_tips as tip
    join public.matches as match on match.id = tip.match_id
  )
  select
    scored.match_id,
    scored.team,
    scored.prediction,
    case
      when scored.prediction = scored.actual_value then 4
      when scored.format = 'single-set'
        and scored.predicted_team_one = scored.actual_team_one
        and split_part(scored.prediction, ':', 1)::integer - split_part(scored.prediction, ':', 2)::integer
          = split_part(scored.actual_value, ':', 1)::integer - split_part(scored.actual_value, ':', 2)::integer then 3
      when scored.predicted_team_one = scored.actual_team_one then 2
      else 0
    end::bigint as awarded_points
  from scored_tips as scored;
$$;

revoke all on function private.get_prediction_own_match_tips(text) from public;
revoke all on function private.get_prediction_own_match_tips(text) from anon, authenticated;

commit;
