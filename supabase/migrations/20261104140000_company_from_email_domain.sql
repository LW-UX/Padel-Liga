begin;

create or replace function private.company_from_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case split_part(lower(trim(coalesce(p_email, ''))), '@', 2)
    when 'envidual.com' then 'Envidual'
    when 'hanako-health.com' then 'Hanako'
    when 'headsquare.group' then 'Headsquare'
    else null
  end;
$$;

revoke all on function private.company_from_email(text) from public;

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

  insert into public.profiles (id, display_name, player_id, app_role, company)
  values (
    new.id,
    private.display_name_from_email(new.email),
    mapped_player_id,
    coalesce(mapped_role, 'tipper'::public.app_role),
    private.company_from_email(new.email)
  );
  return new;
end;
$$;

commit;
