begin;

do $$
declare
  target_season_id text;
  swapped_count integer;
begin
  select season.id
  into target_season_id
  from public.seasons as season
  where season.id in ('2026-test', 'test-2026')
    and not season.counts_for_profile
  order by case season.id when '2026-test' then 1 else 2 end
  limit 1;

  if target_season_id is null then
    raise exception 'Die Test-Saison fehlt.';
  end if;

  if not exists (select 1 from public.players where id = 'test_net') then
    raise exception 'Das Testprofil test_net fehlt.';
  end if;

  if (
    select count(*)
    from public.match_players as member
    join public.matches as match on match.id = member.match_id
    where member.match_id in (
        'test-2026-partie-3',
        'test-2026-partie-4',
        'test-2026-partie-5',
        'test-2026-partie-6'
      )
      and match.season_id = target_season_id
      and member.player_id = 'ludwig_w'
  ) <> 4 then
    raise exception 'Ludwig W. ist nicht in allen vier Testpartien 3 bis 6 eingesetzt.';
  end if;

  if exists (
    select 1
    from public.match_players as member
    where member.match_id in (
        'test-2026-partie-3',
        'test-2026-partie-4',
        'test-2026-partie-5',
        'test-2026-partie-6'
      )
      and member.player_id = 'test_net'
  ) then
    raise exception 'Test Net ist bereits in einer der Testpartien 3 bis 6 eingesetzt.';
  end if;

  insert into public.season_players (season_id, league_id, player_id, start_elo)
  select target_season_id, 'main', 'test_net', 800
  where not exists (
    select 1
    from public.season_players as participant
    where participant.season_id = target_season_id
      and participant.player_id = 'test_net'
  );

  update public.match_players
  set player_id = 'test_net'
  where match_id in (
      'test-2026-partie-3',
      'test-2026-partie-4',
      'test-2026-partie-5',
      'test-2026-partie-6'
    )
    and player_id = 'ludwig_w';

  get diagnostics swapped_count = row_count;
  if swapped_count <> 4 then
    raise exception 'Der Spielertausch konnte nicht eindeutig ausgeführt werden.';
  end if;

  update public.matches
  set
    team_one_label = replace(team_one_label, 'Ludwig W.', 'Test Net'),
    team_two_label = replace(team_two_label, 'Ludwig W.', 'Test Net')
  where id in (
    'test-2026-partie-3',
    'test-2026-partie-4',
    'test-2026-partie-5',
    'test-2026-partie-6'
  );

  perform private.recalculate_test_match_elo(target_season_id);
end;
$$;

commit;
