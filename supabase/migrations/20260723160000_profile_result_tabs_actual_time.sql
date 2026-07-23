begin;

alter table public.result_proposals
  add column if not exists played_on date,
  add column if not exists played_time time;

update public.result_proposals as proposal
set
  played_on = coalesce(match.scheduled_date, (proposal.created_at at time zone 'Europe/Berlin')::date),
  played_time = coalesce(
    case
      when match.display_time ~ '^[0-9]{1,2}[.:][0-9]{2}$'
        then replace(match.display_time, '.', ':')::time
      else null
    end,
    (proposal.created_at at time zone 'Europe/Berlin')::time
  )
from public.matches as match
where match.id = proposal.match_id
  and (proposal.played_on is null or proposal.played_time is null);

alter table public.result_proposals
  alter column played_on set not null,
  alter column played_time set not null;

drop function if exists public.submit_match_result(text, text, text, smallint);

create function public.submit_match_result(
  p_match_id text,
  p_result_details text,
  p_actual_sets text,
  p_winner smallint,
  p_played_on date,
  p_played_time time
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_profile record;
  selected_match record;
  user_team smallint;
  pending_proposal record;
  next_revision integer;
  new_proposal_id bigint;
  played_at timestamptz;
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  if not private.user_email_is_confirmed(current_user_id) then raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen.'; end if;
  if p_played_on is null or p_played_time is null then raise exception 'Bitte tatsächliches Datum und Uhrzeit angeben.'; end if;
  played_at := (p_played_on + p_played_time) at time zone 'Europe/Berlin';
  if played_at > now() + interval '5 minutes' then raise exception 'Das tatsächliche Spieldatum darf nicht in der Zukunft liegen.'; end if;
  perform private.validate_official_result(trim(p_result_details), p_actual_sets, p_winner);

  select profile.* into current_profile
  from public.profiles as profile
  where profile.id = current_user_id;
  if not found then raise exception 'Kein Profil für dieses Konto gefunden.'; end if;

  select match.* into selected_match
  from public.matches as match
  join public.seasons as season on season.id = match.season_id
  where match.id = p_match_id
    and season.results_entry_enabled
  for update of match;

  if not found then raise exception 'Partie nicht gefunden.'; end if;
  if selected_match.actual_sets is not null then raise exception 'Die Partie besitzt bereits ein offizielles Ergebnis.'; end if;

  select member.team into user_team
  from public.match_players as member
  where member.match_id = p_match_id
    and member.player_id = current_profile.player_id;

  if current_profile.app_role <> 'admin' and user_team is null then
    raise exception 'Nur beteiligte Spieler dürfen Ergebnisse eintragen.';
  end if;

  if current_profile.app_role = 'admin' then
    update public.matches
    set
      scheduled_date = p_played_on,
      display_time = replace(left(p_played_time::text, 5), ':', '.'),
      lock_at = played_at,
      result_details = trim(p_result_details),
      actual_sets = p_actual_sets,
      winner = p_winner
    where id = p_match_id;
    perform private.recalculate_season_elo(selected_match.season_id);
    return null;
  end if;

  select proposal.* into pending_proposal
  from public.result_proposals as proposal
  where proposal.match_id = p_match_id and proposal.status = 'pending'
  for update;

  if pending_proposal.id is not null and pending_proposal.proposed_by_team = user_team then
    raise exception 'Jetzt ist das gegnerische Team an der Reihe.';
  end if;

  if pending_proposal.id is not null then
    update public.result_proposals
    set status = 'superseded', resolved_at = now()
    where id = pending_proposal.id;
  end if;

  select coalesce(max(proposal.revision), 0) + 1
  into next_revision
  from public.result_proposals as proposal
  where proposal.match_id = p_match_id;

  insert into public.result_proposals (
    match_id, revision, proposed_by, proposed_by_team,
    played_on, played_time, result_details, actual_sets, winner
  ) values (
    p_match_id, next_revision, current_user_id, user_team,
    p_played_on, p_played_time, trim(p_result_details), p_actual_sets, p_winner
  ) returning id into new_proposal_id;

  return new_proposal_id;
end;
$$;

create or replace function public.confirm_match_result(p_proposal_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_profile record;
  selected_proposal record;
  selected_match record;
  user_team smallint;
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  if not private.user_email_is_confirmed(current_user_id) then raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen.'; end if;
  select profile.* into current_profile from public.profiles as profile where profile.id = current_user_id;

  select proposal.* into selected_proposal
  from public.result_proposals as proposal
  where proposal.id = p_proposal_id and proposal.status = 'pending'
  for update;
  if not found then raise exception 'Der Vorschlag ist nicht mehr offen.'; end if;

  select match.* into selected_match
  from public.matches as match
  where match.id = selected_proposal.match_id
  for update;
  if selected_match.actual_sets is not null then raise exception 'Die Partie wurde bereits bestätigt.'; end if;

  select member.team into user_team
  from public.match_players as member
  where member.match_id = selected_match.id
    and member.player_id = current_profile.player_id;

  if current_profile.app_role <> 'admin'
    and (user_team is null or user_team = selected_proposal.proposed_by_team) then
    raise exception 'Bestätigen muss ein Spieler des gegnerischen Teams.';
  end if;

  update public.result_proposals
  set status = 'confirmed', confirmed_by = current_user_id, resolved_at = now()
  where id = selected_proposal.id;

  update public.matches
  set
    scheduled_date = selected_proposal.played_on,
    display_time = replace(left(selected_proposal.played_time::text, 5), ':', '.'),
    lock_at = (selected_proposal.played_on + selected_proposal.played_time) at time zone 'Europe/Berlin',
    result_details = selected_proposal.result_details,
    actual_sets = selected_proposal.actual_sets,
    winner = selected_proposal.winner
  where id = selected_match.id;

  perform private.recalculate_season_elo(selected_match.season_id);
end;
$$;

drop function if exists public.get_my_result_tasks(text);

create function public.get_my_result_tasks(p_season_id text)
returns table (
  match_id text,
  matchday integer,
  scheduled_date date,
  display_time text,
  team_one_label text,
  team_two_label text,
  my_team smallint,
  task_type text,
  is_open boolean,
  proposal_id bigint,
  proposed_result text,
  proposed_sets text,
  proposed_winner smallint,
  proposed_played_on date,
  proposed_played_time time,
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
    from public.profiles as profile
    where profile.id = (select auth.uid())
  ), pending as (
    select proposal.*
    from public.result_proposals as proposal
    where proposal.status = 'pending'
  ), task_matches as (
    select
      match.*,
      member.team as my_team,
      me.app_role,
      pending.id as proposal_id,
      pending.proposed_by_team,
      pending.result_details as proposed_result,
      pending.actual_sets as proposed_sets,
      pending.winner as proposed_winner,
      pending.played_on as proposed_played_on,
      pending.played_time as proposed_played_time,
      case
        when match.actual_sets is not null then false
        when pending.id is not null then true
        when match.lock_at is not null then match.lock_at <= now()
        when match.scheduled_date is null then false
        when match.scheduled_date < (timezone('Europe/Berlin', now()))::date then true
        when match.scheduled_date > (timezone('Europe/Berlin', now()))::date then false
        when match.display_time ~ '^[0-9]{1,2}[.:][0-9]{2}$'
          then replace(match.display_time, '.', ':')::time <= (timezone('Europe/Berlin', now()))::time
        else true
      end as is_open
    from public.matches as match
    join public.seasons as season
      on season.id = match.season_id and season.results_entry_enabled
    cross join me
    left join public.match_players as member
      on member.match_id = match.id and member.player_id = me.player_id
    left join pending on pending.match_id = match.id
    where match.season_id = p_season_id
      and (me.app_role = 'admin' or member.player_id is not null)
  )
  select
    task_match.id,
    task_match.matchday,
    task_match.scheduled_date,
    task_match.display_time,
    task_match.team_one_label,
    task_match.team_two_label,
    task_match.my_team,
    case
      when task_match.actual_sets is not null then 'completed'
      when task_match.proposal_id is null then 'enter'
      when task_match.app_role = 'admin' or task_match.proposed_by_team <> task_match.my_team then 'review'
      else 'waiting'
    end,
    task_match.is_open,
    task_match.proposal_id,
    task_match.proposed_result,
    task_match.proposed_sets,
    task_match.proposed_winner,
    task_match.proposed_played_on,
    task_match.proposed_played_time,
    task_match.result_details,
    task_match.actual_sets
  from task_matches as task_match
  order by task_match.scheduled_date nulls last, task_match.display_time nulls last, task_match.id;
$$;

revoke execute on function public.submit_match_result(text, text, text, smallint, date, time) from public, anon;
revoke execute on function public.confirm_match_result(bigint) from public, anon;
revoke execute on function public.get_my_result_tasks(text) from public, anon;
grant execute on function public.submit_match_result(text, text, text, smallint, date, time) to authenticated;
grant execute on function public.confirm_match_result(bigint) to authenticated;
grant execute on function public.get_my_result_tasks(text) to authenticated;

notify pgrst, 'reload schema';

commit;
