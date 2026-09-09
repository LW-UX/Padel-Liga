begin;

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
    from private.signup_email_domains as allowed_domain
    where allowed_domain.domain = requested_domain
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Für diese E-Mail-Domain ist keine Registrierung möglich.'
  ));
end;
$$;

grant usage on schema private to supabase_auth_admin;
grant select on private.signup_email_domains to supabase_auth_admin;
grant execute on function private.hook_restrict_signup_by_email_domain(jsonb) to supabase_auth_admin;
revoke execute on function private.hook_restrict_signup_by_email_domain(jsonb) from public, anon, authenticated;

commit;
