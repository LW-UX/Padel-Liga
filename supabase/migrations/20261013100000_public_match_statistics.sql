begin;

-- A read-only, match-scoped history. Identities use IDs, never display names.
create or replace function private.match_detail_history(p_players text[], p_at timestamptz, p_id text, p_include boolean)
returns table (
  player_id text, event_id text, event_at timestamptz, kind text, season_id text,
  season_label text, team integer, partner_ids text[], opponent_ids text[],
  result_details text, outcome text, complete boolean, weight numeric, wins numeric
)
language sql stable set search_path = '' as $$
  select mp.player_id, m.id, m.match_at,
    case when m.competition_stage = 'final_four' then 'final-four' else 'official' end,
    m.season_id, s.label, mp.team::integer,
    array(select p.player_id from public.match_players p where p.match_id=m.id and p.team=mp.team and p.player_id<>mp.player_id order by p.position),
    array(select p.player_id from public.match_players p where p.match_id=m.id and p.team<>mp.team order by p.position),
    m.result_details, case when m.winner=mp.team then 'win' else 'loss' end, true,
    case when m.competition_stage='final_four' then 0.5 else 1 end::numeric,
    case when m.winner<>mp.team then 0 when m.competition_stage='final_four' then 0.5 else 1 end::numeric
  from public.match_players mp join public.matches m on m.id=mp.match_id
  join public.seasons s on s.id=m.season_id and s.counts_for_profile
  where mp.player_id=any(p_players) and m.cancelled_at is null
    and m.actual_sets is not null and m.winner is not null and m.match_type in ('season','final')
    and ((m.match_at,m.id)<(p_at,p_id) or (p_include and (m.match_at,m.id)=(p_at,p_id)))
  union all
  select pid, 'training-'||t.id||'-'||r.round_number,
    (t.played_on + coalesce(t.display_time, time '00:00')) at time zone 'Europe/Berlin',
    'training', null, 'Training', case when pid=any(r.team_one_ids) then 1 else 2 end,
    array(select v from unnest(case when pid=any(r.team_one_ids) then r.team_one_ids else r.team_two_ids end) v where v<>pid),
    case when pid=any(r.team_one_ids) then r.team_two_ids else r.team_one_ids end,
    r.result_details,
    case when metrics[2]=metrics[3] then 'draw'
      when (pid=any(r.team_one_ids))=(metrics[2]>metrics[3]) then 'win' else 'loss' end,
    r.is_complete, metrics[1]*0.5,
    (case when pid=any(r.team_one_ids) then metrics[2] else metrics[3] end)*0.5
  from public.training_sessions t join public.training_rounds r on r.session_id=t.id
  cross join lateral unnest(t.player_ids) pid
  cross join lateral (select private.profile_training_metrics(r.result_details) metrics) x
  where t.status='confirmed' and pid=any(p_players) and metrics[1]>0
    -- Training has no shared match ID; simultaneous training is not earlier history.
    and (t.played_on + coalesce(t.display_time,time '00:00')) at time zone 'Europe/Berlin' < p_at;
$$;

create or replace function private.match_detail_relationships(p_player text, p_partner text, p_others text[], p_at timestamptz, p_id text, p_include boolean)
returns jsonb language sql stable set search_path = '' as $$
  with history as materialized (
    select * from private.match_detail_history(array[p_player],p_at,p_id,p_include)
  ), totals as (
    select relation, other_id, sum(weight) games, sum(wins) wins
    from history cross join lateral (
      select 'partner'::text relation, unnest(partner_ids) other_id
      union all select 'opponent', unnest(opponent_ids)
    ) r group by relation, other_id having sum(weight)>=3
  ), rates as (
    select *, wins/games rate from totals
  ), leaders as (
    select *, max(rate) over(partition by relation) best, min(rate) over(partition by relation) worst from rates
  ) select coalesce(jsonb_agg(jsonb_build_object(
    'kind', case when relation='partner' and rate>0.5 then 'successPartner'
      when relation='partner' then 'fearedPartner' when rate>0.5 then 'favoriteOpponent' else 'fearedOpponent' end,
    'playerId',other_id,'name',p.display_name,'matches',games,'wins',wins
  ) order by relation, other_id), '[]'::jsonb)
  from leaders join public.players p on p.id=other_id
  where ((relation='partner' and other_id=p_partner) or (relation='opponent' and other_id=any(p_others) and other_id<>p_partner))
    and ((rate>0.5 and rate=best) or (rate<0.5 and rate=worst));
$$;

