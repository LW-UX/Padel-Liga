begin;

create or replace function private.is_valid_regular_set_score(
  p_team_one integer,
  p_team_two integer
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select
    (greatest(p_team_one, p_team_two) = 6 and least(p_team_one, p_team_two) between 0 and 4)
    or (greatest(p_team_one, p_team_two) = 7 and least(p_team_one, p_team_two) in (5, 6));
$$;

create or replace function private.is_valid_tiebreak_score(
  p_team_one integer,
  p_team_two integer,
  p_target integer
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select
    (greatest(p_team_one, p_team_two) = p_target and least(p_team_one, p_team_two) between 0 and p_target - 2)
    or (greatest(p_team_one, p_team_two) > p_target and abs(p_team_one - p_team_two) = 2);
$$;

create or replace function private.derive_official_result(p_result_details text)
returns table (actual_sets text, winner smallint)
language plpgsql
immutable
set search_path = ''
as $$
declare
  score text[];
  score_count integer := 0;
  team_one_sets integer := 0;
  team_two_sets integer := 0;
  result_without_set_tiebreaks text;
begin
  result_without_set_tiebreaks := regexp_replace(coalesce(p_result_details, ''), '\([^)]*\)', '', 'g');
  for score in
    select regexp_matches(result_without_set_tiebreaks, '([0-9]+)\s*:\s*([0-9]+)', 'g')
  loop
    score_count := score_count + 1;
    if score[1]::integer = score[2]::integer then
      raise exception 'Ein Satz benötigt einen eindeutigen Sieger.';
    elsif score[1]::integer > score[2]::integer then
      team_one_sets := team_one_sets + 1;
    else
      team_two_sets := team_two_sets + 1;
    end if;
  end loop;

  if score_count = 1 then
    actual_sets := team_one_sets::text || ':' || team_two_sets::text;
    winner := case when team_one_sets = 1 then 1 else 2 end;
    return next;
    return;
  end if;
  if score_count not between 2 and 3 then
    raise exception 'Bitte zwei Sätze und bei 1:1 einen Match-Tiebreak eingeben.';
  end if;
  if greatest(team_one_sets, team_two_sets) <> 2 then
    raise exception 'Das Ergebnis benötigt zwei gewonnene Sätze für ein Team.';
  end if;
  if score_count = 3 and least(team_one_sets, team_two_sets) <> 1 then
    raise exception 'Nach einem 2:0 ist kein Match-Tiebreak mehr nötig.';
  end if;

  actual_sets := team_one_sets::text || ':' || team_two_sets::text;
  winner := case when team_one_sets = 2 then 1 else 2 end;
  return next;
end;
$$;

create or replace function private.validate_result_for_format(
  p_format text,
  p_result_details text,
  p_actual_sets text,
  p_winner smallint
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  parsed text[];
  set_one_team_one integer;
  set_one_team_two integer;
  set_two_team_one integer;
  set_two_team_two integer;
  set_one_winner smallint;
  set_two_winner smallint;
begin
  if p_format = 'single-set' then
    parsed := regexp_match(
      coalesce(p_result_details, ''),
      '^\s*([0-9]+)\s*:\s*([0-9]+)(\s*\(\s*([0-9]+)\s*:\s*([0-9]+)\s*\))?\s*$'
    );
    if parsed is null then
      raise exception 'Eine Ein-Satz-Partie benötigt genau einen Satz.';
    end if;

    set_one_team_one := parsed[1]::integer;
    set_one_team_two := parsed[2]::integer;
    if not private.is_valid_regular_set_score(set_one_team_one, set_one_team_two) then
      raise exception 'Ungültiger Satzendstand.';
    end if;
    set_one_winner := case when set_one_team_one > set_one_team_two then 1 else 2 end;

    if greatest(set_one_team_one, set_one_team_two) = 7 and least(set_one_team_one, set_one_team_two) = 6 then
      if parsed[3] is null then raise exception 'Bei 7:6 oder 6:7 fehlt der Satz-Tiebreak.'; end if;
      if not private.is_valid_tiebreak_score(parsed[4]::integer, parsed[5]::integer, 7) then
        raise exception 'Ungültiger Satz-Tiebreak.';
      end if;
      if (parsed[4]::integer > parsed[5]::integer) is distinct from (set_one_winner = 1) then
        raise exception 'Satz- und Tiebreak-Sieger stimmen nicht überein.';
      end if;
    elsif parsed[3] is not null then
      raise exception 'Ein Satz-Tiebreak ist nur bei 7:6 oder 6:7 zulässig.';
    end if;
  elsif p_format = 'best-of-three' then
    parsed := regexp_match(
      coalesce(p_result_details, ''),
      '^\s*([0-9]+)\s*:\s*([0-9]+)(\s*\(\s*([0-9]+)\s*:\s*([0-9]+)\s*\))?\s*,\s*([0-9]+)\s*:\s*([0-9]+)(\s*\(\s*([0-9]+)\s*:\s*([0-9]+)\s*\))?(\s*[-–]\s*([0-9]+)\s*:\s*([0-9]+))?\s*$'
    );
    if parsed is null then
      raise exception 'Diese Partie benötigt zwei Sätze und bei 1:1 einen Match-Tiebreak.';
    end if;

    set_one_team_one := parsed[1]::integer;
    set_one_team_two := parsed[2]::integer;
    set_two_team_one := parsed[6]::integer;
    set_two_team_two := parsed[7]::integer;
    if not private.is_valid_regular_set_score(set_one_team_one, set_one_team_two)
      or not private.is_valid_regular_set_score(set_two_team_one, set_two_team_two) then
      raise exception 'Ungültiger Satzendstand.';
    end if;
    set_one_winner := case when set_one_team_one > set_one_team_two then 1 else 2 end;
    set_two_winner := case when set_two_team_one > set_two_team_two then 1 else 2 end;

    if greatest(set_one_team_one, set_one_team_two) = 7 and least(set_one_team_one, set_one_team_two) = 6 then
      if parsed[3] is null then raise exception 'In Satz 1 fehlt der Satz-Tiebreak.'; end if;
      if not private.is_valid_tiebreak_score(parsed[4]::integer, parsed[5]::integer, 7) then
        raise exception 'Ungültiger Satz-Tiebreak in Satz 1.';
      end if;
      if (parsed[4]::integer > parsed[5]::integer) is distinct from (set_one_winner = 1) then
        raise exception 'Satz- und Tiebreak-Sieger stimmen in Satz 1 nicht überein.';
      end if;
    elsif parsed[3] is not null then
      raise exception 'Ein Satz-Tiebreak ist in Satz 1 nur bei 7:6 oder 6:7 zulässig.';
    end if;

    if greatest(set_two_team_one, set_two_team_two) = 7 and least(set_two_team_one, set_two_team_two) = 6 then
      if parsed[8] is null then raise exception 'In Satz 2 fehlt der Satz-Tiebreak.'; end if;
      if not private.is_valid_tiebreak_score(parsed[9]::integer, parsed[10]::integer, 7) then
        raise exception 'Ungültiger Satz-Tiebreak in Satz 2.';
      end if;
      if (parsed[9]::integer > parsed[10]::integer) is distinct from (set_two_winner = 1) then
        raise exception 'Satz- und Tiebreak-Sieger stimmen in Satz 2 nicht überein.';
      end if;
    elsif parsed[8] is not null then
      raise exception 'Ein Satz-Tiebreak ist in Satz 2 nur bei 7:6 oder 6:7 zulässig.';
    end if;

    if set_one_winner <> set_two_winner then
      if parsed[11] is null then raise exception 'Bei 1:1 fehlt der Match-Tiebreak.'; end if;
      if not private.is_valid_tiebreak_score(parsed[12]::integer, parsed[13]::integer, 10) then
        raise exception 'Ungültiger Match-Tiebreak.';
      end if;
    elsif parsed[11] is not null then
      raise exception 'Nach einem 2:0 ist kein Match-Tiebreak zulässig.';
    end if;
  else
    raise exception 'Unbekanntes Ergebnisformat.';
  end if;

  perform private.validate_official_result(p_result_details, p_actual_sets, p_winner);
end;
$$;

commit;
