begin;

-- Der Kontoabruf behält die administrativen Prüfaufgaben bei, liefert der Oberfläche
-- aber zusätzlich das vorschlagende Team für persönliche Handlungshinweise.
drop function if exists public.get_my_result_tasks(text);
create function public.get_my_result_tasks(p_season_id text default null)
returns table (
  match_id text,
  season_id text,
  season_label text,
  league_id text,
  league_label text,
  matchday integer,
  match_format text,
  competition_stage text,
  match_at timestamptz,
  team_one_label text,
  team_two_label text,
  my_team smallint,
  task_type text,
  is_open boolean,
  proposal_id bigint,
  proposed_by_team smallint,
  proposed_result text,
  proposed_sets text,
  proposed_winner smallint,
  proposed_match_at timestamptz,
  official_result text,
  official_sets text
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select profile.id, profile.player_id, profile.app_role
    from public.profiles as profile where profile.id = (select auth.uid())
  ), pending as (
    select proposal.* from public.result_proposals as proposal where proposal.status = 'pending'
  ), task_matches as (
    select match.*, season.label as season_label, league.label as league_label,
      member.team as my_team, me.app_role,
      pending.id as proposal_id, pending.proposed_by_team,
      pending.result_details as proposed_result,
      pending.actual_sets as proposed_sets,
      pending.winner as proposed_winner,
      pending.match_at as proposed_match_at,
      case
        when match.actual_sets is not null then false
        when pending.id is not null then true
        when match.match_at is null then false
        else match.match_at <= now()
      end as is_open
    from public.matches as match
    join public.seasons as season on season.id = match.season_id and season.results_entry_enabled
    join public.leagues as league on league.season_id = match.season_id and league.id = match.league_id
    cross join me
    left join public.match_players as member
      on member.match_id = match.id and member.player_id = me.player_id
    left join pending on pending.match_id = match.id
    where match.cancelled_at is null
      and (p_season_id is null or match.season_id = p_season_id)
      and (me.app_role = 'admin' or member.player_id is not null)
  )
  select task_match.id, task_match.season_id, task_match.season_label,
    task_match.league_id, task_match.league_label, task_match.matchday,
    task_match.format, task_match.competition_stage, task_match.match_at,
    task_match.team_one_label, task_match.team_two_label, task_match.my_team,
    case
      when task_match.actual_sets is not null then 'completed'
      when task_match.proposal_id is null then 'enter'
      when task_match.app_role = 'admin' or task_match.proposed_by_team <> task_match.my_team then 'review'
      else 'waiting'
    end,
    task_match.is_open, task_match.proposal_id, task_match.proposed_by_team,
    task_match.proposed_result, task_match.proposed_sets, task_match.proposed_winner,
    task_match.proposed_match_at, task_match.result_details, task_match.actual_sets
  from task_matches as task_match
  order by task_match.match_at nulls last, task_match.id;
$$;

revoke execute on function public.get_my_result_tasks(text) from public, anon;
grant execute on function public.get_my_result_tasks(text) to authenticated;

commit;
