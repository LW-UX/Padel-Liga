begin;

-- Benchmark-Konten tippen eine Partie erst, wenn sie auch auf der Tippseite tippbar ist:
-- terminierte Partien sofort, Partien ohne Termin erst im Vorschaufenster (wie isPredictionOpen in js/tippspiel.js).
create or replace function private.sync_benchmark_predictions(p_match_id text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_count integer;
begin
  insert into public.predictions(user_id, match_id, prediction)
  select profile.id, match.id, tip.prediction
  from public.profiles as profile
  cross join public.matches as match
  join public.seasons as season
    on season.id = match.season_id
   and season.predictions_enabled
  cross join lateral (select private.get_benchmark_auto_tip(match.id) as prediction) as tip
  where profile.is_benchmark
    and profile.player_id is null
    and (p_match_id is null or match.id = p_match_id)
    and match.betting_open
    and match.cancelled_at is null
    and match.winner is null
    and match.actual_sets is null
    and (match.match_at is null or match.match_at > now())
    and (match.competition_stage = 'league' or match.match_at is not null)
    and (match.match_at is not null or private.match_forecast_mode(match.id) is distinct from 'basic')
    and tip.prediction is not null
  on conflict (user_id, match_id) do update
    set prediction = excluded.prediction,
        updated_at = now()
    where public.predictions.prediction is distinct from excluded.prediction;

  get diagnostics changed_count = row_count;
  return changed_count;
end;
$$;
revoke all on function private.sync_benchmark_predictions(text) from public, anon, authenticated;

-- Vorzeitig gesetzte Benchmark-Tipps auf Partien, die noch nicht tippbar sind, entfernen.
delete from public.predictions as prediction
using public.profiles as profile, public.matches as match
where profile.id = prediction.user_id
  and profile.is_benchmark
  and match.id = prediction.match_id
  and match.actual_sets is null
  and match.match_at is null
  and private.match_forecast_mode(match.id) = 'basic';

select private.sync_benchmark_predictions();

commit;
