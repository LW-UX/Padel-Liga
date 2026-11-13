begin;

-- Append-only revisions; browser roles can only use the checked RPCs.
create table private.league_match_history (
  match_id text not null references public.matches(id) on delete cascade,
  version integer not null check (version > 0),
  sections jsonb not null,
  result_snapshot text not null,
  players_snapshot jsonb not null,
  reason text not null check (char_length(trim(reason)) between 3 and 500),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (match_id, version)
);
revoke all on private.league_match_history from public, anon, authenticated;
alter table private.league_match_history enable row level security;

create function private.validate_history_sequence(p_winners jsonb, p_one integer, p_two integer, p_target integer)
returns void language plpgsql immutable set search_path = '' as $$
declare item jsonb; a integer := 0; b integer := 0;
begin
  if jsonb_typeof(p_winners) is distinct from 'array' then raise exception 'Ungültiger Verlauf.'; end if;
  if jsonb_array_length(p_winners) > 1000 then raise exception 'Der Verlauf ist zu lang.'; end if;
  for item in select value from jsonb_array_elements(p_winners) loop
    if item not in ('1'::jsonb, '2'::jsonb) then raise exception 'Ungültiger Gewinn.'; end if;
    if (p_target is not null and greatest(a,b) >= p_target and abs(a-b) >= 2)
      or (p_target is null and ((greatest(a,b) >= 6 and abs(a-b) >= 2) or greatest(a,b) = 7)) then
      raise exception 'Der Verlauf geht über das Satzende hinaus.';
    end if;
    if item = '1'::jsonb then a := a+1; else b := b+1; end if;
    if a > p_one or b > p_two then raise exception 'Der Verlauf passt nicht zum bestätigten Ergebnis.'; end if;
  end loop;
  if a <> p_one or b <> p_two then raise exception 'Der Verlauf muss dem bestätigten Endstand entsprechen.'; end if;
end;
$$;
revoke all on function private.validate_history_sequence(jsonb,integer,integer,integer) from public, anon, authenticated;

create function public.admin_save_match_history(p_match_id text, p_sections jsonb, p_reason text, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.matches; parts text[]; parsed text[]; part jsonb; server jsonb;
  i integer; game integer; last_version integer; player_snapshot jsonb;
begin
  if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id
      where p.id=(select auth.uid()) and p.app_role='admin' and u.email_confirmed_at is not null) then
    raise exception 'Nur bestätigte Admins dürfen Spielverläufe nachtragen.';
  end if;
  if char_length(trim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'Bitte einen Grund mit 3 bis 500 Zeichen angeben.'; end if;
  -- Serialize revisions and result changes on the same match row.
  select * into m from public.matches where id=p_match_id for update;
  if m.id is null or m.competition_stage is distinct from 'league' or m.match_type <> 'season'
    or m.cancelled_at is not null or m.winner is null or m.actual_sets is null then
    raise exception 'Nur bestätigte Ligapartien können einen nachgetragenen Verlauf erhalten.';
  end if;
  if public.get_public_match_detail(p_match_id) is null then raise exception 'Diese Partie ist nicht verfügbar.'; end if;
  perform private.validate_result_for_format(m.format, m.result_details, m.actual_sets, m.winner);
  select coalesce(max(version),0) into last_version from private.league_match_history where match_id=m.id;
  if p_expected_version is distinct from last_version then raise exception 'Der Verlauf wurde inzwischen geändert. Bitte die Partie neu öffnen.'; end if;
  parts := regexp_split_to_array(trim(m.result_details), '\s*[,–-]\s*');
  if jsonb_typeof(p_sections) is distinct from 'array' then raise exception 'Ungültiger Verlauf.'; end if;
  if jsonb_array_length(p_sections) <> cardinality(parts) then raise exception 'Der Verlauf muss alle Sätze enthalten.'; end if;
  for i in 1..cardinality(parts) loop
    parsed := regexp_match(parts[i], '^(\d+)\s*:\s*(\d+)(?:\s*\(\s*(\d+)\s*:\s*(\d+)\s*\))?$');
    if parsed is null then raise exception 'Das bestätigte Ergebnis kann nicht gelesen werden.'; end if;
    part := p_sections->(i-1);
    perform private.validate_history_sequence(part->'winners', parsed[1]::integer, parsed[2]::integer, case when i=3 then 10 end);
    if jsonb_typeof(part->'servers') is distinct from 'array' or jsonb_typeof(part->'points') is distinct from 'array' then
      raise exception 'Ungültige Aufschläger oder Tiebreak-Punkte.';
    end if;
    if jsonb_array_length(part->'servers') <> jsonb_array_length(part->'winners') then raise exception 'Ungültige Aufschlägerzuordnung.'; end if;
    game := 0;
    for server in select value from jsonb_array_elements(part->'servers') loop
      game := game+1;
      if server <> 'null'::jsonb then
        if jsonb_typeof(server) <> 'string' or i=3 or (parsed[3] is not null and game=13)
          or not exists(select 1 from public.match_players mp where mp.match_id=m.id and mp.player_id=server#>>'{}') then
          raise exception 'Ungültiger Aufschläger.';
        end if;
      end if;
    end loop;
    if jsonb_array_length(part->'points') > 0 then
      if parsed[3] is null then raise exception 'Dieser Satz hat keinen Satz-Tiebreak.'; end if;
      perform private.validate_history_sequence(part->'points',parsed[3]::integer,parsed[4]::integer,7);
    end if;
  end loop;
  select jsonb_agg(jsonb_build_array(player_id,team,position) order by team,position) into player_snapshot
    from public.match_players where match_id=m.id;
  insert into private.league_match_history(match_id,version,sections,result_snapshot,players_snapshot,reason,created_by)
    values(m.id,last_version+1,p_sections,m.result_details,player_snapshot,trim(p_reason),(select auth.uid()));
  return jsonb_build_object('sections',p_sections,'version',last_version+1);
end;
$$;
revoke all on function public.admin_save_match_history(text,jsonb,text,integer) from public, anon;
grant execute on function public.admin_save_match_history(text,jsonb,text,integer) to authenticated;

alter function public.get_public_match_detail(text) rename to get_public_match_detail_without_game_history;
alter function public.get_public_match_detail_without_game_history(text) set schema private;
revoke all on function private.get_public_match_detail_without_game_history(text) from public, anon, authenticated;

create function public.get_public_match_detail(p_match_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare detail jsonb; h private.league_match_history; players jsonb;
begin
  detail := private.get_public_match_detail_without_game_history(p_match_id);
  if detail is null or detail->>'availability' <> 'analysis' or detail->>'stage' <> 'league' then return detail; end if;
  select * into h from private.league_match_history where match_id=p_match_id order by version desc limit 1;
  select jsonb_agg(jsonb_build_array(player_id,team,position) order by team,position) into players
    from public.match_players where match_id=p_match_id;
  return detail || jsonb_build_object('historyVersion',coalesce(h.version,0),'matchHistory',case
    when h.result_snapshot=detail->>'result' and h.players_snapshot=players then jsonb_build_object('sections',h.sections,'version',h.version)
    else null end);
end;
$$;
revoke all on function public.get_public_match_detail(text) from public;
grant execute on function public.get_public_match_detail(text) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
