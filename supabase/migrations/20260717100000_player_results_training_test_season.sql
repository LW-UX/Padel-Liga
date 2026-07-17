begin;

do $$ begin
  create type public.app_role as enum ('tipper', 'player', 'admin');
exception
  when duplicate_object then null;
end $$;

create extension if not exists pgcrypto with schema extensions;

alter table public.profiles
  add column if not exists app_role public.app_role not null default 'tipper';

alter table public.seasons
  add column if not exists results_entry_enabled boolean not null default false;

create table if not exists private.player_email_allowlist (
  email_hash bytea primary key,
  player_id text not null unique references public.players(id) on delete cascade,
  app_role public.app_role not null default 'player',
  created_at timestamptz not null default now()
);

create table if not exists private.signup_email_domains (
  domain text primary key check (domain = lower(trim(domain))),
  created_at timestamptz not null default now()
);

revoke all on private.player_email_allowlist, private.signup_email_domains from public, anon, authenticated;

insert into public.players (id, display_name, initials, company) values
  ('ludi_gmx', 'Ludi GMX', 'LGMX', 'Test'),
  ('ludi_gmail', 'Ludi Gmail', 'LGML', 'Test')
on conflict (id) do update set
  display_name = excluded.display_name,
  initials = excluded.initials,
  company = excluded.company;

insert into private.player_email_allowlist (email_hash, player_id, app_role) values
  (decode('f72a5fd5a482fcca12e83b39d5f84e9bb40d2d4bf1849171a3291a58146a0f6b', 'hex'), 'ludi_gmx', 'player'),
  (decode('a1e669a6784a077e8e1709d4cb02b3d02946cf99c3730ce3319d67e208e60c24', 'hex'), 'ludi_gmail', 'player'),
  (decode('0f02707d8deab83b8856bceaa58592b8719f6722a5112dca2a104bbf0be5667e', 'hex'), 'ludwig_w', 'admin')
on conflict (email_hash) do update set
  player_id = excluded.player_id,
  app_role = excluded.app_role;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_name text;
  mapped_player_id text;
  mapped_role public.app_role;
begin
  select allowlist.player_id, allowlist.app_role
  into mapped_player_id, mapped_role
  from private.player_email_allowlist as allowlist
  where allowlist.email_hash = extensions.digest(lower(trim(coalesce(new.email, ''))), 'sha256');

  if mapped_player_id is not null then
    select player.display_name
    into requested_name
    from public.players as player
    where player.id = mapped_player_id;

    insert into public.profiles (id, display_name, player_id, app_role)
    values (new.id, requested_name, mapped_player_id, mapped_role);
    return new;
  end if;

  requested_name := trim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  if char_length(requested_name) < 2 then
    requested_name := split_part(coalesce(new.email, ''), '@', 1);
  end if;
  if char_length(requested_name) < 2 then
    requested_name := 'Tipper';
  end if;

  insert into public.profiles (id, display_name, app_role)
  values (new.id, left(requested_name, 40), 'tipper');
  return new;
end;
$$;

