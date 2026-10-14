begin;

do $$
declare
  test_season_id text;
begin
  select season.id into test_season_id
  from public.seasons as season
  where season.id in ('2026-test', 'test-2026')
    and not season.counts_for_profile
  order by case season.id when '2026-test' then 1 else 2 end
  limit 1;

  if test_season_id is null then
    raise exception 'Die nicht öffentliche Test-Saison wurde nicht gefunden.';
  end if;

  if (
    select count(*)
    from public.seasons as season
    where season.id in ('2026-test', 'test-2026')
      and not season.counts_for_profile
  ) <> 1 then
    raise exception 'Die Test-Saison ist nicht eindeutig.';
  end if;

  perform 1
  from public.seasons as season
  where season.id = test_season_id
  for update;

  if exists (
    select 1
    from public.live_match_sessions as session
    join public.matches as match on match.id = session.match_id
    where match.season_id = test_season_id
      and match.competition_stage = 'final_four'
      and session.status in ('live', 'needs_server', 'ready_to_finish')
  ) then
    raise exception 'Das Test-Final-Four besitzt eine laufende Liveticker-Sitzung.';
  end if;

  if exists (
    select 1
    from public.live_match_official_corrections as correction
    join public.live_match_sessions as session on session.id = correction.session_id
    join public.matches as match on match.id = session.match_id
    where match.season_id = test_season_id
      and match.competition_stage = 'final_four'
  ) then
    raise exception 'Das Test-Final-Four besitzt eine geschützte Ergebniskorrektur.';
  end if;

  delete from public.live_match_sessions as session
  using public.matches as match
  where match.id = session.match_id
    and match.season_id = test_season_id
    and match.competition_stage = 'final_four';

  update public.matches
  set
    match_at = timestamp '2026-10-07 18:00' at time zone 'Europe/Berlin',
    result_details = null,
    actual_sets = null,
    winner = null,
    betting_open = false
  where id = 'test-2026-live-1'
    and season_id = test_season_id
    and competition_stage = 'final_four';

  if not found then
    raise exception 'Liveticker 1 wurde in der Test-Saison nicht gefunden.';
  end if;
end;
$$;

commit;
