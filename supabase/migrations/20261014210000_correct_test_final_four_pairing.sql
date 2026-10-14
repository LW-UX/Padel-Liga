begin;

do $$
declare
  test_season_id text;
  snapshot_source_match_id text;
  snapshot_captured_at timestamptz;
  had_snapshot boolean := false;
  current_pairing boolean;
  corrected_pairing boolean;
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

  if not exists (
    select 1
    from public.matches as match
    where match.id = 'test-2026-live-3'
      and match.season_id = test_season_id
      and match.competition_stage = 'final_four'
      and match.cancelled_at is null
      and match.actual_sets is null
      and match.winner is null
  ) then
    raise exception 'Liveticker 3 ist nicht als offene Final-Four-Testpartie verfügbar.';
  end if;

  if exists (
    select 1
    from public.live_match_sessions as session
    where session.match_id = 'test-2026-live-3'
  ) or exists (
    select 1
    from public.result_proposals as proposal
    where proposal.match_id = 'test-2026-live-3'
  ) then
    raise exception 'Liveticker 3 besitzt bereits einen Spielverlauf oder Ergebnisvorschlag.';
  end if;

  select
    count(*) = 4
      and count(*) filter (
        where member.player_id = 'ludi_gmail' and member.team = 1 and member.position = 1
      ) = 1
      and count(*) filter (
        where member.player_id = 'ludwig_w' and member.team = 1 and member.position = 2
      ) = 1
      and count(*) filter (
        where member.player_id = 'ludi_gmx' and member.team = 2 and member.position = 1
      ) = 1
      and count(*) filter (
        where member.player_id = 'ludi_ionos' and member.team = 2 and member.position = 2
      ) = 1,
    count(*) = 4
      and count(*) filter (
        where member.player_id = 'ludi_ionos' and member.team = 1 and member.position = 1
      ) = 1
      and count(*) filter (
        where member.player_id = 'ludwig_w' and member.team = 1 and member.position = 2
      ) = 1
      and count(*) filter (
        where member.player_id = 'ludi_gmx' and member.team = 2 and member.position = 1
      ) = 1
      and count(*) filter (
        where member.player_id = 'ludi_gmail' and member.team = 2 and member.position = 2
      ) = 1
  into current_pairing, corrected_pairing
  from public.match_players as member
  where member.match_id = 'test-2026-live-3';

  if not current_pairing and not corrected_pairing then
    raise exception 'Liveticker 3 besitzt eine unerwartete Besetzung.';
  end if;

  select snapshot.source_match_id, snapshot.captured_at
  into snapshot_source_match_id, snapshot_captured_at
  from public.final_four_prematch_snapshots as snapshot
  where snapshot.season_id = test_season_id;
  had_snapshot := found;

  if current_pairing then
    update public.match_players
    set position = case player_id
      when 'ludi_gmail' then 99
      when 'ludi_ionos' then 100
    end
    where match_id = 'test-2026-live-3'
      and player_id in ('ludi_gmail', 'ludi_ionos');

    update public.match_players
    set
      team = case player_id
        when 'ludi_ionos' then 1
        when 'ludi_gmail' then 2
      end,
      position = case player_id
        when 'ludi_ionos' then 1
        when 'ludi_gmail' then 2
      end
    where match_id = 'test-2026-live-3'
      and player_id in ('ludi_gmail', 'ludi_ionos');
  end if;

  update public.matches
  set
    team_one_label = 'Ludi Ionos / Ludwig W.',
    team_two_label = 'Ludi GMX / Ludi Gmail'
  where id = 'test-2026-live-3'
    and season_id = test_season_id;

  if (
    select count(*) = 6 and count(distinct pairing.players) = 6
    from (
      select array_agg(member.player_id order by member.player_id) as players
      from public.matches as match
      join public.match_players as member on member.match_id = match.id
      where match.season_id = test_season_id
        and match.competition_stage = 'final_four'
        and match.cancelled_at is null
      group by member.match_id, member.team
    ) as pairing
  ) is not true then
    raise exception 'Die drei Final-Four-Partien bilden keine vollständige Partnerrotation.';
  end if;

  if had_snapshot then
    delete from public.final_four_prematch_snapshots
    where season_id = test_season_id;

    perform private.ensure_final_four_prematch_snapshot(
      test_season_id, snapshot_source_match_id, snapshot_captured_at
    );

    if not exists (
      select 1
      from public.final_four_prematch_snapshots as snapshot
      where snapshot.season_id = test_season_id
        and snapshot.source_match_id = snapshot_source_match_id
        and snapshot.captured_at = snapshot_captured_at
    ) then
      raise exception 'Der korrigierte Prematch-Snapshot konnte nicht erzeugt werden.';
    end if;
  end if;
end;
$$;

commit;
