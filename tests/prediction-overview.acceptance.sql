-- Run through tools/supabase-mcp.mjs only after explicit approval.
-- All match changes are rolled back.
begin;

do $$
declare
  qa_season_id constant text := 'test-2026';
  qa_match_id text;
  qa_user_id uuid;
  qa_prediction text;
  visible_prediction text;
  mismatch_count integer;
begin
  select prediction.match_id, prediction.user_id, prediction.prediction
    into qa_match_id, qa_user_id, qa_prediction
  from public.predictions as prediction
  join public.matches as match on match.id = prediction.match_id
  where match.season_id = qa_season_id
    and match.actual_sets is null
    and match.cancelled_at is null
    and not exists (
      select 1
      from public.profiles as own_profile
      join public.match_players as own_member on own_member.player_id = own_profile.player_id
      where own_profile.id = prediction.user_id
        and own_member.match_id = prediction.match_id
    )
  limit 1;

  if qa_match_id is null then
    raise exception 'Prediction overview acceptance test requires an open test prediction';
  end if;

  -- Vor dem Tippschluss bleibt nur sichtbar, dass getippt wurde.
  update public.matches set match_at = now() + interval '1 day' where id = qa_match_id;
  select overview.prediction into visible_prediction
  from public.get_prediction_overview(qa_season_id) as overview
  where overview.user_id = qa_user_id and overview.item_type = 'match' and overview.item_id = qa_match_id
    and overview.is_tipped;
  if visible_prediction is not null then
    raise exception 'Prediction % is visible before the deadline', qa_match_id;
  end if;

  -- Nach dem Tippschluss erscheint der Tippwert.
  update public.matches set match_at = now() - interval '1 minute' where id = qa_match_id;
  select overview.prediction into visible_prediction
  from public.get_prediction_overview(qa_season_id) as overview
  where overview.user_id = qa_user_id and overview.item_type = 'match' and overview.item_id = qa_match_id;
  if visible_prediction is distinct from qa_prediction then
    raise exception 'Prediction % is not visible after the deadline', qa_match_id;
  end if;

  -- Eine Verschiebung in die Zukunft verbirgt den Tipp wieder.
  update public.matches set match_at = now() + interval '2 days' where id = qa_match_id;
  select overview.prediction into visible_prediction
  from public.get_prediction_overview(qa_season_id) as overview
  where overview.user_id = qa_user_id and overview.item_type = 'match' and overview.item_id = qa_match_id;
  if visible_prediction is not null then
    raise exception 'Prediction % stays visible after rescheduling into the future', qa_match_id;
  end if;

  -- Bonusantworten bleiben bis zum Bonus-Tippschluss verborgen.
  if exists (
    select 1
    from public.get_prediction_overview(qa_season_id) as overview
    join public.prediction_bonus_questions as question on question.id = overview.item_id
    where overview.item_type = 'bonus'
      and question.lock_at > now()
      and overview.answers is not null
  ) then
    raise exception 'Bonus answers are visible before the bonus deadline';
  end if;

  -- Die Punkte der Übersicht ergeben je Konto die Gesamtpunkte der Tipprangliste.
  select count(*) into mismatch_count
  from public.get_prediction_leaderboard(qa_season_id) as leaderboard
  left join (
    select overview.user_id, coalesce(sum(overview.points), 0) as points
    from public.get_prediction_overview(qa_season_id) as overview
    group by overview.user_id
  ) as overview_totals on overview_totals.user_id = leaderboard.user_id
  where coalesce(overview_totals.points, 0) <> leaderboard.points;
  if mismatch_count > 0 then
    raise exception '% accounts differ between overview and leaderboard', mismatch_count;
  end if;
end;
$$;

rollback;
