-- Approved live smoke test. Only temporary booking rows, no match changes.
-- All inserted records are rolled back.
begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare
  result jsonb;
begin
  if has_function_privilege('anon', 'public.record_court_booking(text,text,text,text,timestamptz,timestamptz,boolean,timestamptz,integer)', 'execute')
    or has_function_privilege('authenticated', 'public.record_court_booking(text,text,text,text,timestamptz,timestamptz,boolean,timestamptz,integer)', 'execute') then
    raise exception 'Import privilege check failed';
  end if;
  result := public.record_court_booking(null, null, 'Codex Importprüfung 60', 'Codex Test',
    '2099-10-06T10:30:00Z', '2099-10-06T11:30:00Z', true, '2099-10-05T09:21:00Z', 60);
  if result->>'status' <> 'cancelled' then raise exception 'Cancellation-first check failed'; end if;
  result := public.record_court_booking('codex-smoke-old', null, 'Codex Importprüfung 60', 'Codex Test',
    '2099-10-06T10:30:00Z', '2099-10-06T11:30:00Z', false, '2099-10-01T08:56:00Z', 60);
  if result->>'status' <> 'cancelled' then raise exception 'Delayed-confirmation check failed'; end if;
  result := public.record_court_booking('codex-smoke-new', null, 'Codex Importprüfung 60', 'Codex Test',
    '2099-10-06T10:30:00Z', '2099-10-06T11:30:00Z', false, '2099-10-05T10:00:00Z', 60);
  if result->>'status' <> 'active' then raise exception 'Rebooking check failed'; end if;
  result := public.record_court_booking(null, null, 'Codex Importprüfung 60', 'Codex Test',
    '2099-10-06T10:30:00Z', '2099-10-06T11:30:00Z', true, '2099-10-05T09:21:00Z', 60);
  if result->>'status' <> 'active' then raise exception 'Stale-cancellation check failed'; end if;
  result := public.record_court_booking(null, null, 'Codex Importprüfung 60', 'Codex Test',
    '2099-10-06T10:30:00Z', '2099-10-06T11:30:00Z', true, '2099-10-05T10:00:20Z', 1);
  if result->>'status' <> 'needs_review' then raise exception 'Minute-precision check failed'; end if;
  result := public.record_court_booking('codex-smoke-90', null, 'Codex Importprüfung 90', 'Codex Test',
    '2099-10-06T10:30:00Z', '2099-10-06T12:00:00Z', false, '2099-10-01T08:56:00Z', 60);
  if result->>'status' <> 'active' then raise exception '90-minute import check failed'; end if;
  result := public.record_court_booking(null, null, 'Codex Importprüfung 90', 'Codex Test',
    '2099-10-06T10:30:00Z', '2099-10-06T12:00:00Z', true, '2099-10-05T09:21:00Z', 60);
  if result->>'status' <> 'cancelled' then raise exception '90-minute cancellation check failed'; end if;
end;
$$;
rollback;
