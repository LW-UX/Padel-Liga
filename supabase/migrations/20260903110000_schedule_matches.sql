begin;

create or replace function public.schedule_match(
  p_match_id text,
  p_scheduled_date date,
  p_scheduled_time time
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_profile record;
  selected_match record;
  user_team smallint;
  scheduled_at timestamptz;
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  if not private.user_email_is_confirmed(current_user_id) then
    raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen.';
  end if;
  if p_scheduled_date is null or p_scheduled_time is null then
    raise exception 'Bitte Datum und Uhrzeit angeben.';
  end if;

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
  if selected_match.actual_sets is not null or selected_match.result_details is not null then
    raise exception 'Die Partie besitzt bereits ein offizielles Ergebnis.';
  end if;
  if exists (
    select 1
    from public.result_proposals as proposal
    where proposal.match_id = p_match_id
      and proposal.status = 'pending'
  ) then
    raise exception 'Für diese Partie wartet bereits ein Ergebnis auf Bestätigung.';
  end if;
  if selected_match.scheduled_date is not null
    and nullif(trim(selected_match.display_time), '') is not null
    and selected_match.lock_at is not null then
    raise exception 'Die Partie ist bereits terminiert.';
  end if;

  select member.team into user_team
  from public.match_players as member
  where member.match_id = p_match_id
    and member.player_id = current_profile.player_id;

  if current_profile.app_role is distinct from 'admin' and user_team is null then
    raise exception 'Nur beteiligte Spieler dürfen die Partie terminieren.';
  end if;

  scheduled_at := (p_scheduled_date + p_scheduled_time) at time zone 'Europe/Berlin';
  update public.matches
  set
    scheduled_date = p_scheduled_date,
    display_time = replace(left(p_scheduled_time::text, 5), ':', '.'),
    lock_at = scheduled_at
  where id = p_match_id;
end;
$$;

revoke execute on function public.schedule_match(text, date, time) from public, anon;
grant execute on function public.schedule_match(text, date, time) to authenticated;

notify pgrst, 'reload schema';

commit;
