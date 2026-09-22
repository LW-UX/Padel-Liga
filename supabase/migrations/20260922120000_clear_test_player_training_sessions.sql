delete from public.training_sessions
where player_ids && array['ludi_gmail', 'ludi_gmx', 'ludi_ionos']::text[];

do $$
begin
  if exists (
    select 1
    from public.training_sessions
    where player_ids && array['ludi_gmail', 'ludi_gmx', 'ludi_ionos']::text[]
  ) then
    raise exception 'Training sessions with test players still exist.';
  end if;
end;
$$;