create or replace function private.match_detail_streak(p_player text, p_at timestamptz, p_id text, p_include boolean)
returns jsonb language sql stable set search_path = '' as $$
  with history as (
    select outcome, row_number() over(order by event_at desc,event_id desc) n
    from private.match_detail_history(array[p_player],p_at,p_id,p_include) where kind<>'training'
  ), first_result as (select outcome from history where n=1)
  select jsonb_build_object('outcome',(select outcome from first_result),'length',count(*))
  from history where n<coalesce((select min(h.n) from history h where h.outcome<>(select outcome from first_result)),2147483647);
$$;

-- Only this match is simulated; every other result stays fixed. A scenario is a
-- possible outcome, never a promise that every win reaches a particular rank.
create or replace function private.match_detail_table(p_season text, p_at timestamptz, p_id text, p_include boolean,
  p_simulate text default null, p_winner integer default null)
returns jsonb language sql stable set search_path = '' as $$
  with results as (
    select mp.player_id, m.league_id,
      1 played, (m.winner=mp.team)::integer wins,
      case when (mp.team=1 and m.actual_sets='2:0') or (mp.team=2 and m.actual_sets='0:2') then 3
        when (mp.team=1 and m.actual_sets='2:1') or (mp.team=2 and m.actual_sets='1:2') then 2
        when (mp.team=1 and m.actual_sets='1:2') or (mp.team=2 and m.actual_sets='2:1') then 1 else 0 end points,
      (private.profile_regular_game_totals(m.result_details))[mp.team] gf,
      (private.profile_regular_game_totals(m.result_details))[3-mp.team] ga
    from public.matches m join public.match_players mp on mp.match_id=m.id
    where m.season_id=p_season and m.competition_stage='league' and m.counts_for_ranking
      and m.cancelled_at is null and m.winner is not null and m.actual_sets is not null
      and ((m.match_at,m.id)<(p_at,p_id) or (p_include and (m.match_at,m.id)=(p_at,p_id)))
    union all
    select mp.player_id,m.league_id,1,(mp.team=p_winner)::integer,
      case when mp.team=p_winner then 3 else 0 end,
      case when mp.team=p_winner then 12 else 0 end,
      case when mp.team=p_winner then 0 else 12 end
    from public.matches m join public.match_players mp on mp.match_id=m.id
    where m.id=p_simulate and m.season_id=p_season and m.competition_stage='league' and m.counts_for_ranking
  ), totals as (
    select sp.player_id,sp.league_id,p.display_name,
      coalesce(sum(r.played),0) played,coalesce(sum(r.wins),0) wins,coalesce(sum(r.points),0) points,
      coalesce(sum(r.gf),0) gf,coalesce(sum(r.gf-r.ga),0) diff
    from public.season_players sp join public.players p on p.id=sp.player_id
    left join results r on r.player_id=sp.player_id and r.league_id=sp.league_id
    where sp.season_id=p_season group by sp.player_id,sp.league_id,p.display_name
  ), ranked as (
    select *, row_number() over(partition by league_id order by points desc,diff desc,gf desc,display_name,player_id) place,
      rank() over(partition by league_id order by points desc,diff desc,gf desc) sporting_place,
      count(*) over(partition by league_id,points,diff,gf) ties from totals
  ) select coalesce(jsonb_object_agg(player_id,jsonb_build_object('rank',place,'played',played,'wins',wins,
    'points',points,'gameDiff',diff,'soleLeader',sporting_place=1 and ties=1)), '{}'::jsonb) from ranked;
$$;

create or replace function private.match_detail_elo(p_player text, p_season text, p_at timestamptz, p_id text, p_analysis boolean)
returns jsonb language sql stable set search_path = '' as $$
  with history as (
    select e.*,m.match_at from public.match_elo_changes e join public.matches m on m.id=e.match_id
    join public.seasons s on s.id=m.season_id and s.counts_for_profile
    where e.player_id=p_player and m.counts_for_elo and m.cancelled_at is null
      and (m.match_at,m.id)<(p_at,p_id)
  ), baseline as (
    select sp.start_elo from public.season_players sp where sp.season_id=p_season and sp.player_id=p_player
  ), own_change as (
    select e.* from public.match_elo_changes e where p_analysis and e.match_id=p_id and e.player_id=p_player
  ) select jsonb_build_object(
    'before',coalesce((select old_elo from own_change),(select new_elo from history order by match_at desc,match_id desc limit 1),(select start_elo from baseline)),
    'after',(select new_elo from own_change), 'delta',(select new_elo-old_elo from own_change),
    'peakBefore',greatest((select start_elo from baseline),(select max(greatest(old_elo,new_elo)) from history))
  );
$$;

