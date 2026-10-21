begin;

create or replace function public.submit_match_quick_prediction(
  p_match_id text,
  p_prediction text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  selected_match record;
begin
  if current_user_id is null then raise exception 'Nicht angemeldet.'; end if;
  if not private.user_email_is_confirmed(current_user_id) then
    raise exception 'Bitte zuerst die E-Mail-Adresse bestätigen.';
  end if;
  if p_prediction is null or p_prediction not in ('2:0', '2:1', '1:2', '0:2') then
    raise exception 'Ungültiger Tipp.';
  end if;

  select match.* into selected_match
  from public.matches as match
  where match.id = p_match_id
  for update of match;
  if not found then raise exception 'Partie nicht gefunden.'; end if;

  if private.match_forecast_mode(p_match_id) is distinct from 'preview'
    or not selected_match.betting_open
    or selected_match.winner is not null
    or selected_match.actual_sets is not null then
    raise exception 'Für diese Partie ist kein Tipp geöffnet.';
  end if;
  if selected_match.match_at is not null and selected_match.match_at <= now() then
    raise exception 'Die Tippabgabe ist bereits beendet.';
  end if;

  insert into public.predictions(user_id, match_id, prediction)
  values (current_user_id, p_match_id, p_prediction)
  on conflict (user_id, match_id) do update
    set prediction = excluded.prediction,
        updated_at = now();

  return private.get_match_forecast_state(p_match_id, current_user_id);
end;
$$;

revoke all on function public.submit_match_quick_prediction(text,text) from public, anon;
grant execute on function public.submit_match_quick_prediction(text,text) to authenticated;

notify pgrst, 'reload schema';

commit;
