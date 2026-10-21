begin;

-- Liefert je gewerteter Partie die Tippwerte des schlechtesten tatsächlich abgegebenen Fremdtipps,
-- damit die Tippseite den Beteiligten die automatische Gutschrift ihrer eigenen Partie zeigen kann.
create or replace function public.get_prediction_match_floors(p_season_id text)
returns table (
  match_id text,
  prediction text,
  awarded_points bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with prediction_scores as (
    select
      prediction.match_id,
      prediction.prediction,
      case when match.format = 'single-set'
        then replace(substring(match.result_details from '([0-9]+\s*:\s*[0-9]+)'), ' ', '')
        else match.actual_sets
      end as actual_value,
      case when match.format = 'single-set'
        then split_part(prediction.prediction, ':', 1)::integer > split_part(prediction.prediction, ':', 2)::integer
        else prediction.prediction in ('2:0', '2:1')
      end as predicted_team_one,
      case when match.format = 'single-set'
        then split_part(replace(substring(match.result_details from '([0-9]+\s*:\s*[0-9]+)'), ' ', ''), ':', 1)::integer
          > split_part(replace(substring(match.result_details from '([0-9]+\s*:\s*[0-9]+)'), ' ', ''), ':', 2)::integer
        else match.actual_sets in ('2:0', '2:1')
      end as actual_team_one
    from public.predictions as prediction
    join public.matches as match on match.id = prediction.match_id
    where match.season_id = p_season_id
      and match.cancelled_at is null
      and match.actual_sets is not null
      and not exists (
        select 1
        from public.profiles as own_profile
        join public.match_players as own_member on own_member.player_id = own_profile.player_id
        where own_profile.id = prediction.user_id
          and own_member.match_id = prediction.match_id
      )
  ), scored_predictions as (
    select
      match_id,
      prediction,
      case
        when prediction = actual_value then 4
        when predicted_team_one = actual_team_one then 2
        else 0
      end::bigint as awarded_points
    from prediction_scores
  ), match_floor as (
    select match_id, min(awarded_points)::bigint as awarded_points
    from scored_predictions
    group by match_id
  )
  select distinct scored.match_id, scored.prediction, scored.awarded_points
  from scored_predictions as scored
  join match_floor as floor
    on floor.match_id = scored.match_id
   and floor.awarded_points = scored.awarded_points
  order by scored.match_id, scored.prediction;
$$;

revoke all on function public.get_prediction_match_floors(text) from public;
grant execute on function public.get_prediction_match_floors(text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
