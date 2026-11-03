begin;

-- Profilbilder liegen im öffentlichen Bildspeicher; die Version dient zugleich als Cache-Schlüssel.
alter table public.players
  add column if not exists profile_image_version timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('player-images', 'player-images', true, 524288, array['image/webp', 'image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.current_image_player_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select profile.player_id
  from public.profiles as profile
  where profile.id = (select auth.uid())
    and profile.app_role in ('player', 'admin')
    and profile.player_id is not null;
$$;

revoke all on function private.current_image_player_id() from public;

-- Die Speicherregeln lesen das eigene Profil direkt, damit das Schema private nicht freigegeben werden muss.

drop policy if exists "Player images are public" on storage.objects;
create policy "Player images are public" on storage.objects for select to anon, authenticated
  using (bucket_id = 'player-images');

drop policy if exists "Players upload their own image" on storage.objects;
create policy "Players upload their own image" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'player-images'
    and (storage.foldername(name))[1] = (
      select profile.player_id from public.profiles as profile
      where profile.id = (select auth.uid()) and profile.app_role in ('player', 'admin')
    )
    and storage.filename(name) in ('profile.webp', 'thumb.jpg')
  );

drop policy if exists "Players replace their own image" on storage.objects;
create policy "Players replace their own image" on storage.objects for update to authenticated
  using (
    bucket_id = 'player-images'
    and (storage.foldername(name))[1] = (
      select profile.player_id from public.profiles as profile
      where profile.id = (select auth.uid()) and profile.app_role in ('player', 'admin')
    )
  )
  with check (
    bucket_id = 'player-images'
    and (storage.foldername(name))[1] = (
      select profile.player_id from public.profiles as profile
      where profile.id = (select auth.uid()) and profile.app_role in ('player', 'admin')
    )
    and storage.filename(name) in ('profile.webp', 'thumb.jpg')
  );

drop policy if exists "Players delete their own image" on storage.objects;
create policy "Players delete their own image" on storage.objects for delete to authenticated
  using (
    bucket_id = 'player-images'
    and (storage.foldername(name))[1] = (
      select profile.player_id from public.profiles as profile
      where profile.id = (select auth.uid()) and profile.app_role in ('player', 'admin')
    )
  );

create or replace function public.set_my_profile_image()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  image_player_id text := private.current_image_player_id();
  image_version timestamptz := now();
begin
  if image_player_id is null then
    raise exception 'Nur Spieler mit verknüpftem Profil können ein Profilbild speichern.';
  end if;

  update public.players
  set profile_image_version = image_version
  where id = image_player_id;

  return image_version;
end;
$$;

create or replace function public.remove_my_profile_image()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  image_player_id text := private.current_image_player_id();
begin
  if image_player_id is null then
    raise exception 'Nur Spieler mit verknüpftem Profil können ein Profilbild löschen.';
  end if;

  update public.players
  set profile_image_version = null
  where id = image_player_id;
end;
$$;

revoke all on function public.set_my_profile_image() from public, anon;
revoke all on function public.remove_my_profile_image() from public, anon;
grant execute on function public.set_my_profile_image() to authenticated;
grant execute on function public.remove_my_profile_image() to authenticated;

commit;
