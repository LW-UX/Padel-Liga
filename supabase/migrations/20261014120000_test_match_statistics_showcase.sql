begin;

-- Partie 6 is the persistent maximum preview. A deliberately early, completed
-- test-only rematch brings both current partnerships above the relationship
-- threshold without changing the latest streaks. The open showcase itself is
-- scheduled so its header exercises the date presentation as well.
do $$
declare
  test_season_id text;
begin
  select season.id into test_season_id
  from public.seasons season
  where season.id in ('2026-test', 'test-2026') and not season.counts_for_profile
  order by case season.id when '2026-test' then 1 else 2 end
  limit 1;

  if test_season_id is null then return; end if;

  insert into public.matches (
    id, season_id, league_id, matchday, match_type, competition_stage, format,
    match_at, display_label, counts_for_ranking, counts_for_elo,
    team_one_label, team_two_label, betting_open,
    result_details, actual_sets, winner
  ) values (
    'test-2026-statistics-history', test_season_id, 'main', 1, 'season', 'league', 'best-of-three',
    '2026-07-14 18:00:00 Europe/Berlin', 'Statistik-Vorgeschichte', true, true,
    'Ludi GMX / Ludi Ionos', 'Ludi Gmail / Ludwig W.', false,
    '6:4, 6:4', '2:0', 1
  )
  on conflict (id) do update set
    season_id=excluded.season_id, league_id=excluded.league_id, matchday=excluded.matchday,
    match_type=excluded.match_type, competition_stage=excluded.competition_stage, format=excluded.format,
    match_at=excluded.match_at, display_label=excluded.display_label,
    counts_for_ranking=excluded.counts_for_ranking, counts_for_elo=excluded.counts_for_elo,
    team_one_label=excluded.team_one_label, team_two_label=excluded.team_two_label,
    betting_open=excluded.betting_open, result_details=excluded.result_details,
    actual_sets=excluded.actual_sets, winner=excluded.winner, cancelled_at=null;

  insert into public.match_players (match_id, player_id, team, position) values
    ('test-2026-statistics-history', 'ludi_gmx', 1, 1),
    ('test-2026-statistics-history', 'ludi_ionos', 1, 2),
    ('test-2026-statistics-history', 'ludi_gmail', 2, 1),
    ('test-2026-statistics-history', 'ludwig_w', 2, 2)
  on conflict (match_id, player_id) do update set team=excluded.team, position=excluded.position;

  update public.matches
  set match_at='2026-10-20 18:00:00 Europe/Berlin'
  where id='test-2026-partie-6' and season_id=test_season_id
    and winner is null and actual_sets is null and cancelled_at is null;

  perform private.recalculate_test_match_elo(test_season_id);
end;
$$;

-- Company membership is real profile data and must not be rewritten for a UI
-- fixture. Only this hidden showcase therefore receives explicit test teams.
alter function public.get_public_match_detail(text)
  rename to get_public_match_detail_without_test_showcase;

alter function public.get_public_match_detail_without_test_showcase(text)
  set schema private;

revoke all on function private.get_public_match_detail_without_test_showcase(text)
  from public, anon, authenticated;

create function public.get_public_match_detail(p_match_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_match_id='test-2026-partie-6' and detail.value is not null then
      jsonb_set(detail.value, '{company}', jsonb_build_object(
        'kind','duel','team1','Testbetrieb Nord','team2','Testbetrieb Süd','wins1',3,'wins2',2
      ))
    else detail.value
  end
  from (
    select private.get_public_match_detail_without_test_showcase(p_match_id) value
  ) detail;
$$;

revoke all on function public.get_public_match_detail(text) from public;
grant execute on function public.get_public_match_detail(text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