create or replace function public.update_my_profile(p_display_name text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  clean_name text := trim(p_display_name);
begin
  if (select auth.uid()) is null then
    raise exception 'Nicht angemeldet.';
  end if;
  if char_length(clean_name) not between 2 and 40 then
    raise exception 'Der Anzeigename muss zwischen 2 und 40 Zeichen lang sein.';
  end if;
  if exists (
    select 1
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and (profile.player_id is not null or profile.app_role <> 'tipper')
  ) then
    raise exception 'Spielernamen werden zentral verwaltet.';
  end if;

  update public.profiles
  set display_name = clean_name
  where id = (select auth.uid());
end;
$$;

update public.profiles as profile
set
  player_id = allowlist.player_id,
  app_role = allowlist.app_role,
  display_name = player.display_name
from auth.users as auth_user
join private.player_email_allowlist as allowlist
  on allowlist.email_hash = extensions.digest(lower(trim(auth_user.email)), 'sha256')
join public.players as player
  on player.id = allowlist.player_id
where profile.id = auth_user.id;

create or replace function private.user_email_is_confirmed(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users as auth_user
    where auth_user.id = p_user_id
      and auth_user.email_confirmed_at is not null
  );
$$;

create table public.result_proposals (
  id bigint generated always as identity primary key,
  match_id text not null references public.matches(id) on delete cascade,
  revision integer not null check (revision > 0),
  proposed_by uuid not null references auth.users(id) on delete restrict,
  proposed_by_team smallint not null check (proposed_by_team in (1, 2)),
  result_details text not null check (char_length(trim(result_details)) between 3 and 100),
  actual_sets text not null check (actual_sets in ('2:0', '2:1', '1:2', '0:2')),
  winner smallint not null check (winner in (1, 2)),
  status text not null default 'pending' check (status in ('pending', 'superseded', 'confirmed')),
  confirmed_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (match_id, revision),
  check ((actual_sets in ('2:0', '2:1') and winner = 1) or (actual_sets in ('1:2', '0:2') and winner = 2))
);

create unique index result_proposals_one_pending_idx
  on public.result_proposals(match_id)
  where status = 'pending';
create index result_proposals_match_history_idx
  on public.result_proposals(match_id, revision desc);

create table public.match_elo_changes (
  match_id text not null references public.matches(id) on delete cascade,
  player_id text not null references public.players(id) on delete cascade,
  old_elo integer not null,
  new_elo integer not null,
  delta integer generated always as (new_elo - old_elo) stored,
  calculated_at timestamptz not null default now(),
  primary key (match_id, player_id)
);

create index match_elo_changes_player_idx
  on public.match_elo_changes(player_id, calculated_at);

create or replace function private.recalculate_season_elo(p_season_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ratings jsonb := '{}'::jsonb;
  played_match record;
  team_one_ids text[];
  team_two_ids text[];
  score_one integer[];
  score_two integer[];
  regular_difference numeric;
  tiebreak_difference numeric;
  point_factor numeric;
  player_id text;
  player_old integer;
  player_new integer;
  opponent_one integer;
  opponent_two integer;
  expected numeric;
  won_score integer;
begin
  delete from public.match_elo_changes as change
  using public.matches as match
  where change.match_id = match.id
    and match.season_id = p_season_id;

  select coalesce(jsonb_object_agg(participant.player_id, participant.start_elo), '{}'::jsonb)
  into ratings
  from public.season_players as participant
  where participant.season_id = p_season_id;

  for played_match in
    select match.*
    from public.matches as match
    where match.season_id = p_season_id
      and match.actual_sets is not null
      and match.winner is not null
      and match.match_type in ('season', 'final')
    order by match.scheduled_date nulls last, match.display_time nulls last, match.id
  loop
    select
      array_agg(member.player_id order by member.position) filter (where member.team = 1),
      array_agg(member.player_id order by member.position) filter (where member.team = 2)
    into team_one_ids, team_two_ids
    from public.match_players as member
    where member.match_id = played_match.id;

    if cardinality(team_one_ids) <> 2 or cardinality(team_two_ids) <> 2 then
      raise exception 'Für % fehlen vollständige Teams.', played_match.id;
    end if;

    select
      array_agg((score.capture)[1]::integer order by score.ordinality),
      array_agg((score.capture)[2]::integer order by score.ordinality)
    into score_one, score_two
    from regexp_matches(
      regexp_replace(played_match.result_details, '\([^)]*\)', '', 'g'),
      '([0-9]+)\s*:\s*([0-9]+)',
      'g'
    ) with ordinality as score(capture, ordinality);

    if cardinality(score_one) < 2 then
      raise exception 'Für % ist kein vollständiges Satzergebnis vorhanden.', played_match.id;
    end if;

    regular_difference := abs((score_one[1] + score_one[2]) - (score_two[1] + score_two[2]));
    tiebreak_difference := case
      when cardinality(score_one) >= 3 then (abs(score_one[3] - score_two[3])::numeric / 10) * 3
      else 0
    end;
    point_factor := power(log(10::numeric, regular_difference + tiebreak_difference + 1), 3) + 2;

    foreach player_id in array team_one_ids loop
      player_old := (ratings ->> player_id)::integer;
      opponent_one := (ratings ->> team_two_ids[1])::integer;
      opponent_two := (ratings ->> team_two_ids[2])::integer;
      expected := (
        1 / (1 + power(10::numeric, (opponent_one - player_old)::numeric / 500))
        + 1 / (1 + power(10::numeric, (opponent_two - player_old)::numeric / 500))
      ) / 2;
      won_score := case when played_match.winner = 1 then 1 else 0 end;
      player_new := round(player_old + point_factor * 50 * (won_score - expected));
      insert into public.match_elo_changes (match_id, player_id, old_elo, new_elo)
      values (played_match.id, player_id, player_old, player_new);
    end loop;

    foreach player_id in array team_two_ids loop
      player_old := (ratings ->> player_id)::integer;
      opponent_one := (ratings ->> team_one_ids[1])::integer;
      opponent_two := (ratings ->> team_one_ids[2])::integer;
      expected := (
        1 / (1 + power(10::numeric, (opponent_one - player_old)::numeric / 500))
        + 1 / (1 + power(10::numeric, (opponent_two - player_old)::numeric / 500))
      ) / 2;
      won_score := case when played_match.winner = 2 then 1 else 0 end;
      player_new := round(player_old + point_factor * 50 * (won_score - expected));
      insert into public.match_elo_changes (match_id, player_id, old_elo, new_elo)
      values (played_match.id, player_id, player_old, player_new);
    end loop;

    foreach player_id in array team_one_ids || team_two_ids loop
      select change.new_elo
      into player_new
      from public.match_elo_changes as change
      where change.match_id = played_match.id
        and change.player_id = player_id;
      ratings := jsonb_set(ratings, array[player_id], to_jsonb(player_new), true);
    end loop;
  end loop;
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
  score_count integer;
begin
  if p_actual_sets not in ('2:0', '2:1', '1:2', '0:2') then
    raise exception 'Ungültiges Satzergebnis.';
  end if;
  if (p_actual_sets in ('2:0', '2:1') and p_winner <> 1)
    or (p_actual_sets in ('1:2', '0:2') and p_winner <> 2) then
    raise exception 'Sieger und Satzergebnis passen nicht zusammen.';
  end if;
  select count(*) into score_count
  from regexp_matches(p_result_details, '[0-9]+\s*:\s*[0-9]+', 'g');
  if score_count < 2 then
    raise exception 'Bitte mindestens zwei Sätze eintragen.';
  end if;
end;
$$;

create or replace function public.submit_match_result(
  p_match_id text,
  p_result_details text,
  p_actual_sets text,
  p_winner smallint
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
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  if not private.user_email_is_confirmed(current_user_id) then raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen.'; end if;
  perform private.validate_official_result(trim(p_result_details), p_actual_sets, p_winner);

  select profile.* into current_profile
  from public.profiles as profile
  where profile.id = current_user_id;

  select match.* into selected_match
  from public.matches as match
  join public.seasons as season on season.id = match.season_id
  where match.id = p_match_id
    and season.results_entry_enabled
  for update of match;

  if not found then raise exception 'Partie nicht gefunden.'; end if;
  if selected_match.actual_sets is not null then raise exception 'Die Partie besitzt bereits ein offizielles Ergebnis.'; end if;
  if current_profile.app_role <> 'admin'
    and (selected_match.lock_at is null or selected_match.lock_at > now()) then
    raise exception 'Das Ergebnis kann erst nach dem angesetzten Spielbeginn eingetragen werden.';
  end if;

  select member.team into user_team
  from public.match_players as member
  where member.match_id = p_match_id
    and member.player_id = current_profile.player_id;

  if current_profile.app_role <> 'admin' and user_team is null then
    raise exception 'Nur beteiligte Spieler dürfen Ergebnisse eintragen.';
  end if;

  if current_profile.app_role = 'admin' then
    update public.matches
    set result_details = trim(p_result_details), actual_sets = p_actual_sets, winner = p_winner
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
    match_id, revision, proposed_by, proposed_by_team, result_details, actual_sets, winner
  ) values (
    p_match_id, next_revision, current_user_id, user_team, trim(p_result_details), p_actual_sets, p_winner
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
    result_details = selected_proposal.result_details,
    actual_sets = selected_proposal.actual_sets,
    winner = selected_proposal.winner
  where id = selected_match.id;

  perform private.recalculate_season_elo(selected_match.season_id);
end;
$$;

create or replace function public.get_my_result_tasks(p_season_id text)
returns table (
  match_id text,
  matchday integer,
  scheduled_date date,
  display_time text,
  team_one_label text,
  team_two_label text,
  my_team smallint,
  task_type text,
  proposal_id bigint,
  proposed_result text,
  proposed_sets text,
  proposed_winner smallint
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
  )
  select
    match.id,
    match.matchday,
    match.scheduled_date,
    match.display_time,
    match.team_one_label,
    match.team_two_label,
    member.team,
    case when pending.id is null then 'enter' else 'review' end,
    pending.id,
    pending.result_details,
    pending.actual_sets,
    pending.winner
  from public.matches as match
  join public.seasons as season on season.id = match.season_id and season.results_entry_enabled
  cross join me
  left join public.match_players as member
    on member.match_id = match.id and member.player_id = me.player_id
  left join pending on pending.match_id = match.id
  where match.season_id = p_season_id
    and match.actual_sets is null
    and (me.app_role = 'admin' or member.player_id is not null)
    and (me.app_role = 'admin' or (match.lock_at is not null and match.lock_at <= now()))
    and (pending.id is null or me.app_role = 'admin' or pending.proposed_by_team <> member.team)
  order by match.scheduled_date, match.display_time, match.id;
$$;

create table public.training_sessions (
  id bigint generated always as identity primary key,
  played_on date not null,
  display_time time not null,
  player_ids text[] not null check (cardinality(player_ids) = 4),
  created_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'confirmed')),
  confirmed_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create table public.training_rounds (
  session_id bigint not null references public.training_sessions(id) on delete cascade,
  round_number integer not null check (round_number > 0),
  team_one_ids text[] not null check (cardinality(team_one_ids) = 2),
  team_two_ids text[] not null check (cardinality(team_two_ids) = 2),
  result_details text not null check (char_length(trim(result_details)) between 3 and 60),
  set_count smallint not null check (set_count in (1, 2)),
  primary key (session_id, round_number)
);

create index training_sessions_date_idx on public.training_sessions(played_on desc, display_time desc);

create or replace function public.create_training_session(
  p_played_on date,
  p_display_time time,
  p_player_ids text[],
  p_rounds jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_profile record;
  session_id bigint;
  round_item jsonb;
  team_one text[];
  team_two text[];
  result_details text;
  set_count integer;
  round_number integer := 0;
  score_count integer;
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  if not private.user_email_is_confirmed(current_user_id) then raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen.'; end if;
  select profile.* into current_profile from public.profiles as profile where profile.id = current_user_id;
  if current_profile.app_role not in ('player', 'admin') then raise exception 'Nur Spieler dürfen Trainings anlegen.'; end if;
  if cardinality(p_player_ids) <> 4 or (select count(distinct id) from unnest(p_player_ids) as id) <> 4 then
    raise exception 'Ein Training benötigt genau vier verschiedene Spieler.';
  end if;
  if current_profile.app_role <> 'admin' and not (current_profile.player_id = any(p_player_ids)) then
    raise exception 'Der Ersteller muss am Training teilnehmen.';
  end if;
  if (select count(*) from public.players as player where player.id = any(p_player_ids)) <> 4 then
    raise exception 'Mindestens ein Spieler ist unbekannt.';
  end if;
  if jsonb_typeof(p_rounds) <> 'array' or jsonb_array_length(p_rounds) < 1 then
    raise exception 'Mindestens ein Spielergebnis ist erforderlich.';
  end if;

  insert into public.training_sessions (played_on, display_time, player_ids, created_by)
  values (p_played_on, p_display_time, p_player_ids, current_user_id)
  returning id into session_id;

  for round_item in select value from jsonb_array_elements(p_rounds)
  loop
    round_number := round_number + 1;
    select array_agg(value) into team_one from jsonb_array_elements_text(round_item -> 'team_one_ids');
    select array_agg(value) into team_two from jsonb_array_elements_text(round_item -> 'team_two_ids');
    result_details := trim(round_item ->> 'result_details');
    set_count := (round_item ->> 'set_count')::integer;

    if cardinality(team_one) <> 2 or cardinality(team_two) <> 2
      or (select count(distinct id) from unnest(team_one || team_two) as id) <> 4
      or exists (select 1 from unnest(team_one || team_two) as id where not (id = any(p_player_ids))) then
      raise exception 'Jede Trainingsrunde muss dieselben vier Spieler genau einmal enthalten.';
    end if;
    select count(*) into score_count from regexp_matches(result_details, '[0-9]+\s*:\s*[0-9]+', 'g');
    if set_count not in (1, 2) or score_count <> set_count then
      raise exception 'Das Trainingsergebnis muss aus einem oder zwei Sätzen bestehen.';
    end if;

    insert into public.training_rounds (
      session_id, round_number, team_one_ids, team_two_ids, result_details, set_count
    ) values (session_id, round_number, team_one, team_two, result_details, set_count);
  end loop;

  return session_id;
end;
$$;

create or replace function public.confirm_training_session(p_session_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_profile record;
  selected_session record;
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  if not private.user_email_is_confirmed(current_user_id) then raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen.'; end if;
  select profile.* into current_profile from public.profiles as profile where profile.id = current_user_id;
  select session.* into selected_session
  from public.training_sessions as session
  where session.id = p_session_id and session.status = 'pending'
  for update;
  if not found then raise exception 'Das Training ist nicht mehr offen.'; end if;
  if current_profile.app_role <> 'admin' and (
    current_profile.player_id is null
    or not (current_profile.player_id = any(selected_session.player_ids))
    or selected_session.created_by = current_user_id
  ) then
    raise exception 'Bestätigen muss ein anderer beteiligter Spieler.';
  end if;
  update public.training_sessions
  set status = 'confirmed', confirmed_by = current_user_id, confirmed_at = now()
  where id = p_session_id;
end;
$$;

create or replace function public.replace_pending_training_session(
  p_session_id bigint,
  p_played_on date,
  p_display_time time,
  p_player_ids text[],
  p_rounds jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  is_admin boolean;
  new_session_id bigint;
begin
  select profile.app_role = 'admin'
  into is_admin
  from public.profiles as profile
  where profile.id = current_user_id;

  delete from public.training_sessions as session
  where session.id = p_session_id
    and session.status = 'pending'
    and (session.created_by = current_user_id or is_admin);
  if not found then raise exception 'Das Training kann nicht bearbeitet werden.'; end if;

  select public.create_training_session(p_played_on, p_display_time, p_player_ids, p_rounds)
  into new_session_id;
  return new_session_id;
end;
$$;

create or replace function public.delete_my_pending_training(p_session_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.training_sessions as session
  where session.id = p_session_id
    and session.status = 'pending'
    and (
      session.created_by = (select auth.uid())
      or exists (
        select 1 from public.profiles as profile
        where profile.id = (select auth.uid()) and profile.app_role = 'admin'
      )
    );
  if not found then raise exception 'Das Training kann nicht gelöscht werden.'; end if;
end;
$$;

create or replace function public.get_my_training_tasks()
returns table (
  session_id bigint,
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
  select
    session.id,
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
  from public.training_sessions as session
  join public.profiles as profile on profile.id = (select auth.uid())
  where session.status = 'pending'
    and (
      session.created_by = (select auth.uid())
      or profile.app_role = 'admin'
      or (profile.player_id = any(session.player_ids) and session.created_by <> (select auth.uid()))
    )
  order by session.played_on desc, session.display_time desc;
$$;

create or replace function public.get_training_sessions()
returns table (
  session_id bigint,
  played_on date,
  display_time time,
  players jsonb,
  rounds jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    session.id,
    session.played_on,
    session.display_time,
    (
      select jsonb_agg(jsonb_build_object(
        'id', player.id,
        'display_name', player.display_name,
        'initials', player.initials
      ) order by member.ordinality)
      from unnest(session.player_ids) with ordinality as member(player_id, ordinality)
      join public.players as player on player.id = member.player_id
    ),
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
  from public.training_sessions as session
  where session.status = 'confirmed'
  order by session.played_on desc, session.display_time desc, session.id desc;
$$;

create or replace function private.hook_restrict_signup_by_email_domain(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_email text := lower(trim(event -> 'user' ->> 'email'));
  requested_domain text := split_part(requested_email, '@', 2);
begin
  if not exists (select 1 from private.signup_email_domains) then
    return '{}'::jsonb;
  end if;
  if exists (
    select 1 from private.player_email_allowlist
    where email_hash = extensions.digest(requested_email, 'sha256')
  )
    or exists (select 1 from private.signup_email_domains where domain = requested_domain) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Für diese E-Mail-Domain ist keine Registrierung möglich.'
  ));
end;
$$;

insert into public.seasons (id, label, title, starts_on, is_active, results_entry_enabled)
values ('test-2026', 'Test-Saison', 'Padel-Liga · Test-Saison', '2026-07-01', false, true)
on conflict (id) do update set results_entry_enabled = true;

insert into public.leagues (season_id, id, label, is_default)
values ('test-2026', 'main', 'Test-Liga', true)
on conflict (season_id, id) do update set label = excluded.label, is_default = excluded.is_default;

insert into public.season_players (season_id, league_id, player_id, start_elo) values
  ('test-2026', 'main', 'ludi_gmx', 800),
  ('test-2026', 'main', 'ludi_gmail', 800),
  ('test-2026', 'main', 'ludwig_w', 1100),
  ('test-2026', 'main', 'agnes_k', 750),
  ('test-2026', 'main', 'greta_p', 900),
  ('test-2026', 'main', 'raphael_h', 1100),
  ('test-2026', 'main', 'luca_w', 800),
  ('test-2026', 'main', 'lukas_p', 1150)
on conflict (season_id, league_id, player_id) do update set start_elo = excluded.start_elo;

insert into public.matches (
  id, season_id, league_id, matchday, scheduled_date, display_time, lock_at,
  team_one_label, team_two_label, betting_open
) values
  ('test-2026-partie-1', 'test-2026', 'main', 1, '2026-07-15', '18.00', '2026-07-15 18:00:00+02', 'Ludi GMX / Agnes K.', 'Ludi Gmail / Raphael H.', true),
  ('test-2026-partie-2', 'test-2026', 'main', 1, '2026-07-16', '18.00', '2026-07-16 18:00:00+02', 'Ludi GMX / Greta P.', 'Ludi Gmail / Ludwig W.', true),
  ('test-2026-partie-3', 'test-2026', 'main', 2, '2026-12-01', '18.00', '2026-12-01 18:00:00+01', 'Ludi Gmail / Luca W.', 'Ludi GMX / Lukas P.', true),
  ('test-2026-partie-4', 'test-2026', 'main', 2, '2026-12-03', '18.00', '2026-12-03 18:00:00+01', 'Ludwig W. / Ludi GMX', 'Ludi Gmail / Agnes K.', true)
on conflict (id) do update set
  scheduled_date = excluded.scheduled_date,
  display_time = excluded.display_time,
  lock_at = excluded.lock_at,
  team_one_label = excluded.team_one_label,
  team_two_label = excluded.team_two_label;

insert into public.match_players (match_id, player_id, team, position) values
  ('test-2026-partie-1', 'ludi_gmx', 1, 1),
  ('test-2026-partie-1', 'agnes_k', 1, 2),
  ('test-2026-partie-1', 'ludi_gmail', 2, 1),
  ('test-2026-partie-1', 'raphael_h', 2, 2),
  ('test-2026-partie-2', 'ludi_gmx', 1, 1),
  ('test-2026-partie-2', 'greta_p', 1, 2),
  ('test-2026-partie-2', 'ludi_gmail', 2, 1),
  ('test-2026-partie-2', 'ludwig_w', 2, 2),
  ('test-2026-partie-3', 'ludi_gmail', 1, 1),
  ('test-2026-partie-3', 'luca_w', 1, 2),
  ('test-2026-partie-3', 'ludi_gmx', 2, 1),
  ('test-2026-partie-3', 'lukas_p', 2, 2),
  ('test-2026-partie-4', 'ludwig_w', 1, 1),
  ('test-2026-partie-4', 'ludi_gmx', 1, 2),
  ('test-2026-partie-4', 'ludi_gmail', 2, 1),
  ('test-2026-partie-4', 'agnes_k', 2, 2)
on conflict (match_id, player_id) do update set team = excluded.team, position = excluded.position;

alter table public.result_proposals enable row level security;
alter table public.match_elo_changes enable row level security;
alter table public.training_sessions enable row level security;
alter table public.training_rounds enable row level security;

create policy "Elo changes are public" on public.match_elo_changes
for select to anon, authenticated using (true);
create policy "Confirmed trainings are public" on public.training_sessions
for select to anon, authenticated using (status = 'confirmed');
create policy "Confirmed training rounds are public" on public.training_rounds
for select to anon, authenticated using (
  exists (
    select 1 from public.training_sessions as session
    where session.id = session_id and session.status = 'confirmed'
  )
);

revoke all on public.result_proposals, public.match_elo_changes, public.training_sessions, public.training_rounds from anon, authenticated;
grant select on public.match_elo_changes, public.training_sessions, public.training_rounds to anon, authenticated;

revoke execute on function public.submit_match_result(text, text, text, smallint) from public, anon;
revoke execute on function public.confirm_match_result(bigint) from public, anon;
revoke execute on function public.get_my_result_tasks(text) from public, anon;
revoke execute on function public.create_training_session(date, time, text[], jsonb) from public, anon;
revoke execute on function public.confirm_training_session(bigint) from public, anon;
revoke execute on function public.replace_pending_training_session(bigint, date, time, text[], jsonb) from public, anon;
revoke execute on function public.delete_my_pending_training(bigint) from public, anon;
revoke execute on function public.get_my_training_tasks() from public, anon;
grant execute on function public.submit_match_result(text, text, text, smallint) to authenticated;
grant execute on function public.confirm_match_result(bigint) to authenticated;
grant execute on function public.get_my_result_tasks(text) to authenticated;
grant execute on function public.create_training_session(date, time, text[], jsonb) to authenticated;
grant execute on function public.confirm_training_session(bigint) to authenticated;
grant execute on function public.replace_pending_training_session(bigint, date, time, text[], jsonb) to authenticated;
grant execute on function public.delete_my_pending_training(bigint) to authenticated;
grant execute on function public.get_my_training_tasks() to authenticated;

revoke execute on function public.get_training_sessions() from public;
grant execute on function public.get_training_sessions() to anon, authenticated;

grant usage on schema private to supabase_auth_admin;
grant select on private.player_email_allowlist, private.signup_email_domains to supabase_auth_admin;
grant execute on function private.hook_restrict_signup_by_email_domain(jsonb) to supabase_auth_admin;
revoke execute on function private.hook_restrict_signup_by_email_domain(jsonb) from public, anon, authenticated;

commit;

-- Aktivierung erst, sobald Domains gepflegt sind:
-- Supabase Dashboard -> Authentication -> Hooks -> Before User Created
-- pg-functions://postgres/private/hook_restrict_signup_by_email_domain
