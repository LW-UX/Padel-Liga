begin;

-- A server-only membership check, never an address list or a public account
-- lookup. Current confirmed account addresses apply to every account role.
create function public.has_registered_court_booking_email(p_emails text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt() ->> 'role'), '') = 'service_role'
    and coalesce(cardinality(p_emails), 0) between 1 and 50
    and exists (
      select 1 from auth.users as account
      join public.profiles as profile on profile.id = account.id
      join unnest(p_emails) as candidate(email)
        on lower(account.email) = lower(trim(candidate.email))
      where account.email_confirmed_at is not null
        and length(trim(candidate.email)) between 3 and 254
    );
$$;

revoke all on function public.has_registered_court_booking_email(text[]) from public, anon, authenticated;
grant execute on function public.has_registered_court_booking_email(text[]) to service_role;

commit;
