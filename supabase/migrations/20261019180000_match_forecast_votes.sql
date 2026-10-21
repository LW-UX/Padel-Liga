begin;

create table public.match_forecast_votes (
  match_id text not null references public.matches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  team smallint not null check (team in (1, 2)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

create index match_forecast_votes_result_idx
  on public.match_forecast_votes(match_id, team);

alter table public.match_forecast_votes enable row level security;
revoke all on public.match_forecast_votes from public, anon, authenticated;

create trigger match_forecast_votes_set_updated_at
before update on public.match_forecast_votes
for each row execute function private.set_updated_at();

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
    or selected_match.competition_stage = 'final_four' then
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

create or replace function private.get_match_forecast_state(
  p_match_id text,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_match record;
  selected_mode text;
  selected_vote smallint;
  team_one_votes integer;
  team_two_votes integer;
  total_votes integer;
  team_one_percentage integer;
  team_two_percentage integer;
begin
  select match.* into selected_match
  from public.matches as match
  where match.id = p_match_id;
  if not found then return null; end if;

  selected_mode := private.match_forecast_mode(p_match_id);
  if selected_mode is null then return null; end if;

  select
    count(*) filter (where vote.team = 1)::integer,
    count(*) filter (where vote.team = 2)::integer
  into team_one_votes, team_two_votes
  from public.match_forecast_votes as vote
  where vote.match_id = p_match_id;

  team_one_votes := coalesce(team_one_votes, 0);
  team_two_votes := coalesce(team_two_votes, 0);
  total_votes := team_one_votes + team_two_votes;
  team_one_percentage := case
    when total_votes = 0 then 0
    else round(team_one_votes * 100.0 / total_votes)::integer
  end;
  team_two_percentage := case
    when total_votes = 0 then 0
    else 100 - team_one_percentage
  end;

  if p_user_id is not null then
    select vote.team into selected_vote
    from public.match_forecast_votes as vote
    where vote.match_id = p_match_id
      and vote.user_id = p_user_id;
  end if;

  return jsonb_build_object(
    'matchId', selected_match.id,
    'mode', selected_mode,
    'open', selected_mode = 'preview'
      and selected_match.winner is null
      and selected_match.actual_sets is null
      and (selected_match.match_at is null or selected_match.match_at > now()),
    'totalVotes', total_votes,
    'team1Percentage', team_one_percentage,
    'team2Percentage', team_two_percentage,
    'userVote', selected_vote
  );
end;
$$;

create or replace function public.get_public_match_forecasts(p_season_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(forecast.state order by match.id)
    filter (where forecast.state is not null), '[]'::jsonb)
  from public.matches as match
  cross join lateral (
    select private.get_match_forecast_state(match.id, null) as state
  ) as forecast
  where match.season_id = p_season_id;
$$;

create or replace function public.get_public_match_forecast(p_match_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.get_match_forecast_state(p_match_id, (select auth.uid()));
$$;

create or replace function public.submit_match_forecast_vote(
  p_match_id text,
  p_team smallint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  selected_match record;
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  if not private.user_email_is_confirmed(current_user_id) then
    raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen.';
  end if;
  if p_team is null or p_team not in (1, 2) then raise exception 'Ungültiges Team.'; end if;

  select match.* into selected_match
  from public.matches as match
  where match.id = p_match_id
  for update of match;
  if not found then raise exception 'Partie nicht gefunden.'; end if;

  if private.match_forecast_mode(p_match_id) is distinct from 'preview'
    or selected_match.winner is not null
    or selected_match.actual_sets is not null then
    raise exception 'Für diese Partie ist keine Abstimmung geöffnet.';
  end if;
  if selected_match.match_at is not null and selected_match.match_at <= now() then
    raise exception 'Die Abstimmung ist bereits beendet.';
  end if;

  insert into public.match_forecast_votes(match_id, user_id, team)
  values (p_match_id, current_user_id, p_team)
  on conflict (match_id, user_id) do update
    set team = excluded.team,
        updated_at = now();

  return private.get_match_forecast_state(p_match_id, current_user_id);
end;
$$;

revoke all on function private.match_forecast_mode(text) from public, anon, authenticated;
revoke all on function private.get_match_forecast_state(text,uuid) from public, anon, authenticated;
revoke all on function public.get_public_match_forecasts(text) from public;
revoke all on function public.get_public_match_forecast(text) from public;
revoke all on function public.submit_match_forecast_vote(text,smallint) from public, anon;

grant execute on function public.get_public_match_forecasts(text) to anon, authenticated;
grant execute on function public.get_public_match_forecast(text) to anon, authenticated;
grant execute on function public.submit_match_forecast_vote(text,smallint) to authenticated;

notify pgrst, 'reload schema';

commit;
