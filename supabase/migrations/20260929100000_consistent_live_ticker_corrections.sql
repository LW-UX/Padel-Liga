begin;

create or replace function public.get_public_live_ticker(p_match_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  payload jsonb;
begin
  payload := private.live_public_payload(p_match_id);

  if coalesce((payload->>'corrected')::boolean, false)
    and payload->'session' is not null
  then
    payload := jsonb_set(payload, '{session,events}', '[]'::jsonb, false);
  end if;

  return payload;
end;
$$;

revoke all on function public.get_public_live_ticker(text) from public;
grant execute on function public.get_public_live_ticker(text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
