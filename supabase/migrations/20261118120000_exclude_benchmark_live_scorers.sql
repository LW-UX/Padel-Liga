begin;

create or replace function public.get_live_scorer_candidates(p_match_id text)
returns table (profile_id uuid, display_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me record;
begin
  select profile.* into me
  from public.profiles as profile
  where profile.id = (select auth.uid());

  if me.id is null then
    raise exception 'Nicht angemeldet.';
  end if;

  if me.app_role <> 'admin' and not exists (
    select 1
    from public.match_players as member
    where member.match_id = p_match_id
      and member.player_id = me.player_id
  ) then
    raise exception 'Nur Beteiligte dürfen einen Schreiber festlegen.';
  end if;

  return query
    select profile.id, profile.display_name
    from public.profiles as profile
    join auth.users as auth_user
      on auth_user.id = profile.id
     and auth_user.email_confirmed_at is not null
    where not private.is_benchmark_account(profile.id)
    order by profile.display_name;
end;
$$;

create or replace function public.nominate_live_scorer(
  p_match_id text,
  p_scorer_profile_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  me record;
  selected_match record;
  new_id bigint;
begin
  select profile.* into me
  from public.profiles as profile
  where profile.id = (select auth.uid());

  if me.id is null or not private.user_email_is_confirmed(me.id) then
    raise exception 'Bitte zuerst anmelden und die E-Mail-Adresse bestätigen.';
  end if;

  select match.* into selected_match
  from public.matches as match
  where match.id = p_match_id
  for update;

  if selected_match.id is null
    or selected_match.competition_stage <> 'final_four'
    or selected_match.format <> 'single-set'
    or selected_match.match_at is null
    or selected_match.actual_sets is not null then
    raise exception 'Für diese Partie kann kein Schreiber festgelegt werden.';
  end if;

  if (
    select count(*)
    from public.match_players as member
    where member.match_id = p_match_id
  ) <> 4 then
    raise exception 'Für den Liveticker müssen vier Spieler feststehen.';
  end if;

  if exists (
    select 1
    from public.live_match_sessions as session
    where session.match_id = p_match_id
      and session.status <> 'cancelled'
  ) then
    raise exception 'Nach dem Start kann der Schreiber nicht mehr geändert werden.';
  end if;

  if me.app_role <> 'admin' and not exists (
    select 1
    from public.match_players as member
    where member.match_id = p_match_id
      and member.player_id = me.player_id
  ) then
    raise exception 'Nur Beteiligte dürfen einen Schreiber festlegen.';
  end if;

  if private.is_benchmark_account(p_scorer_profile_id) then
    raise exception 'Technische Konten können nicht als Schreiber eingesetzt werden.';
  end if;

  if not private.user_email_is_confirmed(p_scorer_profile_id) then
    raise exception 'Dieses Konto ist nicht bestätigt.';
  end if;

  update public.live_match_scorer_assignments
  set status = 'revoked', revoked_at = now()
  where match_id = p_match_id
    and status in ('pending', 'accepted');

  insert into public.live_match_scorer_assignments(
    match_id,
    scorer_profile_id,
    nominated_by
  ) values (
    p_match_id,
    p_scorer_profile_id,
    me.id
  )
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.get_live_scorer_candidates(text) from public;
revoke all on function public.nominate_live_scorer(text, uuid) from public;
grant execute on function public.get_live_scorer_candidates(text) to authenticated;
grant execute on function public.nominate_live_scorer(text, uuid) to authenticated;

commit;
