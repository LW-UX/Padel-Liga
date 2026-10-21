begin;

do $$
declare
  target_user_id uuid;
  updated_allowlist_count integer;
begin
  select profile.id
  into target_user_id
  from public.profiles as profile
  join auth.users as auth_user on auth_user.id = profile.id
  where profile.player_id = 'test_net'
    and auth_user.email_confirmed_at is null
    and extensions.digest(lower(trim(auth_user.email)), 'sha256') = decode(
      '0ae76e26e22e74c7cf70a1a46dd29bed4d3db7523516b6c08931a8469d3aa624',
      'hex'
    );

  if target_user_id is null then
    raise exception 'Der erwartete unbestätigte Test-Net-Fehlzugang wurde nicht gefunden.';
  end if;

  if exists (
    select 1
    from auth.users as auth_user
    where extensions.digest(lower(trim(auth_user.email)), 'sha256') = decode(
      '4aa58c38a325746f037faeb24ad6647aaac2b511e585c934f121d3507d7b27ea',
      'hex'
    )
  ) or exists (
    select 1
    from private.player_email_allowlist as allowlist
    where allowlist.email_hash = decode(
      '4aa58c38a325746f037faeb24ad6647aaac2b511e585c934f121d3507d7b27ea',
      'hex'
    )
  ) then
    raise exception 'Die korrigierte E-Mail-Adresse ist bereits registriert oder freigegeben.';
  end if;

  if exists (select 1 from public.predictions where user_id = target_user_id)
    or exists (select 1 from public.result_proposals where proposed_by = target_user_id or confirmed_by = target_user_id)
    or exists (select 1 from public.training_sessions where created_by = target_user_id or confirmed_by = target_user_id)
    or exists (select 1 from public.live_match_events where actor_user_id = target_user_id or voided_by = target_user_id)
    or exists (select 1 from public.live_match_official_corrections where corrected_by = target_user_id)
    or exists (select 1 from public.live_match_scorer_assignments where scorer_profile_id = target_user_id or nominated_by = target_user_id)
  then
    raise exception 'Der unbestätigte Fehlzugang besitzt bereits abhängige Aktivität.';
  end if;

  delete from auth.users where id = target_user_id;

  update private.player_email_allowlist
  set email_hash = decode(
    '4aa58c38a325746f037faeb24ad6647aaac2b511e585c934f121d3507d7b27ea',
    'hex'
  )
  where player_id = 'test_net'
    and email_hash = decode(
      '0ae76e26e22e74c7cf70a1a46dd29bed4d3db7523516b6c08931a8469d3aa624',
      'hex'
    );

  get diagnostics updated_allowlist_count = row_count;
  if updated_allowlist_count <> 1 then
    raise exception 'Die Test-Net-E-Mail-Freigabe konnte nicht eindeutig korrigiert werden.';
  end if;
end;
$$;

commit;
