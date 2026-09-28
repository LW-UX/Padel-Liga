begin;

do $$
declare
  updated_matches integer;
begin
  update public.matches as match
  set match_at = case match.id
    when 'season-2026-partie-28' then timestamp '2026-10-08 18:00' at time zone 'Europe/Berlin'
    when 'season-2026-partie-29' then timestamp '2026-10-08 18:30' at time zone 'Europe/Berlin'
    when 'season-2026-partie-30' then timestamp '2026-10-08 19:00' at time zone 'Europe/Berlin'
  end
  where match.season_id = '2026'
    and match.competition_stage = 'final_four'
    and match.id in (
      'season-2026-partie-28',
      'season-2026-partie-29',
      'season-2026-partie-30'
    )
    and match.result_details is null
    and match.actual_sets is null
    and match.winner is null;

  get diagnostics updated_matches = row_count;
  if updated_matches <> 3 then
    raise exception 'Die drei offenen Final-Four-Partien von Sommer 2026 wurden nicht vollständig terminiert.';
  end if;

  if exists (
    select 1
    from public.matches as match
    where match.id in (
      'season-2026-partie-28',
      'season-2026-partie-29',
      'season-2026-partie-30'
    )
      and match.match_at is distinct from case match.id
        when 'season-2026-partie-28' then timestamp '2026-10-08 18:00' at time zone 'Europe/Berlin'
        when 'season-2026-partie-29' then timestamp '2026-10-08 18:30' at time zone 'Europe/Berlin'
        when 'season-2026-partie-30' then timestamp '2026-10-08 19:00' at time zone 'Europe/Berlin'
      end
  ) then
    raise exception 'Die Final-Four-Termine von Sommer 2026 stimmen nicht mit der Freigabe überein.';
  end if;
end
$$;

commit;
