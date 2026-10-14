begin;

-- Keep the already deployed detail implementation intact and decorate its
-- public payload with the season's qualification boundary for table styling.
alter function public.get_public_match_detail(text)
  rename to get_public_match_detail_without_qualification_places;

alter function public.get_public_match_detail_without_qualification_places(text)
  set schema private;

revoke all on function private.get_public_match_detail_without_qualification_places(text)
  from public, anon, authenticated;

create function public.get_public_match_detail(p_match_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select detail.value || jsonb_build_object(
    'qualificationPlaces', season.qualification_places
  )
  from (
    select private.get_public_match_detail_without_qualification_places(p_match_id) as value
  ) detail
  left join public.seasons season
    on season.id = detail.value->>'seasonId';
$$;

revoke all on function public.get_public_match_detail(text) from public;
grant execute on function public.get_public_match_detail(text) to anon, authenticated;

commit;
