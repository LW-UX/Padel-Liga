-- Read-only preflight, without account or match data.
select jsonb_build_object(
  'bookings_exist', to_regclass('private.court_bookings') is not null,
  'import_exists', to_regprocedure('public.record_court_booking(text,text,text,text,timestamptz,timestamptz,boolean,timestamptz,integer)') is not null,
  'temporary_test_rows', (select count(*) from private.court_bookings where organizer = 'Codex Test'),
  'scheduling_functions', (select jsonb_agg(jsonb_build_object('name', proname, 'definition', pg_get_functiondef(oid)))
    from pg_proc where pronamespace = 'public'::regnamespace and proname in ('schedule_match', 'unschedule_match'))
) as readiness;
