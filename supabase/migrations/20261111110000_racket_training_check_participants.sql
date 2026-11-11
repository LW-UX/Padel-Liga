begin;

-- Teilnehmer der aktuellen Formularauswahl, auch vor dem ersten Speichern.
-- Konto-E-Mails bleiben ausschließlich im geschützten Serverabgleich.
create function public.get_racket_training_check_participants(p_player_ids text[], p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_profile record;
begin
  select profile.player_id, profile.app_role::text as app_role into current_profile
  from public.profiles as profile where profile.id = p_user_id;
  if current_profile.app_role is null
    or current_profile.app_role not in ('player', 'admin')
    or not private.user_email_is_confirmed(p_user_id)
    or coalesce(cardinality(p_player_ids), 0) > 4 then
    return '[]'::jsonb;
  end if;
  if current_profile.app_role <> 'admin'
    and (current_profile.player_id = any(p_player_ids)) is not true then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('name', player.display_name, 'email', lower(account.email)))
    from public.players as player
    join public.profiles as profile on profile.player_id = player.id
    join auth.users as account on account.id = profile.id
    where player.id = any(p_player_ids) and account.email is not null
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.get_racket_training_check_participants(text[], uuid) from public, anon, authenticated;
grant execute on function public.get_racket_training_check_participants(text[], uuid) to service_role;

commit;
