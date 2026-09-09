begin;

create or replace function public.save_player_email_assignment(
  p_player_id text,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(coalesce(p_email, '')));
  requested_email_hash bytea;
  existing_auth_id uuid;
  existing_email_confirmed_at timestamptz;
  existing_profile_player_id text;
  player_account_id uuid;
  player_account_email text;
  mapped_player_id text;
  invitation_role public.app_role := 'player';
begin
  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.app_role = 'admin'
  ) then
    raise exception 'Nur Admins können Spieler-E-Mails zuordnen.';
  end if;

  if not exists (select 1 from public.players where id = p_player_id) then
    raise exception 'Der ausgewählte Spieler existiert nicht.';
  end if;

  if normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Bitte gib eine gültige Arbeits-E-Mail-Adresse ein.';
  end if;

  requested_email_hash := extensions.digest(normalized_email, 'sha256');

  select allowlist.player_id
  into mapped_player_id
  from private.player_email_allowlist as allowlist
  where allowlist.email_hash = requested_email_hash;

  if mapped_player_id is not null and mapped_player_id <> p_player_id then
    raise exception 'Diese E-Mail-Adresse ist bereits einem anderen Spieler zugeordnet.';
  end if;

  select profile.id, lower(trim(auth_user.email)), profile.app_role
  into player_account_id, player_account_email, invitation_role
  from public.profiles as profile
  join auth.users as auth_user on auth_user.id = profile.id
  where profile.player_id = p_player_id;

  if player_account_id is not null and player_account_email <> normalized_email then
    raise exception 'Für diesen Spieler besteht bereits ein Konto mit einer anderen E-Mail-Adresse.';
  end if;

  select auth_user.id, auth_user.email_confirmed_at
  into existing_auth_id, existing_email_confirmed_at
  from auth.users as auth_user
  where lower(trim(auth_user.email)) = normalized_email;

  if existing_auth_id is not null then
    select profile.player_id
    into existing_profile_player_id
    from public.profiles as profile
    where profile.id = existing_auth_id;

    if existing_profile_player_id is not null and existing_profile_player_id <> p_player_id then
      raise exception 'Das bestehende Konto ist bereits einem anderen Spieler zugeordnet.';
    end if;
  end if;

  select coalesce(
    (select allowlist.app_role
     from private.player_email_allowlist as allowlist
     where allowlist.player_id = p_player_id),
    invitation_role,
    'player'::public.app_role
  )
  into invitation_role;

  invitation_role := coalesce(invitation_role, 'player'::public.app_role);

  delete from private.player_email_allowlist
  where player_id = p_player_id
    and email_hash <> requested_email_hash;

  insert into private.player_email_allowlist (email_hash, player_id, app_role)
  values (requested_email_hash, p_player_id, invitation_role)
  on conflict (email_hash) do update set
    player_id = excluded.player_id,
    app_role = excluded.app_role;

  if existing_auth_id is not null then
    insert into public.profiles (id, display_name, player_id, app_role)
    values (
      existing_auth_id,
      private.display_name_from_email(normalized_email),
      p_player_id,
      invitation_role
    )
    on conflict (id) do update set
      player_id = excluded.player_id,
      app_role = excluded.app_role,
      display_name = excluded.display_name;

    return jsonb_build_object(
      'status',
      case when existing_email_confirmed_at is null then 'reinvite' else 'linked' end
    );
  end if;

  return jsonb_build_object('status', 'assigned');
end;
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
  if exists (
    select 1
    from private.player_email_allowlist
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

revoke execute on function public.save_player_email_assignment(text, text) from public, anon;
grant execute on function public.save_player_email_assignment(text, text) to authenticated;
grant usage on schema private to supabase_auth_admin;
grant select on private.player_email_allowlist, private.signup_email_domains to supabase_auth_admin;
grant execute on function private.hook_restrict_signup_by_email_domain(jsonb) to supabase_auth_admin;
revoke execute on function private.hook_restrict_signup_by_email_domain(jsonb) from public, anon, authenticated;

commit;
