delete from public.predictions
where match_id in (
  select id from public.matches where season_id = 'test-2026'
);

delete from public.result_proposals
where match_id in (
  select id from public.matches where season_id = 'test-2026'
);

delete from public.match_elo_changes
where match_id in (
  select id from public.matches where season_id = 'test-2026'
);

delete from public.matches
where season_id = 'test-2026'
  and id not in (
    'test-2026-partie-1',
    'test-2026-partie-2',
    'test-2026-partie-3',
    'test-2026-partie-4'
  );

update public.matches
set result_details = null,
    actual_sets = null,
    winner = null,
    betting_open = true,
    updated_at = now()
where season_id = 'test-2026';

delete from public.match_players
where match_id in (
  select id from public.matches where season_id = 'test-2026'
);

insert into public.match_players (match_id, player_id, team, position) values
  ('test-2026-partie-1', 'ludi_gmx', 1, 1),
  ('test-2026-partie-1', 'ludi_ionos', 1, 2),
  ('test-2026-partie-1', 'ludi_gmail', 2, 1),
  ('test-2026-partie-1', 'ludwig_w', 2, 2),
  ('test-2026-partie-2', 'ludi_gmx', 1, 1),
  ('test-2026-partie-2', 'ludwig_w', 1, 2),
  ('test-2026-partie-2', 'ludi_gmail', 2, 1),
  ('test-2026-partie-2', 'ludi_ionos', 2, 2),
  ('test-2026-partie-3', 'ludi_gmail', 1, 1),
  ('test-2026-partie-3', 'ludwig_w', 1, 2),
  ('test-2026-partie-3', 'ludi_gmx', 2, 1),
  ('test-2026-partie-3', 'ludi_ionos', 2, 2),
  ('test-2026-partie-4', 'ludi_gmail', 1, 1),
  ('test-2026-partie-4', 'ludi_ionos', 1, 2),
  ('test-2026-partie-4', 'ludi_gmx', 2, 1),
  ('test-2026-partie-4', 'ludwig_w', 2, 2);

update public.matches
set team_one_label = case id
      when 'test-2026-partie-1' then 'Ludi GMX / Ludi Ionos'
      when 'test-2026-partie-2' then 'Ludi GMX / Ludwig W.'
      when 'test-2026-partie-3' then 'Ludi Gmail / Ludwig W.'
      when 'test-2026-partie-4' then 'Ludi Gmail / Ludi Ionos'
    end,
    team_two_label = case id
      when 'test-2026-partie-1' then 'Ludi Gmail / Ludwig W.'
      when 'test-2026-partie-2' then 'Ludi Gmail / Ludi Ionos'
      when 'test-2026-partie-3' then 'Ludi GMX / Ludi Ionos'
      when 'test-2026-partie-4' then 'Ludi GMX / Ludwig W.'
    end,
    updated_at = now()
where season_id = 'test-2026';

delete from public.season_players
where season_id = 'test-2026'
  and player_id not in ('ludi_gmail', 'ludi_gmx', 'ludi_ionos', 'ludwig_w');

insert into public.season_players (season_id, league_id, player_id, start_elo) values
  ('test-2026', 'main', 'ludi_gmail', 800),
  ('test-2026', 'main', 'ludi_gmx', 800),
  ('test-2026', 'main', 'ludi_ionos', 800),
  ('test-2026', 'main', 'ludwig_w', 1100)
on conflict (season_id, league_id, player_id) do update set
  start_elo = excluded.start_elo,
  end_elo = null;

delete from public.season_matchdays
where season_id = 'test-2026'
  and matchday > 2;

do $$
declare
  expected_players text[] := array['ludi_gmail', 'ludi_gmx', 'ludi_ionos', 'ludwig_w']::text[];
begin
  if (select count(*) from public.matches where season_id = 'test-2026') <> 4 then
    raise exception 'The test season must contain exactly four matches.';
  end if;

  if exists (
    select 1
    from public.matches as match
    where match.season_id = 'test-2026'
      and (match.result_details is not null or match.actual_sets is not null or match.winner is not null)
  ) then
    raise exception 'The test season still contains results.';
  end if;

  if (
    select array_agg(participant.player_id order by participant.player_id)
    from public.season_players as participant
    where participant.season_id = 'test-2026'
  ) is distinct from expected_players then
    raise exception 'The test season participant roster is invalid.';
  end if;

  if exists (
    select 1
    from public.matches as match
    where match.season_id = 'test-2026'
      and (
        select array_agg(member.player_id order by member.player_id)
        from public.match_players as member
        where member.match_id = match.id
      ) is distinct from expected_players
  ) then
    raise exception 'At least one test match has an invalid roster.';
  end if;

  if exists (
    select 1
    from public.matches as match
    join public.match_players as gmx
      on gmx.match_id = match.id and gmx.player_id = 'ludi_gmx'
    join public.match_players as gmail
      on gmail.match_id = match.id and gmail.player_id = 'ludi_gmail'
    where match.season_id = 'test-2026'
      and gmx.team = gmail.team
  ) then
    raise exception 'Ludi GMX and Ludi Gmail must be opponents.';
  end if;
end;
$$;
