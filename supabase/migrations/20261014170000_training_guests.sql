begin;

alter table public.training_sessions
  add column if not exists guest_names jsonb not null default '{}'::jsonb;

alter table public.training_sessions
  drop constraint if exists training_sessions_guest_names_object_check;
alter table public.training_sessions
  add constraint training_sessions_guest_names_object_check
  check (jsonb_typeof(guest_names) = 'object');

create or replace function private.training_participant_display_name(
  p_participant_id text,
  p_guest_names jsonb
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with guest_entries as (
    select
      entry.key,
      trim(entry.value) as display_name,
      count(*) over (partition by lower(trim(entry.value))) as duplicate_count,
      row_number() over (
        partition by lower(trim(entry.value))
        order by nullif(substring(entry.key from '^guest:([1-4])$'), '')::integer nulls last, entry.key
      ) as duplicate_number
    from jsonb_each_text(coalesce(p_guest_names, '{}'::jsonb)) as entry
  )
  select coalesce(
    (select player.display_name from public.players as player where player.id = p_participant_id),
    (
      select guest.display_name || ' · Gast'
        || case when guest.duplicate_count > 1 then ' ' || guest.duplicate_number else '' end
      from guest_entries as guest
      where guest.key = p_participant_id
    )
  );
$$;

create function public.create_training_session(
  p_played_on date,
  p_display_time time,
  p_player_ids text[],
  p_rounds jsonb,
  p_guest_names jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_profile record;
  new_session_id bigint;
  normalized_guest_names jsonb := '{}'::jsonb;
  guest_entry record;
  round_item jsonb;
  team_one text[];
  team_two text[];
  result_format text;
  result_details text;
  regular_result text;
  set_count integer;
  expected_regular_count integer;
  expected_section_count integer;
  round_is_complete boolean;
  round_number integer := 0;
  sets_json jsonb;
  set_item jsonb;
  match_tiebreak jsonb;
  set_index integer;
  score_count integer;
  completed_set_count integer;
  team_one_score integer;
  team_two_score integer;
  tiebreak_one integer;
  tiebreak_two integer;
  score_state text;
  tiebreak_state text;
  found_empty boolean;
  has_progress boolean;
  set_results text[];
  set_winners integer[];
  first_two_split boolean;
  score_record record;
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  if not private.user_email_is_confirmed(current_user_id) then raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen.'; end if;
  select profile.* into current_profile from public.profiles as profile where profile.id = current_user_id;
  if current_profile.app_role not in ('player', 'admin') then raise exception 'Nur Spieler dürfen Trainings anlegen.'; end if;
  if cardinality(p_player_ids) <> 4 or (select count(distinct id) from unnest(p_player_ids) as id) <> 4 then
    raise exception 'Ein Training benötigt genau vier verschiedene Spieler oder Gäste.';
  end if;
  if current_profile.app_role <> 'admin' and not (current_profile.player_id = any(p_player_ids)) then
    raise exception 'Der Ersteller muss am Training teilnehmen.';
  end if;
  if p_guest_names is null or jsonb_typeof(p_guest_names) <> 'object' then
    raise exception 'Die Gastnamen sind ungültig.';
  end if;
  for guest_entry in select entry.key, trim(entry.value) as value from jsonb_each_text(p_guest_names) as entry
  loop
    if guest_entry.key !~ '^guest:[1-4]$' or not (guest_entry.key = any(p_player_ids)) then
      raise exception 'Mindestens ein Gastplatz ist ungültig.';
    end if;
    if char_length(guest_entry.value) not between 2 and 40 or guest_entry.value ~ '[[:cntrl:]]' then
      raise exception 'Gastnamen müssen 2 bis 40 Zeichen lang sein.';
    end if;
    normalized_guest_names := normalized_guest_names || jsonb_build_object(guest_entry.key, guest_entry.value);
  end loop;
  if exists (
    select 1
    from unnest(p_player_ids) as participant(id)
    where not exists (select 1 from public.players as player where player.id = participant.id)
      and not (normalized_guest_names ? participant.id)
  ) or exists (
    select 1
    from jsonb_object_keys(normalized_guest_names) as guest(id)
    where exists (select 1 from public.players as player where player.id = guest.id)
  ) then
    raise exception 'Mindestens ein Spieler oder Gast ist unbekannt.';
  end if;
  if (select count(*) from public.players as player where player.id = any(p_player_ids))
      + jsonb_object_length(normalized_guest_names) <> 4 then
    raise exception 'Jeder Gast benötigt einen Namen.';
  end if;
  if jsonb_typeof(p_rounds) <> 'array' or jsonb_array_length(p_rounds) < 1 then
    raise exception 'Mindestens ein Spielergebnis ist erforderlich.';
  end if;

  insert into public.training_sessions (played_on, display_time, player_ids, guest_names, created_by)
  values (p_played_on, p_display_time, p_player_ids, normalized_guest_names, current_user_id)
  returning id into new_session_id;

  for round_item in select value from jsonb_array_elements(p_rounds)
  loop
    round_number := round_number + 1;
    select array_agg(value) into team_one from jsonb_array_elements_text(round_item -> 'team_one_ids');
    select array_agg(value) into team_two from jsonb_array_elements_text(round_item -> 'team_two_ids');
    if cardinality(team_one) <> 2 or cardinality(team_two) <> 2
      or (select count(distinct id) from unnest(team_one || team_two) as id) <> 4
      or exists (select 1 from unnest(team_one || team_two) as id where not (id = any(p_player_ids))) then
      raise exception 'Jede Trainingsrunde muss dieselben vier Teilnehmer genau einmal enthalten.';
    end if;

    result_format := nullif(trim(round_item ->> 'result_format'), '');
    if result_format is null then
      result_details := trim(round_item ->> 'result_details');
      set_count := nullif(round_item ->> 'set_count', '')::integer;
      result_format := case
        when set_count = 1 then 'one_set'
        when set_count = 2 then 'two_sets'
        when set_count = 3 and result_details ~ '[–-]' then 'two_sets_match_tiebreak'
        when set_count = 3 then 'three_sets'
        else null
      end;
    end if;
    if result_format is null or result_format not in ('one_set', 'two_sets', 'two_sets_match_tiebreak', 'three_sets') then
      raise exception 'Unbekanntes Ergebnisformat.';
    end if;

    expected_regular_count := case result_format
      when 'one_set' then 1
      when 'two_sets' then 2
      when 'two_sets_match_tiebreak' then 2
      else 3
    end;
    expected_section_count := case when result_format = 'two_sets_match_tiebreak' then 3 else expected_regular_count end;
    set_count := expected_section_count;
    sets_json := round_item -> 'sets';
    round_is_complete := true;
    completed_set_count := 0;
    found_empty := false;
    has_progress := false;
    set_results := '{}';
    set_winners := '{}';

    if jsonb_typeof(sets_json) = 'array' then
      if jsonb_array_length(sets_json) <> expected_regular_count then
        raise exception 'Die Anzahl der Sätze passt nicht zum Ergebnisformat.';
      end if;
      for set_index in 0..expected_regular_count - 1
      loop
        set_item := sets_json -> set_index;
        team_one_score := nullif(set_item ->> 'team_one', '')::integer;
        team_two_score := nullif(set_item ->> 'team_two', '')::integer;
        tiebreak_one := nullif(set_item ->> 'tiebreak_team_one', '')::integer;
        tiebreak_two := nullif(set_item ->> 'tiebreak_team_two', '')::integer;
        score_state := private.training_regular_set_state(team_one_score, team_two_score);

        if score_state = 'empty' then
          found_empty := true;
          round_is_complete := false;
          continue;
        end if;
        if found_empty then raise exception 'Zwischen ausgefüllten Sätzen darf kein Satz leer bleiben.'; end if;
        if score_state = 'invalid' then raise exception 'Mindestens ein Satzstand ist nicht erreichbar.'; end if;
        has_progress := has_progress or team_one_score > 0 or team_two_score > 0;
        if score_state = 'complete' then
          completed_set_count := completed_set_count + 1;
          set_winners := array_append(set_winners, case when team_one_score > team_two_score then 1 else 2 end);
        else
          round_is_complete := false;
        end if;

        if score_state = 'complete' and greatest(team_one_score, team_two_score) = 7 and least(team_one_score, team_two_score) = 6 then
          tiebreak_state := private.training_tiebreak_state(tiebreak_one, tiebreak_two, 7);
          if tiebreak_state <> 'complete' then raise exception 'Ein 7:6 benötigt einen vollständigen Satz-Tiebreak.'; end if;
          if (team_one_score > team_two_score) <> (tiebreak_one > tiebreak_two) then
            raise exception 'Satz- und Tiebreak-Sieger stimmen nicht überein.';
          end if;
          set_results := array_append(set_results, team_one_score || ':' || team_two_score || ' (' || tiebreak_one || ':' || tiebreak_two || ')');
        else
          if tiebreak_one is not null or tiebreak_two is not null then
            raise exception 'Ein Satz-Tiebreak ist nur bei 7:6 zulässig.';
          end if;
          set_results := array_append(set_results, team_one_score || ':' || team_two_score);
        end if;
      end loop;

      if not has_progress then raise exception 'Bitte mindestens einen Spielstand eingeben.'; end if;
      result_details := array_to_string(set_results, ', ');
      match_tiebreak := coalesce(round_item -> 'match_tiebreak', '{}'::jsonb);
      tiebreak_one := nullif(match_tiebreak ->> 'team_one', '')::integer;
      tiebreak_two := nullif(match_tiebreak ->> 'team_two', '')::integer;
      tiebreak_state := private.training_tiebreak_state(tiebreak_one, tiebreak_two, 10);

      if result_format = 'two_sets_match_tiebreak' then
        first_two_split := completed_set_count = 2 and set_winners[1] <> set_winners[2];
        if completed_set_count = 2 and not first_two_split then
          raise exception 'Beim Match-Tiebreak-Format müssen die ersten beiden Sätze 1:1 enden.';
        end if;
        if not first_two_split and tiebreak_state <> 'empty' then
          raise exception 'Der Match-Tiebreak ist erst nach einem Satzstand von 1:1 zulässig.';
        end if;
        if first_two_split then
          if tiebreak_state = 'invalid' then raise exception 'Der Match-Tiebreak enthält einen nicht erreichbaren Stand.'; end if;
          if tiebreak_state = 'empty' then
            round_is_complete := false;
          else
            result_details := result_details || ' – ' || tiebreak_one || ':' || tiebreak_two;
            if tiebreak_state <> 'complete' then round_is_complete := false; end if;
          end if;
        else
          round_is_complete := false;
        end if;
      elsif tiebreak_state <> 'empty' then
        raise exception 'Ein Match-Tiebreak passt nicht zum gewählten Ergebnisformat.';
      end if;
    else
      result_details := trim(round_item ->> 'result_details');
      if result_details is null or result_details = '' or result_details !~ '^\s*[0-9]+\s*:\s*[0-9]+(?:\s*\(\s*[0-9]+\s*:\s*[0-9]+\s*\))?(?:\s*,\s*[0-9]+\s*:\s*[0-9]+(?:\s*\(\s*[0-9]+\s*:\s*[0-9]+\s*\))?)*(?:\s*[–-]\s*[0-9]+\s*:\s*[0-9]+)?\s*$' then
        raise exception 'Das Trainingsergebnis ist ungültig.';
      end if;
      regular_result := (regexp_split_to_array(result_details, '\s*[–-]\s*'))[1];
      score_count := 0;
      for score_record in
        select (capture)[1]::integer as team_one, (capture)[2]::integer as team_two
        from regexp_matches(regexp_replace(regular_result, '\([^)]*\)', '', 'g'), '([0-9]+)\s*:\s*([0-9]+)', 'g') as score(capture)
      loop
        score_count := score_count + 1;
        score_state := private.training_regular_set_state(score_record.team_one, score_record.team_two);
        if score_state = 'invalid' then raise exception 'Mindestens ein Satzstand ist nicht erreichbar.'; end if;
        if score_state = 'complete' then
          completed_set_count := completed_set_count + 1;
          set_winners := array_append(set_winners, case when score_record.team_one > score_record.team_two then 1 else 2 end);
        else
          round_is_complete := false;
        end if;
      end loop;
      if score_count < 1 or score_count > expected_regular_count then
        raise exception 'Die Anzahl der Sätze passt nicht zum Ergebnisformat.';
      end if;
      if score_count < expected_regular_count then round_is_complete := false; end if;
      if result_format = 'two_sets_match_tiebreak' then
        first_two_split := completed_set_count = 2 and set_winners[1] <> set_winners[2];
        tiebreak_one := null;
        tiebreak_two := null;
        select (capture)[1]::integer, (capture)[2]::integer
          into tiebreak_one, tiebreak_two
        from regexp_matches(result_details, '[–-]\s*([0-9]+)\s*:\s*([0-9]+)\s*$') as score(capture);
        tiebreak_state := private.training_tiebreak_state(tiebreak_one, tiebreak_two, 10);
        round_is_complete := round_is_complete and first_two_split and tiebreak_state = 'complete';
      elsif result_details ~ '[–-]' then
        raise exception 'Ein Match-Tiebreak passt nicht zum gewählten Ergebnisformat.';
      end if;
    end if;

    insert into public.training_rounds (
      session_id, round_number, team_one_ids, team_two_ids, result_details, set_count, is_complete, result_format
    ) values (
      new_session_id, round_number, team_one, team_two, result_details, set_count, round_is_complete, result_format
    );
  end loop;

  return new_session_id;
end;
$$;

create function public.replace_pending_training_session(
  p_session_id bigint,
  p_played_on date,
  p_display_time time,
  p_player_ids text[],
  p_rounds jsonb,
  p_guest_names jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_profile record;
  selected_session record;
  candidate_session record;
  new_session_id bigint;
  proposals_are_equal boolean;
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  if not private.user_email_is_confirmed(current_user_id) then
    raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen.';
  end if;
  select profile.* into current_profile
  from public.profiles as profile where profile.id = current_user_id;
  select session.* into selected_session
  from public.training_sessions as session
  where session.id = p_session_id and session.status = 'pending'
  for update;
  if not found then raise exception 'Das Training ist nicht mehr offen.'; end if;
  if current_profile.player_id is null
    or not (current_profile.player_id = any(selected_session.player_ids))
    or selected_session.created_by = current_user_id then
    raise exception 'Nur ein anderer beteiligter Spieler darf eine Alternative eingeben.';
  end if;

  select public.create_training_session(
    p_played_on,
    p_display_time,
    p_player_ids,
    p_rounds,
    p_guest_names
  ) into new_session_id;

  select session.* into candidate_session
  from public.training_sessions as session
  where session.id = new_session_id;

  proposals_are_equal := selected_session.played_on is not distinct from candidate_session.played_on
    and selected_session.display_time is not distinct from candidate_session.display_time
    and selected_session.player_ids @> candidate_session.player_ids
    and candidate_session.player_ids @> selected_session.player_ids
    and selected_session.guest_names = candidate_session.guest_names
    and not exists (
      select 1
      from (
        select round.round_number, round.team_one_ids, round.team_two_ids,
          round.result_details, round.set_count, round.is_complete, round.result_format
        from public.training_rounds as round
        where round.session_id = selected_session.id
      ) as existing_round
      full join (
        select round.round_number, round.team_one_ids, round.team_two_ids,
          round.result_details, round.set_count, round.is_complete, round.result_format
        from public.training_rounds as round
        where round.session_id = candidate_session.id
      ) as candidate_round using (round_number)
      where existing_round.round_number is null
        or candidate_round.round_number is null
        or not (
          existing_round.team_one_ids @> candidate_round.team_one_ids
          and candidate_round.team_one_ids @> existing_round.team_one_ids
          and existing_round.team_two_ids @> candidate_round.team_two_ids
          and candidate_round.team_two_ids @> existing_round.team_two_ids
        )
        or existing_round.result_details is distinct from candidate_round.result_details
        or existing_round.set_count is distinct from candidate_round.set_count
        or existing_round.is_complete is distinct from candidate_round.is_complete
        or existing_round.result_format is distinct from candidate_round.result_format
    );

  if proposals_are_equal then
    raise exception 'Das entspricht dem bestehenden Vorschlag. Bitte bestätige das Ergebnis stattdessen.';
  end if;

  delete from public.training_sessions where id = selected_session.id;
  return new_session_id;
end;
$$;

drop function public.get_my_training_tasks();
create function public.get_my_training_tasks()
returns table (
  session_id bigint,
  training_number bigint,
  created_at timestamptz,
  played_on date,
  display_time time,
  player_ids text[],
  guest_names jsonb,
  created_by_me boolean,
  rounds jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with numbered_sessions as (
    select session.*, row_number() over (order by session.created_at, session.id) as training_number
    from public.training_sessions as session
  )
  select
    session.id,
    session.training_number,
    session.created_at,
    session.played_on,
    session.display_time,
    session.player_ids,
    session.guest_names,
    session.created_by = (select auth.uid()),
    (
      select jsonb_agg(jsonb_build_object(
        'round_number', round.round_number,
        'team_one_ids', round.team_one_ids,
        'team_two_ids', round.team_two_ids,
        'result_details', round.result_details,
        'set_count', round.set_count,
        'result_format', round.result_format,
        'is_complete', round.is_complete
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
        'id', case when session.guest_names ? member.player_id then null else member.player_id end,
        'participant_key', member.player_id,
        'display_name', private.training_participant_display_name(member.player_id, session.guest_names),
        'initials', coalesce(player.initials, 'G'),
        'is_guest', session.guest_names ? member.player_id
      ) order by member.ordinality)
      from unnest(session.player_ids) with ordinality as member(player_id, ordinality)
      left join public.players as player on player.id = member.player_id
    ),
    (
      select jsonb_agg(jsonb_build_object(
        'round_number', round.round_number,
        'team_one_ids', round.team_one_ids,
        'team_two_ids', round.team_two_ids,
        'result_details', round.result_details,
        'set_count', round.set_count,
        'result_format', round.result_format,
        'is_complete', round.is_complete
      ) order by round.round_number)
      from public.training_rounds as round
      where round.session_id = session.id
    )
  from public.training_sessions as session
  where session.status = 'confirmed'
  order by session.played_on desc, session.display_time desc, session.id desc;
$$;

create or replace view private.player_profile_match_rows as
select
  member.player_id,
  match.id as row_id,
  case when match.competition_stage = 'final_four' then 'final-four' else 'league' end::text as kind,
  (match.match_at at time zone 'Europe/Berlin')::date as played_on,
  to_char(match.match_at at time zone 'Europe/Berlin', 'HH24.MI') as display_time,
  match.season_id,
  season.label as season_label,
  member.team,
  match.result_details,
  case
    when match.cancelled_at is not null then 'unfinished'
    when match.winner = member.team then 'win'
    else 'loss'
  end::text as outcome,
  coalesce((
    select array_agg(player.display_name order by teammate.position)
    from public.match_players as teammate
    join public.players as player on player.id = teammate.player_id
    where teammate.match_id = match.id and teammate.team = member.team
      and teammate.player_id <> member.player_id
  ), '{}')::text[] as partner_names,
  coalesce((
    select array_agg(player.display_name order by opponent.position)
    from public.match_players as opponent
    join public.players as player on player.id = opponent.player_id
    where opponent.match_id = match.id and opponent.team <> member.team
  ), '{}')::text[] as opponent_names,
  case
    when match.cancelled_at is not null then 0
    when member.team = 1 then (private.profile_regular_game_totals(match.result_details))[1]
    else (private.profile_regular_game_totals(match.result_details))[2]
  end as games_for,
  case
    when match.cancelled_at is not null then 0
    when member.team = 1 then (private.profile_regular_game_totals(match.result_details))[2]
    else (private.profile_regular_game_totals(match.result_details))[1]
  end as games_against,
  case
    when not match.counts_for_ranking then 0
    when member.team = 1 and match.actual_sets = '2:0' then 3
    when member.team = 1 and match.actual_sets = '2:1' then 2
    when member.team = 1 and match.actual_sets = '1:2' then 1
    when member.team = 2 and match.actual_sets = '0:2' then 3
    when member.team = 2 and match.actual_sets = '1:2' then 2
    when member.team = 2 and match.actual_sets = '2:1' then 1
    else 0
  end as points,
  match.counts_for_ranking,
  match.cancelled_at is null as is_complete,
  null::bigint as training_session_id,
  null::integer as training_round_number
from public.matches as match
join public.seasons as season on season.id = match.season_id and season.counts_for_profile
join public.match_players as member on member.match_id = match.id
where (
    (match.actual_sets is not null and match.winner is not null)
    or match.cancelled_at is not null
  )
  and match.match_type in ('season', 'final')

union all

select
  participant.player_id,
  'training-' || session.id || '-' || round.round_number,
  'training'::text,
  session.played_on,
  to_char(session.display_time, 'HH24.MI'),
  null::text,
  'Training'::text,
  case when participant.player_id = any(round.team_one_ids) then 1 else 2 end::smallint,
  round.result_details,
  case
    when not round.is_complete then 'unfinished'
    when (private.profile_set_win_totals(round.result_details, round.set_count))[1]
       = (private.profile_set_win_totals(round.result_details, round.set_count))[2] then 'draw'
    when participant.player_id = any(round.team_one_ids)
      then case when (private.profile_set_win_totals(round.result_details, round.set_count))[1]
                   > (private.profile_set_win_totals(round.result_details, round.set_count))[2]
                then 'win' else 'loss' end
    else case when (private.profile_set_win_totals(round.result_details, round.set_count))[2]
                 > (private.profile_set_win_totals(round.result_details, round.set_count))[1]
              then 'win' else 'loss' end
  end::text,
  coalesce((
    select array_agg(private.training_participant_display_name(member.player_id, session.guest_names) order by member.ordinality)
    from unnest(case when participant.player_id = any(round.team_one_ids)
      then round.team_one_ids else round.team_two_ids end)
      with ordinality as member(player_id, ordinality)
    where member.player_id <> participant.player_id
  ), '{}')::text[],
  coalesce((
    select array_agg(private.training_participant_display_name(member.player_id, session.guest_names) order by member.ordinality)
    from unnest(case when participant.player_id = any(round.team_one_ids)
      then round.team_two_ids else round.team_one_ids end)
      with ordinality as member(player_id, ordinality)
  ), '{}')::text[],
  case when participant.player_id = any(round.team_one_ids)
    then (private.profile_regular_game_totals(round.result_details))[1]
    else (private.profile_regular_game_totals(round.result_details))[2] end,
  case when participant.player_id = any(round.team_one_ids)
    then (private.profile_regular_game_totals(round.result_details))[2]
    else (private.profile_regular_game_totals(round.result_details))[1] end,
  0,
  false,
  round.is_complete,
  session.id,
  round.round_number
from public.training_sessions as session
join public.training_rounds as round on round.session_id = session.id
cross join lateral unnest(session.player_ids) as participant(player_id)
join public.players as profile_player on profile_player.id = participant.player_id
where session.status = 'confirmed';

revoke execute on function private.training_participant_display_name(text, jsonb) from public, anon, authenticated;
revoke execute on function public.create_training_session(date, time, text[], jsonb, jsonb) from public, anon;
revoke execute on function public.replace_pending_training_session(bigint, date, time, text[], jsonb, jsonb) from public, anon;
revoke execute on function public.get_my_training_tasks() from public, anon;
grant execute on function public.create_training_session(date, time, text[], jsonb, jsonb) to authenticated;
grant execute on function public.replace_pending_training_session(bigint, date, time, text[], jsonb, jsonb) to authenticated;
grant execute on function public.get_my_training_tasks() to authenticated;

notify pgrst, 'reload schema';

commit;
