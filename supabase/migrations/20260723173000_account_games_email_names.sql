begin;

create or replace function private.display_name_from_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  with email_parts as (
    select
      split_part(lower(trim(coalesce(p_email, ''))), '@', 1) as local_part
  ), name_parts as (
    select
      local_part,
      regexp_split_to_array(local_part, '\.') as parts
    from email_parts
  )
  select left(
    case
      when cardinality(parts) >= 2
        then initcap(parts[1]) || ' ' || upper(left(parts[cardinality(parts)], 1))
      when char_length(local_part) > 0
        then initcap(local_part)
      else 'Konto'
    end,
    40
  )
  from name_parts;
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  mapped_player_id text;
  mapped_role public.app_role;
begin
  select allowlist.player_id, allowlist.app_role
  into mapped_player_id, mapped_role
  from private.player_email_allowlist as allowlist
  where allowlist.email_hash = extensions.digest(lower(trim(coalesce(new.email, ''))), 'sha256');

  insert into public.profiles (id, display_name, player_id, app_role)
  values (
    new.id,
    private.display_name_from_email(new.email),
    mapped_player_id,
    coalesce(mapped_role, 'tipper'::public.app_role)
  );
  return new;
end;
$$;

update public.profiles as profile
set display_name = private.display_name_from_email(auth_user.email)
from auth.users as auth_user
where auth_user.id = profile.id;

drop policy if exists "Users update their display name" on public.profiles;

create or replace function public.update_my_profile(p_display_name text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Der Kontoname wird automatisch aus der E-Mail-Adresse erstellt.';
end;
$$;

revoke execute on function public.update_my_profile(text) from public, anon, authenticated;

create or replace function private.derive_official_result(p_result_details text)
returns table (actual_sets text, winner smallint)
language plpgsql
immutable
set search_path = ''
as $$
declare
  score text[];
  score_count integer := 0;
  team_one_sets integer := 0;
  team_two_sets integer := 0;
begin
  for score in
    select regexp_matches(coalesce(p_result_details, ''), '([0-9]+)\s*:\s*([0-9]+)', 'g')
  loop
    score_count := score_count + 1;
    if score[1]::integer = score[2]::integer then
      raise exception 'Ein Satz benötigt einen eindeutigen Sieger.';
    elsif score[1]::integer > score[2]::integer then
      team_one_sets := team_one_sets + 1;
    else
      team_two_sets := team_two_sets + 1;
    end if;
  end loop;

  if score_count not between 2 and 3 then
    raise exception 'Bitte zwei Sätze und bei 1:1 eine Entscheidung eingeben.';
  end if;
  if greatest(team_one_sets, team_two_sets) <> 2 then
    raise exception 'Das Ergebnis benötigt zwei gewonnene Sätze für ein Team.';
  end if;
  if score_count = 3 and least(team_one_sets, team_two_sets) <> 1 then
    raise exception 'Nach einem 2:0 ist keine Entscheidung mehr nötig.';
  end if;

  actual_sets := team_one_sets::text || ':' || team_two_sets::text;
  winner := case when team_one_sets = 2 then 1 else 2 end;
  return next;
end;
$$;

create or replace function private.validate_official_result(
  p_result_details text,
  p_actual_sets text,
  p_winner smallint
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  derived_sets text;
  derived_winner smallint;
begin
  select result.actual_sets, result.winner
  into derived_sets, derived_winner
  from private.derive_official_result(p_result_details) as result;

  if p_actual_sets is distinct from derived_sets or p_winner is distinct from derived_winner then
    raise exception 'Satzergebnis und Sieger passen nicht zu den eingegebenen Ergebnissen.';
  end if;
end;
$$;

drop function if exists public.get_my_result_tasks(text);

create function public.get_my_result_tasks(p_season_id text default null)
returns table (
  match_id text,
  season_id text,
  season_label text,
  league_id text,
  league_label text,
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
      season.label as season_label,
      league.label as league_label,
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
    join public.leagues as league
      on league.season_id = match.season_id and league.id = match.league_id
    cross join me
    left join public.match_players as member
      on member.match_id = match.id and member.player_id = me.player_id
    left join pending on pending.match_id = match.id
    where (p_season_id is null or match.season_id = p_season_id)
      and (me.app_role = 'admin' or member.player_id is not null)
  )
  select
    task_match.id,
    task_match.season_id,
    task_match.season_label,
    task_match.league_id,
    task_match.league_label,
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

revoke execute on function public.get_my_result_tasks(text) from public, anon;
grant execute on function public.get_my_result_tasks(text) to authenticated;

drop function if exists public.get_my_training_tasks();

create function public.get_my_training_tasks()
returns table (
  session_id bigint,
  training_number bigint,
  created_at timestamptz,
  played_on date,
  display_time time,
  player_ids text[],
  created_by_me boolean,
  rounds jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with numbered_sessions as (
    select
      session.*,
      row_number() over (order by session.created_at, session.id) as training_number
    from public.training_sessions as session
  )
  select
    session.id,
    session.training_number,
    session.created_at,
    session.played_on,
    session.display_time,
    session.player_ids,
    session.created_by = (select auth.uid()),
    (
      select jsonb_agg(jsonb_build_object(
        'round_number', round.round_number,
        'team_one_ids', round.team_one_ids,
        'team_two_ids', round.team_two_ids,
        'result_details', round.result_details,
        'set_count', round.set_count
      ) order by round.round_number)
      from public.training_rounds as round
      where round.session_id = session.id
    )
  from numbered_sessions as session
  join public.profiles as profile on profile.id = (select auth.uid())
  where session.status = 'pending'
    and (
      session.created_by = (select auth.uid())
      or profile.app_role = 'admin'
      or (profile.player_id = any(session.player_ids) and session.created_by <> (select auth.uid()))
    )
  order by session.created_at desc, session.id desc;
$$;

revoke execute on function public.get_my_training_tasks() from public, anon;
grant execute on function public.get_my_training_tasks() to authenticated;

notify pgrst, 'reload schema';

commit;
