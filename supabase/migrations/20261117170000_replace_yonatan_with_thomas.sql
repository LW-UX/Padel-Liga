begin;

-- A new person receives a new identity; never transfer authentication or a photo.
do $$
declare
  source_player public.players%rowtype;
  winter_id text;
  reference record;
  has_reference boolean;
  affected integer;
begin
  select * into strict source_player from public.players where id = 'yonatan_g' for update;
  select season_id into strict winter_id from public.season_players where player_id = source_player.id;
  if winter_id not in ('winter-2026', '2026-winter') or source_player.initial_elo <> 550 then
    raise exception 'Unerwartete Saison oder Ausgangs-Elo; Spielerwechsel erneut prüfen.';
  end if;
  if exists (select 1 from public.players where id = 'thomas_h')
     or exists (select 1 from auth.users where lower(trim(email)) = 'thomas.haefeker@envidual.com')
     or exists (select 1 from private.player_email_allowlist where email_hash = extensions.digest('thomas.haefeker@envidual.com', 'sha256')) then
    raise exception 'Thomas besitzt bereits ein Profil oder eine Zuordnung; erneut prüfen.';
  end if;
  if (select count(*) from public.match_players where player_id = source_player.id) <> 6
     or exists (
       select 1 from public.match_players mp join public.matches m on m.id = mp.match_id
       where mp.player_id = source_player.id
         and (m.season_id <> winter_id or m.actual_sets is not null or m.cancelled_at is not null)
     ) or exists (
       select 1 from public.result_proposals rp join public.match_players mp on mp.match_id = rp.match_id
       where mp.player_id = source_player.id
     ) then
    raise exception 'Die sechs offenen Partien entsprechen nicht mehr dem geprüften Stand.';
  end if;
  if exists (select 1 from public.season_players where player_id = source_player.id and (start_elo <> 550 or end_elo is not null))
     or exists (select 1 from public.profiles where player_id = source_player.id and app_role <> 'player') then
    raise exception 'Elo oder Kontorolle entsprechen nicht dem geprüften Stand.';
  end if;

  -- Reject any sporting history, including newly added references with cascading deletes.
  for reference in
    select ns.nspname as schema_name, cl.relname as table_name, att.attname as column_name
    from pg_constraint fk
    join pg_class cl on cl.oid = fk.conrelid
    join pg_namespace ns on ns.oid = cl.relnamespace
    join pg_attribute att on att.attrelid = cl.oid and att.attnum = fk.conkey[1]
    where fk.contype = 'f' and fk.confrelid = 'public.players'::regclass
      and not (ns.nspname = 'public' and cl.relname in ('season_players', 'match_players', 'profiles'))
      and not (ns.nspname = 'private' and cl.relname = 'player_email_allowlist')
  loop
    execute format('select exists (select 1 from %I.%I where %I = $1)', reference.schema_name, reference.table_name, reference.column_name)
      into has_reference using source_player.id;
    if has_reference then
      raise exception 'Weitere Spielerdaten in %.%; Spielerwechsel erneut prüfen.', reference.schema_name, reference.table_name;
    end if;
  end loop;

  insert into public.players (id, display_name, initials, company, initial_elo)
  values ('thomas_h', 'Thomas H.', 'TH', 'Envidual', source_player.initial_elo);

  update public.season_players set player_id = 'thomas_h' where player_id = source_player.id;
  update public.matches m
  set team_one_label = replace(m.team_one_label, source_player.display_name, 'Thomas H.'),
      team_two_label = replace(m.team_two_label, source_player.display_name, 'Thomas H.')
  where exists (select 1 from public.match_players mp where mp.match_id = m.id and mp.player_id = source_player.id);
  update public.match_players set player_id = 'thomas_h' where player_id = source_player.id;
  get diagnostics affected = row_count;
  if affected <> 6 then raise exception 'Es wurden nicht genau sechs Partieplätze übertragen.'; end if;

  -- Retain the separate old account, without player permissions or access to Thomas's tasks.
  update public.profiles set player_id = null, app_role = 'tipper' where player_id = source_player.id;
  delete from private.player_email_allowlist where player_id = source_player.id;
  insert into private.player_email_allowlist (email_hash, player_id, app_role)
  values (extensions.digest('thomas.haefeker@envidual.com', 'sha256'), 'thomas_h', 'player');
  delete from public.players where id = source_player.id;

  if (select count(*) from public.season_players where season_id = winter_id) <> 20
     or not exists (select 1 from public.season_players where player_id = 'thomas_h' and start_elo = 550)
     or exists (select 1 from public.matches where team_one_label like '%Yonatan G.%' or team_two_label like '%Yonatan G.%') then
    raise exception 'Abschlussprüfung des Spielerwechsels fehlgeschlagen.';
  end if;
end;
$$;

commit;
