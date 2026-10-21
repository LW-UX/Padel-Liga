begin;

create or replace function private.match_forecast_mode(p_match_id text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_match record;
  selected_season record;
  active_stage text;
  team_one_count integer;
  team_two_count integer;
  today date := (now() at time zone 'Europe/Berlin')::date;
  test_mode boolean;
begin
  select match.* into selected_match
  from public.matches as match
  where match.id = p_match_id;
  if not found then return null; end if;

  select season.* into selected_season
  from public.seasons as season
  where season.id = selected_match.season_id;
  if not found then return null; end if;

  test_mode := not selected_season.counts_for_profile
    and selected_season.id in ('test-2026', '2026-test');

  if (not selected_season.counts_for_profile and not test_mode)
    or selected_match.cancelled_at is not null
    or selected_match.match_type not in ('season', 'final')
    or selected_match.competition_stage = 'final_four'
    or selected_match.format = 'single-set' then
    return null;
  end if;

  if not selected_season.predictions_enabled
    and not test_mode
    and not exists (
      select 1
      from public.predictions as prediction
      where prediction.match_id = selected_match.id
    ) then
    return null;
  end if;

  select
    count(*) filter (where member.team = 1),
    count(*) filter (where member.team = 2)
  into team_one_count, team_two_count
  from public.match_players as member
  where member.match_id = selected_match.id;

  if team_one_count <> 2 or team_two_count <> 2 then return null; end if;

  if selected_match.winner is not null and selected_match.actual_sets is not null then
    return 'analysis';
  end if;
  if not selected_match.counts_for_elo then return null; end if;

  if selected_match.competition_stage = 'semifinal'
    and selected_season.tournament_mode <> 'knockout_redraw'
    and exists (
      select 1
      from public.matches as league_match
      where league_match.season_id = selected_match.season_id
        and league_match.competition_stage = 'league'
        and league_match.cancelled_at is null
        and (league_match.winner is null or league_match.actual_sets is null)
    ) then
    return null;
  end if;

  if test_mode
    or selected_match.match_at is not null
    or (
      selected_match.competition_stage = 'semifinal'
      and selected_season.tournament_mode <> 'knockout_redraw'
    ) then
    return 'preview';
  end if;

  if selected_season.tournament_mode = 'knockout_redraw' then
    select candidate.competition_stage into active_stage
    from public.matches as candidate
    where candidate.season_id = selected_match.season_id
      and candidate.cancelled_at is null
      and candidate.winner is null
    order by case candidate.competition_stage
      when 'quarterfinal' then 1
      when 'semifinal' then 2
      when 'final' then 3
      else 0
    end
    limit 1;

    return case
      when selected_match.competition_stage = active_stage then 'preview'
      else 'basic'
    end;
  end if;

  if exists (
    select 1
    from public.season_matchdays as matchday
    where matchday.season_id = selected_match.season_id
      and matchday.matchday = selected_match.matchday
      and matchday.ends_on < today
  ) or selected_match.matchday in (
    select matchday.matchday
    from public.season_matchdays as matchday
    where matchday.season_id = selected_match.season_id
      and matchday.ends_on >= today
    order by matchday.starts_on, matchday.matchday
    limit 2
  ) then
    return 'preview';
  end if;

  return 'basic';
end;
$$;

revoke all on function private.match_forecast_mode(text) from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
