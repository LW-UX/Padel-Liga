begin;

do $$
declare
  expected_players text[] := array['ludi_gmail', 'ludi_gmx', 'ludi_ionos', 'ludwig_w']::text[];
begin
  if not exists (
    select 1
    from public.seasons as season
    where season.id = 'test-2026' and season.results_entry_enabled
  ) then
    raise exception 'Die aktive Test-Saison fehlt.';
  end if;

  if (
    select array_agg(player.id order by player.id)
    from public.players as player
    where player.id = any(expected_players)
  ) is distinct from expected_players then
    raise exception 'Mindestens eines der vier Ludi/Ludwig-Testprofile fehlt.';
  end if;

  if (
    select count(*)
    from public.profiles as profile
    where profile.player_id = any(expected_players)
  ) <> 4 then
    raise exception 'Mindestens eines der vier Ludi/Ludwig-Testkonten ist nicht verknüpft.';
  end if;

  if exists (
    select 1 from public.matches as match where match.id = 'test-2026-partie-5'
  ) then
    raise exception 'Die Testpartie test-2026-partie-5 existiert bereits.';
  end if;
end;
$$;

insert into public.season_matchdays (season_id, matchday, starts_on, ends_on, title)
values ('test-2026', 3, null, null, null)
on conflict (season_id, matchday) do nothing;

insert into public.matches (
  id,
  season_id,
  league_id,
  matchday,
  match_type,
  competition_stage,
  format,
  match_at,
  display_label,
  counts_for_ranking,
  counts_for_elo,
  team_one_label,
  team_two_label,
  betting_open
) values (
  'test-2026-partie-5',
  'test-2026',
  'main',
  3,
  'season',
  'league',
  'best-of-three',
  null,
  null,
  true,
  true,
  'Ludi GMX / Ludi Ionos',
  'Ludi Gmail / Ludwig W.',
  true
);

insert into public.match_players (match_id, player_id, team, position) values
  ('test-2026-partie-5', 'ludi_gmx', 1, 1),
  ('test-2026-partie-5', 'ludi_ionos', 1, 2),
  ('test-2026-partie-5', 'ludi_gmail', 2, 1),
  ('test-2026-partie-5', 'ludwig_w', 2, 2);

do $$
declare
  expected_players text[] := array['ludi_gmail', 'ludi_gmx', 'ludi_ionos', 'ludwig_w']::text[];
begin
  if not exists (
    select 1
    from public.matches as match
    where match.id = 'test-2026-partie-5'
      and match.season_id = 'test-2026'
      and match.matchday = 3
      and match.competition_stage = 'league'
      and match.match_at is null
      and match.result_details is null
      and match.actual_sets is null
      and match.winner is null
      and match.cancelled_at is null
      and match.counts_for_ranking
      and match.counts_for_elo
      and match.betting_open
  ) then
    raise exception 'Die offene Testpartie wurde nicht korrekt angelegt.';
  end if;

  if (
    select array_agg(member.player_id order by member.player_id)
    from public.match_players as member
    where member.match_id = 'test-2026-partie-5'
  ) is distinct from expected_players then
    raise exception 'Die offene Testpartie enthält nicht die vier vorgesehenen Konten.';
  end if;
end;
$$;

commit;
