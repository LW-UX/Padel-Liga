begin;

-- Liefert der Edge Function racket-booking den Sollzustand einer Schlägerbuchung,
-- ohne ihr Lesezugriff auf die Partie-, Trainings- oder Profiltabellen zu geben.
create function public.get_racket_booking_subject(
  p_subject_type text,
  p_subject_id text,
  p_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_profile record;
  selected_match record;
  selected_session record;
  local_at timestamp;
begin
  select profile.player_id, profile.app_role::text as app_role into current_profile
  from public.profiles as profile
  where profile.id = p_user_id;

  if p_subject_type = 'match' then
    select match.id, match.display_label, match.competition_stage, match.match_at, match.cancelled_at,
      match.actual_sets, match.result_details, season.counts_for_profile
    into selected_match
    from public.matches as match
    join public.seasons as season on season.id = match.season_id
    where match.id = p_subject_id;
    if not found then return jsonb_build_object('kind', 'none'); end if;

    if current_profile.app_role is distinct from 'admin' and not exists (
      select 1 from public.match_players as member
      where member.match_id = p_subject_id and member.player_id = current_profile.player_id
    ) then
      return jsonb_build_object('kind', 'forbidden');
    end if;

    if selected_match.counts_for_profile is false then return jsonb_build_object('kind', 'none'); end if;
    if selected_match.actual_sets is not null or selected_match.result_details is not null or exists (
      select 1 from public.result_proposals as proposal
      where proposal.match_id = p_subject_id and proposal.status = 'pending'
    ) then
      return jsonb_build_object('kind', 'frozen');
    end if;
    if selected_match.cancelled_at is not null or selected_match.match_at is null then
      return jsonb_build_object('kind', 'none');
    end if;
    if selected_match.match_at <= now() then return jsonb_build_object('kind', 'frozen'); end if;

    local_at := selected_match.match_at at time zone 'Europe/Berlin';
    return jsonb_build_object(
      'kind', 'slot',
      'date', to_char(local_at, 'YYYY-MM-DD'),
      'time', to_char(local_at, 'HH24:MI'),
      'match', jsonb_build_object(
        'id', selected_match.id,
        'display_label', selected_match.display_label,
        'competition_stage', selected_match.competition_stage
      )
    );
  end if;

  if p_subject_type = 'training' then
    if p_subject_id !~ '^\d+$' then return jsonb_build_object('kind', 'none'); end if;
    select session.played_on, session.display_time, session.player_ids, session.created_by, session.status
    into selected_session
    from public.training_sessions as session
    where session.id = p_subject_id::bigint;
    if not found then return jsonb_build_object('kind', 'none'); end if;

    if current_profile.app_role is distinct from 'admin'
      and selected_session.created_by is distinct from p_user_id
      and (current_profile.player_id = any(selected_session.player_ids)) is not true then
      return jsonb_build_object('kind', 'forbidden');
    end if;

    if selected_session.player_ids && array['ludi_gmail', 'ludi_gmx', 'ludi_ionos', 'test_net']::text[] then
      return jsonb_build_object('kind', 'none');
    end if;
    if selected_session.status <> 'scheduled'
      or private.training_session_at(selected_session.played_on, selected_session.display_time) <= now() then
      return jsonb_build_object('kind', 'frozen');
    end if;

    return jsonb_build_object(
      'kind', 'slot',
      'date', to_char(selected_session.played_on, 'YYYY-MM-DD'),
      'time', to_char(selected_session.display_time, 'HH24:MI')
    );
  end if;

  return jsonb_build_object('kind', 'none');
end;
$$;

revoke execute on function public.get_racket_booking_subject(text, text, uuid) from public, anon, authenticated;
grant execute on function public.get_racket_booking_subject(text, text, uuid) to service_role;

commit;
