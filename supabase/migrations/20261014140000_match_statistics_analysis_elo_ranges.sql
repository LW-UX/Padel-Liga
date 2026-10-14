begin;

-- Completed match details retain the win/loss ranges that were possible from
-- the historical pre-match Elo values. The client renders these ranges as a
-- quiet comparison behind the actual Elo change.
create function private.match_detail_add_analysis_elo_ranges(p_detail jsonb, p_format text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  players jsonb;
  player jsonb;
  opponent jsonb;
  player_index integer;
  old_elo numeric;
  opponent_elo numeric;
  expected numeric;
  opponent_count integer;
  factor_min numeric;
  factor_max numeric;
  elo jsonb;
begin
  if p_detail is null
    or p_detail ->> 'availability' <> 'analysis'
    or not coalesce((p_detail ->> 'countsForElo')::boolean, false)
    or jsonb_typeof(p_detail -> 'players') <> 'array'
  then
    return p_detail;
  end if;

  players := p_detail -> 'players';
  factor_min := power(log(10::numeric, (case when p_format='single-set' then 1 else 0.6 end) + 1), 3) + 2;
  factor_max := power(log(10::numeric, (case when p_format='single-set' then 6 else 12 end) + 1), 3) + 2;

  for player_index in 0..jsonb_array_length(players)-1 loop
    player := players -> player_index;
    old_elo := (player -> 'elo' ->> 'before')::numeric;
    if old_elo is null then continue; end if;

    expected := 0;
    opponent_count := 0;
    for opponent in
      select value
      from jsonb_array_elements(players)
      where (value ->> 'team')::integer <> (player ->> 'team')::integer
    loop
      opponent_elo := (opponent -> 'elo' ->> 'before')::numeric;
      if opponent_elo is null then
        expected := null;
        exit;
      end if;
      expected := expected + 1 / (1 + power(10::numeric, (opponent_elo-old_elo)/500));
      opponent_count := opponent_count + 1;
    end loop;

    if expected is null or opponent_count <> 2 then continue; end if;
    expected := expected / opponent_count;
    elo := player -> 'elo' || jsonb_build_object(
      'winMin', round(old_elo + factor_min*50*(1-expected)),
      'winMax', round(old_elo + factor_max*50*(1-expected)),
      'lossMin', round(old_elo - factor_max*50*expected),
      'lossMax', round(old_elo - factor_min*50*expected)
    );
    players := jsonb_set(players, array[player_index::text, 'elo'], elo, false);
  end loop;

  return jsonb_set(p_detail, '{players}', players, false);
end;
$$;

revoke all on function private.match_detail_add_analysis_elo_ranges(jsonb,text)
  from public, anon, authenticated;

alter function public.get_public_match_detail(text)
  rename to get_public_match_detail_without_analysis_elo_ranges;

alter function public.get_public_match_detail_without_analysis_elo_ranges(text)
  set schema private;

revoke all on function private.get_public_match_detail_without_analysis_elo_ranges(text)
  from public, anon, authenticated;

create function public.get_public_match_detail(p_match_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.match_detail_add_analysis_elo_ranges(detail.value, match.format)
  from (
    select private.get_public_match_detail_without_analysis_elo_ranges(p_match_id) as value
  ) detail
  left join public.matches match on match.id = p_match_id;
$$;

revoke all on function public.get_public_match_detail(text) from public;
grant execute on function public.get_public_match_detail(text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
