begin;

create or replace function public.submit_match_result(
  p_match_id text,
  p_result_details text,
  p_actual_sets text,
  p_winner smallint,
  p_match_at timestamp without time zone
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
  official_match_at timestamptz;
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  if not private.user_email_is_confirmed(current_user_id) then
    raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen.';
  end if;
  if p_match_at is null then raise exception 'Bitte tatsächliches Datum und Uhrzeit angeben.'; end if;
  official_match_at := p_match_at at time zone 'Europe/Berlin';
  if official_match_at > now() + interval '5 minutes' then
    raise exception 'Die tatsächliche Spielzeit darf nicht in der Zukunft liegen.';
  end if;
  perform private.validate_official_result(trim(p_result_details), p_actual_sets, p_winner);

  select profile.* into current_profile
  from public.profiles as profile where profile.id = current_user_id;
  if not found then raise exception 'Kein Profil für dieses Konto gefunden.'; end if;

  select match.* into selected_match
  from public.matches as match
  join public.seasons as season on season.id = match.season_id
  where match.id = p_match_id and season.results_entry_enabled
  for update of match;
  if not found then raise exception 'Partie nicht gefunden.'; end if;
  if selected_match.actual_sets is not null then
    raise exception 'Die Partie besitzt bereits ein offizielles Ergebnis.';
  end if;

  select member.team into user_team
  from public.match_players as member
  where member.match_id = p_match_id and member.player_id = current_profile.player_id;
  if current_profile.app_role <> 'admin' and user_team is null then
    raise exception 'Nur beteiligte Spieler dürfen Ergebnisse eintragen.';
  end if;

  select proposal.* into pending_proposal
  from public.result_proposals as proposal
  where proposal.match_id = p_match_id and proposal.status = 'pending'
  for update;
  if current_profile.app_role <> 'admin'
    and pending_proposal.id is not null
    and pending_proposal.proposed_by_team = user_team then
    raise exception 'Jetzt ist das gegnerische Team an der Reihe.';
  end if;
  if pending_proposal.id is not null
    and pending_proposal.match_at is not distinct from official_match_at
    and trim(pending_proposal.result_details) is not distinct from trim(p_result_details)
    and pending_proposal.actual_sets is not distinct from p_actual_sets
    and pending_proposal.winner is not distinct from p_winner then
    raise exception 'Das entspricht dem bestehenden Vorschlag. Bitte bestätige das Ergebnis stattdessen.';
  end if;

  if current_profile.app_role = 'admin' then
    perform pg_advisory_xact_lock(70317, 20270909);
    if pending_proposal.id is not null then
      update public.result_proposals
      set status = 'superseded', resolved_at = now()
      where id = pending_proposal.id;
    end if;
    update public.matches
    set match_at = official_match_at,
      result_details = trim(p_result_details), actual_sets = p_actual_sets, winner = p_winner
    where id = p_match_id;
    return null;
  end if;

  if pending_proposal.id is not null then
    update public.result_proposals
    set status = 'superseded', resolved_at = now()
    where id = pending_proposal.id;
  end if;

  select coalesce(max(proposal.revision), 0) + 1 into next_revision
  from public.result_proposals as proposal where proposal.match_id = p_match_id;

  insert into public.result_proposals (
    match_id, revision, proposed_by, proposed_by_team, match_at,
    result_details, actual_sets, winner
  ) values (
    p_match_id, next_revision, current_user_id, user_team, official_match_at,
    trim(p_result_details), p_actual_sets, p_winner
  ) returning id into new_proposal_id;

  return new_proposal_id;
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
    p_rounds
  ) into new_session_id;

  select session.* into candidate_session
  from public.training_sessions as session
  where session.id = new_session_id;

  proposals_are_equal := selected_session.played_on is not distinct from candidate_session.played_on
    and selected_session.display_time is not distinct from candidate_session.display_time
    and selected_session.player_ids @> candidate_session.player_ids
    and candidate_session.player_ids @> selected_session.player_ids
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

revoke execute on function public.submit_match_result(text, text, text, smallint, timestamp without time zone) from public, anon;
grant execute on function public.submit_match_result(text, text, text, smallint, timestamp without time zone) to authenticated;
revoke execute on function public.replace_pending_training_session(bigint, date, time, text[], jsonb) from public, anon;
grant execute on function public.replace_pending_training_session(bigint, date, time, text[], jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
