begin;

-- Tabellenführung und Qualifikationsgrenze sind erst aussagekräftig, wenn genug
-- Spieler der Liga vor dieser Partie mindestens zwei gewertete Partien haben:
-- zehn Spieler, in kleineren Ligen alle Teilnehmer. Serien und Elo-Höchstwerte
-- bleiben unverändert. Ansonsten entspricht die Funktion dem produktiven Stand
-- aus `20261021150000_test_season_preview_window.sql`.
CREATE OR REPLACE FUNCTION private.get_public_match_detail_without_qualification_places(p_match_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m public.matches; s public.seasons; member record; h record;
  completed boolean; test_mode boolean; mode text; cutoff timestamptz; cutoff_id text; today date := (now() at time zone 'Europe/Berlin')::date;
  active_stage text; ids text[]; team_one text[]; team_two text[];
  players jsonb := '[]'; player jsonb; elo jsonb; before_streak jsonb; after_streak jsonb;
  table_before jsonb; table_after jsonb; table_win_one jsonb; table_win_two jsonb; previous jsonb; current_stats jsonb; scenario jsonb;
  impacts jsonb := '[]'; rematches jsonb := '[]'; company_info jsonb := null;
  expected numeric; factor_min numeric; factor_max numeric; old_elo numeric; opponent_elo numeric[];
  team_one_elo numeric[]; team_two_elo numeric[]; probability numeric;
  company_one text; company_two text; company_wins_one integer; company_wins_two integer;
  streak_length integer; before_length integer; peak numeric; change_kind text; ranking_ready boolean := false;
begin
  select * into m from public.matches where id=p_match_id;
  if not found then return null; end if;
  select * into s from public.seasons where id=m.season_id;
  test_mode := not s.counts_for_profile and s.id in ('test-2026', '2026-test');
  if (not s.counts_for_profile and not test_mode) or m.cancelled_at is not null or m.match_type not in ('season','final')
    or m.competition_stage='final_four' then return null; end if;
  select array_agg(mp.player_id order by mp.team,mp.position),
    array_agg(mp.player_id order by mp.position) filter(where mp.team=1),
    array_agg(mp.player_id order by mp.position) filter(where mp.team=2)
  into ids,team_one,team_two from public.match_players mp where mp.match_id=m.id;
  if coalesce(cardinality(team_one),0)<>2 or coalesce(cardinality(team_two),0)<>2 then return null; end if;
  completed := m.winner is not null and m.actual_sets is not null;
  if not completed and not m.counts_for_elo then return null; end if;
  if m.competition_stage='semifinal' and s.tournament_mode<>'knockout_redraw' and exists (
    select 1 from public.matches lm where lm.season_id=m.season_id and lm.competition_stage='league'
      and lm.cancelled_at is null and (lm.winner is null or lm.actual_sets is null)
  ) then return null; end if;
  cutoff := case when completed then m.match_at else now() end;
  cutoff_id := case when completed or test_mode then m.id else chr(65535) end;
  if cutoff is null then return null; end if;
  mode := case when completed then 'analysis' else 'basic' end;
  if not completed then
    select x.competition_stage into active_stage from public.matches x
      where x.season_id=m.season_id and x.cancelled_at is null and x.winner is null
      order by case x.competition_stage when 'quarterfinal' then 1 when 'semifinal' then 2 when 'final' then 3 else 0 end limit 1;
    if m.match_at is not null or m.competition_stage='semifinal' and s.tournament_mode<>'knockout_redraw'
      or s.tournament_mode='knockout_redraw' and m.competition_stage=active_stage
      or (s.tournament_mode<>'knockout_redraw' and (
        exists(select 1 from public.season_matchdays d where d.season_id=m.season_id and d.matchday=m.matchday and d.ends_on<today)
        or m.matchday in (select d.matchday from public.season_matchdays d where d.season_id=m.season_id and d.ends_on>=today order by d.starts_on,d.matchday limit 2)
      ))
    then mode := 'preview'; end if;
  end if;
  if mode<>'basic' then
    table_before := private.match_detail_table(m.season_id,cutoff,cutoff_id,false);
    table_after := case when completed then private.match_detail_table(m.season_id,cutoff,cutoff_id,true) else table_before end;
    if not completed and m.competition_stage='league' then
      table_win_one := private.match_detail_table(m.season_id,cutoff,cutoff_id,false,m.id,1);
      table_win_two := private.match_detail_table(m.season_id,cutoff,cutoff_id,false,m.id,2);
    end if;
    select count(*) filter(where (t.value->>'played')::integer>=2)>=least(10,count(*)) into ranking_ready
      from jsonb_each(table_before) t join public.season_players sp
        on sp.season_id=m.season_id and sp.player_id=t.key and sp.league_id=m.league_id;
  end if;
  for member in select mp.*,p.display_name from public.match_players mp join public.players p on p.id=mp.player_id
    where mp.match_id=m.id order by mp.team,mp.position
  loop
    elo := case when m.counts_for_elo then private.match_detail_elo(member.player_id,m.season_id,cutoff,cutoff_id,completed) else null end;
    player := jsonb_build_object('playerId',member.player_id,'displayName',member.display_name,'team',member.team,'elo',elo);
    if mode<>'basic' then
      before_streak := private.match_detail_streak(member.player_id,cutoff,cutoff_id,false);
      after_streak := case when completed then private.match_detail_streak(member.player_id,cutoff,cutoff_id,true) else before_streak end;
      current_stats := table_after->member.player_id;
      if s.tournament_mode='knockout_redraw' then
        select jsonb_build_object('played',count(*),'wins',count(*) filter(where outcome='win'),
          'gameDiff',coalesce(sum((private.profile_regular_game_totals(result_details))[team]-(private.profile_regular_game_totals(result_details))[3-team]),0))
        into current_stats from private.match_detail_history(array[member.player_id],cutoff,cutoff_id,completed) where season_id=m.season_id;
      end if;
      player := player || jsonb_build_object('statistics',current_stats,'streak',after_streak,
        'relationships',private.match_detail_relationships(member.player_id,(select mp.player_id from public.match_players mp where mp.match_id=m.id and mp.team=member.team and mp.player_id<>member.player_id),ids,cutoff,cutoff_id,completed));
      before_length := (before_streak->>'length')::integer; streak_length := (after_streak->>'length')::integer;
      if completed then
        if before_length>=3 and before_streak->>'outcome'<>after_streak->>'outcome' then
          impacts := impacts || jsonb_build_object('kind','streakEnded','playerId',member.player_id,'outcome',before_streak->>'outcome','length',before_length);
        end if;
        if streak_length>=3 then
          impacts := impacts || jsonb_build_object('kind',case when streak_length=3 then 'streakStarted' else 'streakExtended' end,
            'playerId',member.player_id,'outcome',after_streak->>'outcome','length',streak_length);
        end if;
      elsif streak_length>=2 then
        impacts := impacts || jsonb_build_object('kind','streakPossible','playerId',member.player_id,'outcome',after_streak->>'outcome','length',streak_length);
      end if;
      if m.competition_stage='league' and m.counts_for_ranking and ranking_ready then
        previous := table_before->member.player_id;
        if completed then
          if (previous->>'soleLeader')::boolean is distinct from (current_stats->>'soleLeader')::boolean then
            impacts := impacts || jsonb_build_object('kind',case when (current_stats->>'soleLeader')::boolean then 'leaderGained' else 'leaderLost' end,'playerId',member.player_id);
          end if;
          if s.qualification_places>0 and ((previous->>'rank')::integer<=s.qualification_places) is distinct from ((current_stats->>'rank')::integer<=s.qualification_places) then
            impacts := impacts || jsonb_build_object('kind',case when (current_stats->>'rank')::integer<=s.qualification_places then 'qualificationGained' else 'qualificationLost' end,'playerId',member.player_id,'places',s.qualification_places);
          end if;
        else
          for h in select v.winner,v.t from (values (1,table_win_one),(2,table_win_two)) v(winner,t) loop
            scenario := h.t->member.player_id;
            change_kind := null;
            if not (previous->>'soleLeader')::boolean and (scenario->>'soleLeader')::boolean then change_kind:='leaderPossible';
            elsif (previous->>'soleLeader')::boolean and not (scenario->>'soleLeader')::boolean then change_kind:='leaderLossPossible'; end if;
            if change_kind is not null then impacts:=impacts||jsonb_build_object('kind',change_kind,'playerId',member.player_id,'onWin',member.team=h.winner); end if;
            if s.qualification_places>0 and ((previous->>'rank')::integer<=s.qualification_places) is distinct from ((scenario->>'rank')::integer<=s.qualification_places) then
              impacts:=impacts||jsonb_build_object('kind',case when (scenario->>'rank')::integer<=s.qualification_places then 'qualificationPossible' else 'qualificationLossPossible' end,
                'playerId',member.player_id,'places',s.qualification_places,'onWin',member.team=h.winner);
            end if;
          end loop;
        end if;
      end if;
    end if;
    players := players || player;
  end loop;
  select array_agg((p->'elo'->>'before')::numeric order by n) filter(where (p->>'team')::integer=1),
    array_agg((p->'elo'->>'before')::numeric order by n) filter(where (p->>'team')::integer=2)
    into team_one_elo,team_two_elo from jsonb_array_elements(players) with ordinality q(p,n);
  if m.counts_for_elo and array_position(team_one_elo,null) is null and array_position(team_two_elo,null) is null then
    probability := 1/(1+power(10::numeric,((least(team_two_elo[1],team_two_elo[2])*0.7+greatest(team_two_elo[1],team_two_elo[2])*0.3)
      -(least(team_one_elo[1],team_one_elo[2])*0.7+greatest(team_one_elo[1],team_one_elo[2])*0.3))/500));
  end if;
  if mode<>'basic' and m.counts_for_elo then
    factor_min:=power(log(10::numeric,(case when m.format='single-set' then 1 else 0.6 end)+1),3)+2;
    factor_max:=power(log(10::numeric,(case when m.format='single-set' then 6 else 12 end)+1),3)+2;
    for player in select value from jsonb_array_elements(players) loop
      elo:=player->'elo'; old_elo:=(elo->>'before')::numeric; peak:=(elo->>'peakBefore')::numeric;
      if not completed and old_elo is not null then
        opponent_elo:=case when (player->>'team')::integer=1 then team_two_elo else team_one_elo end;
        expected:=(1/(1+power(10::numeric,(opponent_elo[1]-old_elo)/500))+1/(1+power(10::numeric,(opponent_elo[2]-old_elo)/500)))/2;
        elo:=elo||jsonb_build_object('winMin',round(old_elo+factor_min*50*(1-expected)),'winMax',round(old_elo+factor_max*50*(1-expected)),
          'lossMin',round(old_elo-factor_max*50*expected),'lossMax',round(old_elo-factor_min*50*expected));
        players:=jsonb_set(players,array[(array_position(ids,player->>'playerId')-1)::text,'elo'],elo);
      end if;
      if (completed and (elo->>'after')::numeric>peak) or (not completed and (elo->>'winMax')::numeric>peak) then
        impacts:=impacts||jsonb_build_object('kind',case when completed then 'eloPeak' else 'eloPeakPossible' end,'playerId',player->>'playerId');
      end if;
    end loop;
  end if;
  if mode<>'basic' then
    select coalesce(jsonb_agg(jsonb_build_object('id',event_id,'date',event_at,'season',season_label,'result',result_details,'team',team,'outcome',outcome)
      order by event_at desc,event_id desc),'[]') into rematches
    from private.match_detail_history(array[team_one[1]],cutoff,cutoff_id,false)
    where complete and cardinality(partner_ids)=1 and partner_ids @> array[team_one[2]] and opponent_ids @> team_two and cardinality(opponent_ids)=2;
    if test_mode then
      company_info:=jsonb_build_object('kind','internal','company','Testbetrieb');
    else
      select case when count(distinct p.company)=1 and count(p.company)=2 then min(p.company) end into company_one from public.players p where p.id=any(team_one);
      select case when count(distinct p.company)=1 and count(p.company)=2 then min(p.company) end into company_two from public.players p where p.id=any(team_two);
      if company_one is not null and company_two is not null then
        if company_one=company_two then company_info:=jsonb_build_object('kind','internal','company',company_one);
        else
          with duels as (
            select x.id,x.winner,
              min(p.company) filter(where mp.team=1) one,min(p.company) filter(where mp.team=2) two
            from public.matches x join public.seasons xs on xs.id=x.season_id and xs.counts_for_profile
            join public.match_players mp on mp.match_id=x.id join public.players p on p.id=mp.player_id
            where x.cancelled_at is null and x.winner is not null and x.actual_sets is not null
              and ((x.match_at,x.id)<(cutoff,cutoff_id) or (completed and (x.match_at,x.id)=(cutoff,cutoff_id)))
            group by x.id,x.winner having count(p.company)=4 and count(*) filter(where mp.team=1)=2 and count(*) filter(where mp.team=2)=2
              and count(distinct p.company) filter(where mp.team=1)=1 and count(distinct p.company) filter(where mp.team=2)=1
          ) select count(*) filter(where case when winner=1 then one else two end=company_one),
            count(*) filter(where case when winner=1 then one else two end=company_two)
            into company_wins_one,company_wins_two from duels where (one=company_one and two=company_two) or (one=company_two and two=company_one);
          company_info:=jsonb_build_object('kind','duel','team1',company_one,'team2',company_two,'wins1',company_wins_one,'wins2',company_wins_two);
        end if;
      end if;
    end if;
    if completed and probability is not null then
      impacts:=impacts||coalesce(private.match_detail_result_impact(m.winner,probability),'[]'::jsonb);
    end if;
  end if;
  return jsonb_build_object('availability',mode,'generatedAt',now(),'matchId',m.id,'seasonId',s.id,'seasonLabel',s.label,
    'label',coalesce(m.display_label,'Partie '||coalesce(substring(m.id from '([0-9]+)$'),m.matchday::text)),'stage',m.competition_stage,'matchAt',m.match_at,
    'result',m.result_details,'sets',m.actual_sets,'winner',m.winner,'countsForElo',m.counts_for_elo,
    'probability',probability,'players',players,'rematches',rematches,'company',company_info,'impacts',impacts);
end;
$function$;

notify pgrst, 'reload schema';
commit;
