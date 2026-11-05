begin;

-- Der Ersatz-Tipp eigener Partien folgt derselben Siegerverteilung wie die Tippanzeige:
-- Jeder wertbare Fremdtipp zählt vollständig für das getippte Siegerteam (ohne Benchmark-Konten
-- und ohne Tipps Beteiligter).
--
-- Ab 75 % für ein Team gilt ein glatter Sieg dieses Teams (2:0 bzw. im Ein-Satz-Format 6:2),
-- über 50 % ein knapper Sieg (2:1 bzw. 6:4). Bei genau 50 % erhält jedes Team einen knappen
-- Sieg für sich selbst. Gerechnet wird mit ganzen Zahlen, damit die Grenzen exakt gelten.
--
-- Der Ersatz-Tipp wird wie ein normaler Tipp gewertet. Ohne Fremdtipp gibt es keine Gutschrift.
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
      end as predicted_team_one
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
      count(*) filter (where source.predicted_team_one) as team_one_count
    from source_predictions as source
    group by source.match_id, source.format
  ), team_tips as (
    select
      share.match_id,
      side.team,
      case
        when 4 * share.team_one_count >= 3 * share.tip_count then 'team-one-clear'
        when 2 * share.team_one_count > share.tip_count then 'team-one-narrow'
        when 2 * share.team_one_count = share.tip_count
          then case when side.team = 1 then 'team-one-narrow' else 'team-two-narrow' end
        when 4 * share.team_one_count > share.tip_count then 'team-two-narrow'
        else 'team-two-clear'
      end as outcome,
      share.format
    from match_shares as share
    cross join (values (1::smallint), (2::smallint)) as side(team)
  ), named_tips as (
    select
      tip.match_id,
      tip.team,
      case tip.outcome
        when 'team-one-clear' then case when tip.format = 'single-set' then '6:2' else '2:0' end
        when 'team-one-narrow' then case when tip.format = 'single-set' then '6:4' else '2:1' end
        when 'team-two-narrow' then case when tip.format = 'single-set' then '4:6' else '1:2' end
        else case when tip.format = 'single-set' then '2:6' else '0:2' end
      end as prediction
    from team_tips as tip
  ), scored_tips as (
    select
      tip.match_id,
      tip.team,
      tip.prediction,
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
      when scored.predicted_team_one = scored.actual_team_one then 2
      else 0
    end::bigint as awarded_points
  from scored_tips as scored;
$$;

revoke all on function private.get_prediction_own_match_tips(text) from public;
revoke all on function private.get_prediction_own_match_tips(text) from anon, authenticated;

commit;
