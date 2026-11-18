begin;

-- Expose only the court abbreviation, never booking identities or access data.
create function private.match_court_code(p_match_id text)
returns text language sql stable set search_path = '' as $$
  select substring(upper(trim(booking.court_name)) from '(?:^|[[:space:]])(H[1-4]|C10|C[1-9])$')
  from private.court_bookings booking
  join public.matches match on match.id = booking.match_id
  where booking.match_id = p_match_id and booking.cancelled_at is null
    and match.cancelled_at is null
  limit 1;
$$;
revoke all on function private.match_court_code(text) from public, anon, authenticated;

alter function public.get_public_season(text) rename to get_public_season_without_court;
alter function public.get_public_season_without_court(text) set schema private;
revoke all on function private.get_public_season_without_court(text) from public, anon, authenticated;

create function public.get_public_season(p_season_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with base as (select private.get_public_season_without_court(p_season_id) payload)
  select case when payload is null then null else jsonb_set(payload, '{matches}', coalesce((
    select jsonb_agg(item.value || jsonb_build_object('courtCode', private.match_court_code(item.value ->> 'id'))
      order by item.ordinality)
    from jsonb_array_elements(coalesce(payload -> 'matches', '[]'::jsonb)) with ordinality item(value, ordinality)
  ), '[]'::jsonb)) end from base;
$$;
revoke all on function public.get_public_season(text) from public;
grant execute on function public.get_public_season(text) to anon, authenticated;

alter function public.get_public_match_detail(text) rename to get_public_match_detail_without_court;
alter function public.get_public_match_detail_without_court(text) set schema private;
revoke all on function private.get_public_match_detail_without_court(text) from public, anon, authenticated;

create function public.get_public_match_detail(p_match_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.get_public_match_detail_without_court(p_match_id)
    || jsonb_build_object('courtCode', private.match_court_code(p_match_id));
$$;
revoke all on function public.get_public_match_detail(text) from public;
grant execute on function public.get_public_match_detail(text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
