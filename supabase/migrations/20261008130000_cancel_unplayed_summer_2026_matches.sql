begin;

do $$
declare
  eligible_count integer;
begin
  select count(*) into eligible_count
  from public.matches as match
  where match.id in ('season-2026-partie-10', 'season-2026-partie-19')
    and match.season_id = '2026'
    and match.competition_stage = 'league'
    and match.cancelled_at is null
    and match.result_details is null
    and match.actual_sets is null
    and match.winner is null
    and not exists (
      select 1 from public.result_proposals as proposal
      where proposal.match_id = match.id and proposal.status = 'pending'
    )
    and not exists (
      select 1 from public.live_match_sessions as session
      where session.match_id = match.id
        and session.status in ('live', 'needs_server', 'ready_to_finish')
    );

  if eligible_count <> 2 then
    raise exception 'Die beiden vorgesehenen Ligapartien sind nicht mehr beide offen und ausschließbar.';
  end if;

  update public.matches
  set
    match_at = null,
    cancelled_at = now(),
    counts_for_ranking = false,
    counts_for_elo = false,
    betting_open = false
  where id in ('season-2026-partie-10', 'season-2026-partie-19');

  perform private.advance_season_tournament('2026');
  perform private.try_complete_season('2026');
end;
$$;

commit;
