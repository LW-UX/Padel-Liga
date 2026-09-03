begin;

alter table public.training_rounds
  add column if not exists result_format text;

update public.training_rounds
set result_format = case
  when set_count = 1 then 'one_set'
  when set_count = 2 then 'two_sets'
  when result_details ~ '[–-]' then 'two_sets_match_tiebreak'
  else 'three_sets'
end
where result_format is null;

alter table public.training_rounds
  alter column result_format set not null;

alter table public.training_rounds
  drop constraint if exists training_rounds_result_format_check;

alter table public.training_rounds
  add constraint training_rounds_result_format_check
  check (result_format in ('one_set', 'two_sets', 'two_sets_match_tiebreak', 'three_sets'));

create or replace function private.training_regular_set_state(
  p_team_one integer,
  p_team_two integer
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_team_one is null and p_team_two is null then 'empty'
    when p_team_one is null or p_team_two is null or p_team_one < 0 or p_team_two < 0 then 'invalid'
    when (greatest(p_team_one, p_team_two) = 6 and least(p_team_one, p_team_two) <= 4)
      or (greatest(p_team_one, p_team_two) = 7 and least(p_team_one, p_team_two) in (5, 6)) then 'complete'
    when greatest(p_team_one, p_team_two) <= 5
      or (greatest(p_team_one, p_team_two) = 6 and least(p_team_one, p_team_two) >= 5) then 'partial'
    else 'invalid'
  end;
$$;

create or replace function private.training_tiebreak_state(
  p_team_one integer,
  p_team_two integer,
  p_target integer
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_team_one is null and p_team_two is null then 'empty'
    when p_team_one is null or p_team_two is null or p_team_one < 0 or p_team_two < 0 then 'invalid'
    when (greatest(p_team_one, p_team_two) = p_target and least(p_team_one, p_team_two) <= p_target - 2)
      or (greatest(p_team_one, p_team_two) > p_target and abs(p_team_one - p_team_two) = 2) then 'complete'
    when greatest(p_team_one, p_team_two) < p_target or abs(p_team_one - p_team_two) < 2 then 'partial'
    else 'invalid'
  end;
$$;

create or replace function private.profile_training_metrics(p_result_details text)
returns integer[]
language sql
immutable
set search_path = ''
as $$
  with source as (
    select (regexp_split_to_array(
      regexp_replace(coalesce(p_result_details, ''), '\([^)]*\)', '', 'g'),
      '\s*[–-]\s*'
    ))[1] as regular_result
  ), scores as (
    select
      (capture)[1]::integer as team_one,
      (capture)[2]::integer as team_two
    from source,
      regexp_matches(regular_result, '([0-9]+)\s*:\s*([0-9]+)', 'g') as score(capture)
  ), completed as (
    select *
    from scores
    where private.training_regular_set_state(team_one, team_two) = 'complete'
  )
  select array[
    count(*)::integer,
    count(*) filter (where team_one > team_two)::integer,
    count(*) filter (where team_two > team_one)::integer,
    coalesce(sum(team_one), 0)::integer,
    coalesce(sum(team_two), 0)::integer
  ]
  from completed;
$$;

create or replace function private.profile_match_weight(
  p_kind text,
  p_result_details text
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kind = 'training' then (private.profile_training_metrics(p_result_details))[1] * 0.5::numeric
    else 1::numeric
  end;
$$;

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
  new_session_id bigint;
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
  returning id into new_session_id;

  for round_item in select value from jsonb_array_elements(p_rounds)
  loop
    round_number := round_number + 1;
    select array_agg(value) into team_one from jsonb_array_elements_text(round_item -> 'team_one_ids');
    select array_agg(value) into team_two from jsonb_array_elements_text(round_item -> 'team_two_ids');
    if cardinality(team_one) <> 2 or cardinality(team_two) <> 2
      or (select count(distinct id) from unnest(team_one || team_two) as id) <> 4
      or exists (select 1 from unnest(team_one || team_two) as id where not (id = any(p_player_ids))) then
      raise exception 'Jede Trainingsrunde muss dieselben vier Spieler genau einmal enthalten.';
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
  current_profile record;
  selected_session record;
  new_session_id bigint;
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  if not private.user_email_is_confirmed(current_user_id) then raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen.'; end if;
  select profile.* into current_profile from public.profiles as profile where profile.id = current_user_id;
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

  delete from public.training_sessions where id = selected_session.id;
  select public.create_training_session(p_played_on, p_display_time, p_player_ids, p_rounds) into new_session_id;
  return new_session_id;
end;
$$;

create or replace function public.get_my_training_tasks()
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

create or replace function public.get_player_profile(p_player_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with selected_player as (
    select player.* from public.players as player where player.id = p_player_id
  ), career_source as (
    select
      history.*,
      private.profile_training_metrics(history.result_details) as training_metrics,
      private.profile_match_weight(history.kind, history.result_details) as match_weight
    from private.player_profile_match_rows as history
    where history.player_id = p_player_id
  ), career as (
    select
      source.*,
      case
        when source.kind <> 'training' then source.outcome
        when (source.training_metrics)[1] = 0 then 'unfinished'
        when (case when source.team = 1 then (source.training_metrics)[2] else (source.training_metrics)[3] end)
           = (case when source.team = 1 then (source.training_metrics)[3] else (source.training_metrics)[2] end) then 'draw'
        when (case when source.team = 1 then (source.training_metrics)[2] else (source.training_metrics)[3] end)
           > (case when source.team = 1 then (source.training_metrics)[3] else (source.training_metrics)[2] end) then 'win'
        else 'loss'
      end::text as weighted_outcome,
      case when source.kind = 'training'
        then (case when source.team = 1 then (source.training_metrics)[2] else (source.training_metrics)[3] end) * 0.5::numeric
        else case when source.outcome = 'win' then 1::numeric else 0::numeric end
      end as win_weight,
      case when source.kind = 'training'
        then (case when source.team = 1 then (source.training_metrics)[3] else (source.training_metrics)[2] end) * 0.5::numeric
        else case when source.outcome = 'loss' then 1::numeric else 0::numeric end
      end as loss_weight,
      case when source.kind = 'training'
        then case when source.team = 1 then (source.training_metrics)[4] else (source.training_metrics)[5] end
        else source.games_for
      end as weighted_games_for,
      case when source.kind = 'training'
        then case when source.team = 1 then (source.training_metrics)[5] else (source.training_metrics)[4] end
        else source.games_against
      end as weighted_games_against
    from career_source as source
  ), scored_career as (
    select * from career where match_weight > 0
  ), elo_events as (
    select participant.season_id, season.label as season_label, season.starts_on as event_date,
      null::text as display_time, 'Start'::text as label, participant.start_elo as elo, 0 as event_order
    from public.season_players as participant
    join public.seasons as season on season.id = participant.season_id and season.counts_for_profile
    where participant.player_id = p_player_id
    union all
    select match.season_id, season.label, match.scheduled_date, match.display_time,
      coalesce(match.display_label, 'Partie ' || match.matchday), change.new_elo, 1
    from public.match_elo_changes as change
    join public.matches as match on match.id = change.match_id and match.counts_for_elo
    join public.seasons as season on season.id = match.season_id and season.counts_for_profile
    where change.player_id = p_player_id
  ), ordered_elo as (
    select * from elo_events
    order by event_date nulls last, display_time nulls last, event_order, label
  )
  select case when exists (select 1 from selected_player) then jsonb_build_object(
    'identity', (select jsonb_build_object(
      'id', player.id, 'displayName', player.display_name, 'initials', player.initials, 'company', player.company
    ) from selected_player as player),
    'summary', jsonb_build_object(
      'currentElo', (select elo from ordered_elo order by event_date desc nulls last, display_time desc nulls last, event_order desc limit 1),
      'peakElo', (select max(elo) from ordered_elo),
      'matches', coalesce((select sum(match_weight) from scored_career), 0),
      'wins', coalesce((select sum(win_weight) from scored_career), 0),
      'losses', coalesce((select sum(loss_weight) from scored_career), 0),
      'gamesFor', coalesce((select sum(weighted_games_for) from scored_career), 0),
      'gamesAgainst', coalesce((select sum(weighted_games_against) from scored_career), 0),
      'gameDiff', coalesce((select sum(weighted_games_for - weighted_games_against) from scored_career), 0)
    ),
    'eloSeries', coalesce((select jsonb_agg(jsonb_build_object(
      'seasonId', event.season_id, 'seasonLabel', event.season_label, 'date', event.event_date,
      'label', event.label, 'elo', event.elo
    ) order by event.event_date nulls last, event.display_time nulls last, event.event_order, event.label)
      from ordered_elo as event), '[]'::jsonb),
    'participations', coalesce((select jsonb_agg(jsonb_build_object(
      'seasonId', stats.season_id, 'seasonLabel', stats.season_label, 'isActive', stats.is_active,
      'rank', stats.rank, 'matches', stats.matches, 'wins', stats.wins,
      'losses', stats.matches - stats.wins, 'points', stats.points,
      'gameDiff', stats.games_for - stats.games_against
    ) order by stats.is_active desc, stats.season_id desc)
      from private.season_player_statistics as stats where stats.player_id = p_player_id), '[]'::jsonb),
    'achievements', coalesce((select jsonb_agg(jsonb_build_object(
      'id', achievement.id, 'kind', achievement.kind, 'title', achievement.title,
      'subtitle', achievement.subtitle, 'achievedOn', achievement.achieved_on, 'seasonId', achievement.season_id
    ) order by achievement.priority desc, achievement.achieved_on desc nulls last, achievement.id)
      from public.player_achievements as achievement
      left join public.seasons as season on season.id = achievement.season_id
      where achievement.player_id = p_player_id and (achievement.season_id is null or season.counts_for_profile)), '[]'::jsonb),
    'matches', coalesce((select jsonb_agg(jsonb_build_object(
      'id', history.row_id,
      'kind', history.kind,
      'matchWeight', history.match_weight,
      'winWeight', history.win_weight,
      'lossWeight', history.loss_weight,
      'date', history.played_on,
      'seasonId', history.season_id,
      'seasonLabel', history.season_label,
      'resultDetails', history.result_details,
      'team', history.team,
      'outcome', history.weighted_outcome,
      'isComplete', history.is_complete,
      'trainingSessionId', history.training_session_id,
      'trainingRoundNumber', history.training_round_number,
      'partnerNames', to_jsonb(history.partner_names),
      'opponentNames', to_jsonb(history.opponent_names)
    ) order by history.played_on desc nulls last, history.display_time desc nulls last,
      history.training_session_id desc nulls last, history.training_round_number asc nulls last, history.row_id desc)
      from career as history), '[]'::jsonb)
  ) else null end;
$$;

revoke execute on function public.create_training_session(date, time, text[], jsonb) from public, anon;
revoke execute on function public.replace_pending_training_session(bigint, date, time, text[], jsonb) from public, anon;
revoke execute on function public.delete_my_pending_training(bigint) from public, anon, authenticated;
revoke execute on function public.get_my_training_tasks() from public, anon;
revoke execute on function public.get_training_sessions() from public;
revoke execute on function public.get_player_profile(text) from public;
grant execute on function public.create_training_session(date, time, text[], jsonb) to authenticated;
grant execute on function public.replace_pending_training_session(bigint, date, time, text[], jsonb) to authenticated;
grant execute on function public.get_my_training_tasks() to authenticated;
grant execute on function public.get_training_sessions() to anon, authenticated;
grant execute on function public.get_player_profile(text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
