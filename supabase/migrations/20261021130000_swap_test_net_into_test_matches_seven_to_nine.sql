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

  if not exists (
    select 1
    from public.season_players as participant
    where participant.season_id = target_season_id
      and participant.player_id = 'test_net'
  ) then
    raise exception 'Test Net ist kein Teilnehmer der Test-Saison.';
  end if;

  if (
    select count(*)
    from public.match_players as member
    join public.matches as match on match.id = member.match_id
    where member.match_id in (
        'test-2026-partie-7',
        'test-2026-partie-8',
        'test-2026-partie-9'
      )
      and match.season_id = target_season_id
      and member.player_id = 'ludwig_w'
  ) <> 3 then
    raise exception 'Ludwig W. ist nicht in allen drei Testpartien 7 bis 9 eingesetzt.';
  end if;

  if exists (
    select 1
    from public.match_players as member
    where member.match_id in (
        'test-2026-partie-7',
        'test-2026-partie-8',
        'test-2026-partie-9'
      )
      and member.player_id = 'test_net'
  ) then
    raise exception 'Test Net ist bereits in einer der Testpartien 7 bis 9 eingesetzt.';
  end if;

  update public.match_players
  set player_id = 'test_net'
  where match_id in (
      'test-2026-partie-7',
      'test-2026-partie-8',
      'test-2026-partie-9'
    )
    and player_id = 'ludwig_w';

  get diagnostics swapped_count = row_count;
  if swapped_count <> 3 then
    raise exception 'Der Spielertausch konnte nicht eindeutig ausgeführt werden.';
  end if;

  update public.matches
  set
    team_one_label = replace(team_one_label, 'Ludwig W.', 'Test Net'),
    team_two_label = replace(team_two_label, 'Ludwig W.', 'Test Net')
  where id in (
    'test-2026-partie-7',
    'test-2026-partie-8',
    'test-2026-partie-9'
  );

  -- Eigene Partien dürfen nicht getippt werden.
  delete from public.predictions as prediction
  using public.profiles as profile
  where profile.id = prediction.user_id
    and profile.player_id = 'test_net'
    and prediction.match_id in (
      'test-2026-partie-7',
      'test-2026-partie-8',
      'test-2026-partie-9'
    );

  perform private.recalculate_test_match_elo(target_season_id);
end;
$$;

commit;