create or replace function private.match_detail_result_impact(p_winner integer, p_probability numeric)
returns jsonb language sql immutable set search_path = '' as $$
  with probability as (select case when p_winner=1 then p_probability else 1-p_probability end value)
  select case when value<=0.4 or value>=0.55 then jsonb_build_object(
    'kind',case when value<=0.4 then 'upset' else 'favoriteConfirmed' end,
    'team',p_winner,'probability',value) else null end from probability;
$$;

create or replace function public.get_public_match_detail(p_match_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  m public.matches; s public.seasons; member record; h record;
  completed boolean; mode text; cutoff timestamptz; cutoff_id text; today date := (now() at time zone 'Europe/Berlin')::date;
  active_stage text; ids text[]; team_one text[]; team_two text[];
  players jsonb := '[]'; player jsonb; elo jsonb; before_streak jsonb; after_streak jsonb;
  table_before jsonb; table_after jsonb; table_win_one jsonb; table_win_two jsonb; previous jsonb; current_stats jsonb; scenario jsonb;
  impacts jsonb := '[]'; rematches jsonb := '[]'; company_info jsonb := null;
  expected numeric; factor_min numeric; factor_max numeric; old_elo numeric; opponent_elo numeric[];
  team_one_elo numeric[]; team_two_elo numeric[]; probability numeric;
  company_one text; company_two text; company_wins_one integer; company_wins_two integer;
  streak_length integer; before_length integer; peak numeric; change_kind text;
begin
  select * into m from public.matches where id=p_match_id;
  if not found then return null; end if;
  select * into s from public.seasons where id=m.season_id;
  if not s.counts_for_profile or m.cancelled_at is not null or m.match_type not in ('season','final')
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
  cutoff_id := case when completed then m.id else chr(65535) end;
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
      -- Cup totals cover its official matches, without inventing a Cup table.
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
      if m.competition_stage='league' and m.counts_for_ranking then
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
    if completed and probability is not null then
      impacts:=impacts||coalesce(private.match_detail_result_impact(m.winner,probability),'[]'::jsonb);
    end if;
  end if;
  return jsonb_build_object('availability',mode,'generatedAt',now(),'matchId',m.id,'seasonId',s.id,'seasonLabel',s.label,
    'label',coalesce(m.display_label,'Partie '||coalesce(substring(m.id from '([0-9]+)$'),m.matchday::text)),'stage',m.competition_stage,'matchAt',m.match_at,
    'result',m.result_details,'sets',m.actual_sets,'winner',m.winner,'countsForElo',m.counts_for_elo,
    'probability',probability,'players',players,'rematches',rematches,'company',company_info,'impacts',impacts);
end;
$$;

revoke all on function private.match_detail_history(text[],timestamptz,text,boolean) from public,anon,authenticated;
revoke all on function private.match_detail_relationships(text,text,text[],timestamptz,text,boolean) from public,anon,authenticated;
revoke all on function private.match_detail_streak(text,timestamptz,text,boolean) from public,anon,authenticated;
revoke all on function private.match_detail_table(text,timestamptz,text,boolean,text,integer) from public,anon,authenticated;
revoke all on function private.match_detail_elo(text,text,timestamptz,text,boolean) from public,anon,authenticated;
revoke all on function private.match_detail_result_impact(integer,numeric) from public,anon,authenticated;
revoke all on function public.get_public_match_detail(text) from public;
grant execute on function public.get_public_match_detail(text) to anon,authenticated;
create or replace function public.get_player_profile(p_player_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select private.get_player_profile_base_without_cancellation(p_player_id) as payload
  )
  select case when base.payload is null then null else jsonb_set(
    base.payload,
    '{matches}',
    coalesce((
      select jsonb_agg(
        item.value || jsonb_build_object(
          'isCancelled', match.cancelled_at is not null,
          'hasMatchStatistics', match.id is not null and match.cancelled_at is null
            and match.competition_stage <> 'final_four' and match.winner is not null and match.actual_sets is not null,
          'date', case
            when match.cancelled_at is not null then 'null'::jsonb
            else item.value -> 'date'
          end
        )
        order by
          case
            when match.cancelled_at is not null then matchday.starts_on
            else nullif(item.value ->> 'date', '')::date
          end desc nulls last,
          item.ordinality
      )
      from jsonb_array_elements(coalesce(base.payload -> 'matches', '[]'::jsonb))
        with ordinality as item(value, ordinality)
      left join public.matches as match on match.id = item.value ->> 'id'
      left join public.season_matchdays as matchday
        on matchday.season_id = match.season_id and matchday.matchday = match.matchday
    ), '[]'::jsonb)
  ) end
  from base;
$$;

revoke execute on function public.get_player_profile(text) from public;
grant execute on function public.get_player_profile(text) to anon, authenticated;


notify pgrst, 'reload schema';
commit;
