begin;

do $$
declare
  target_count integer;
begin
  select count(*)
  into target_count
  from public.matches
  where season_id = 'test-2026'
    and id in (
      'test-2026-partie-7',
      'test-2026-partie-9',
      'test-2026-partie-10'
    );

  if target_count <> 3 then
    raise exception 'Expected exactly 3 test matches, found %', target_count;
  end if;
end
$$;

update public.matches
set
  scheduled_date = null,
  display_time = null,
  lock_at = null
where season_id = 'test-2026'
  and id in (
    'test-2026-partie-7',
    'test-2026-partie-9',
    'test-2026-partie-10'
  );

commit;
