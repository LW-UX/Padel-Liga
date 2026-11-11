begin;

-- Die Playtomic-Lesesitzung besteht aus einem etwa einstündigen Zugriffstoken
-- und einem Erneuerungstoken, das Playtomic bei jeder Erneuerung austauscht.
-- Der jeweils aktuelle Stand liegt ausschließlich in dieser privaten Tabelle.
-- `seed_hash` ist ein SHA-256-Fingerabdruck des Erneuerungstokens aus dem
-- Function-Secret: Wird das Secret ersetzt, verwirft die Function den alten Stand.
create table private.playtomic_session (
  singleton boolean primary key default true check (singleton),
  seed_hash text not null check (seed_hash ~ '^[0-9a-f]{64}$'),
  access_token text check (access_token ~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  refresh_token text check (refresh_token ~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  access_expires_at timestamptz,
  refresh_expires_at timestamptz,
  lease_id uuid,
  lease_until timestamptz,
  updated_at timestamptz not null default now()
);
revoke all on private.playtomic_session from public, anon, authenticated;

-- Liefert ein noch gültiges Zugriffstoken oder vergibt genau einen
-- 30-Sekunden-Erneuerungsauftrag. Parallele Aufrufe erhalten `pending`.
create function public.claim_playtomic_session(p_seed_hash text, p_lease_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  session private.playtomic_session%rowtype;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then return jsonb_build_object('state', 'none'); end if;
  if p_seed_hash !~ '^[0-9a-f]{64}$' or p_lease_id is null then return jsonb_build_object('state', 'none'); end if;
  insert into private.playtomic_session(seed_hash) values (p_seed_hash) on conflict do nothing;
  select * into session from private.playtomic_session where singleton for update;
  if session.seed_hash <> p_seed_hash then
    -- Ein neu hinterlegtes Secret ersetzt den bisherigen Stand vollständig.
    update private.playtomic_session set seed_hash = p_seed_hash, access_token = null, refresh_token = null,
      access_expires_at = null, refresh_expires_at = null, lease_id = null, lease_until = null, updated_at = now()
      where singleton returning * into session;
  end if;
  if session.access_token is not null and session.access_expires_at > now() + interval '2 minutes' then
    return jsonb_build_object('state', 'current', 'accessToken', session.access_token);
  end if;
  if session.lease_until > now() then
    return jsonb_build_object('state', 'pending');
  end if;
  update private.playtomic_session set lease_id = p_lease_id, lease_until = now() + interval '30 seconds'
    where singleton;
  -- Ohne gespeichertes Token verwendet die Function das Erneuerungstoken des Secrets.
  return jsonb_build_object('state', 'refresh', 'refreshToken', session.refresh_token);
end;
$$;

-- Speichert das Ergebnis eines Erneuerungsauftrags. Nur der aktuelle Auftrag
-- darf schreiben; ohne neue Tokens wird lediglich der Auftrag freigegeben.
create function public.finish_playtomic_session(
  p_seed_hash text, p_lease_id uuid, p_access_token text, p_refresh_token text,
  p_access_expires_at timestamptz, p_refresh_expires_at timestamptz
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then return false; end if;
  if p_access_token is null or p_refresh_token is null then
    update private.playtomic_session set lease_id = null, lease_until = null
      where singleton and seed_hash = p_seed_hash and lease_id = p_lease_id;
    return false;
  end if;
  -- Playtomic hat das bisherige Erneuerungstoken bereits verbraucht; das neue
  -- wird deshalb auch nach Ablauf der 30-Sekunden-Sperre noch gespeichert,
  -- solange kein anderer Auftrag übernommen hat.
  update private.playtomic_session set access_token = p_access_token, refresh_token = p_refresh_token,
    access_expires_at = p_access_expires_at, refresh_expires_at = p_refresh_expires_at,
    lease_id = null, lease_until = null, updated_at = now()
    where singleton and seed_hash = p_seed_hash and lease_id = p_lease_id;
  return found;
end;
$$;

-- Betriebsübersicht ohne Tokenwerte.
create function public.get_playtomic_session_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then null else (
    select jsonb_build_object('stored', session.access_token is not null,
      'accessExpiresAt', session.access_expires_at, 'refreshExpiresAt', session.refresh_expires_at,
      'updatedAt', session.updated_at)
    from private.playtomic_session as session where singleton) end;
$$;

revoke all on function public.claim_playtomic_session(text, uuid) from public, anon, authenticated;
revoke all on function public.finish_playtomic_session(text, uuid, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.get_playtomic_session_status() from public, anon, authenticated;
grant execute on function public.claim_playtomic_session(text, uuid) to service_role;
grant execute on function public.finish_playtomic_session(text, uuid, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.get_playtomic_session_status() to service_role;

commit;
