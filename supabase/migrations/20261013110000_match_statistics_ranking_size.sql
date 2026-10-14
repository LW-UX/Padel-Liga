begin;

-- The player excerpt needs the complete league size to mark omitted rows after
-- the lowest-ranked participant without transferring the entire table.
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
      count(*) over(partition by league_id,points,diff,gf) ties,
      count(*) over(partition by league_id) table_size from totals
  ) select coalesce(jsonb_object_agg(player_id,jsonb_build_object('rank',place,'played',played,'wins',wins,
    'points',points,'gameDiff',diff,'soleLeader',sporting_place=1 and ties=1,'tableSize',table_size)), '{}'::jsonb) from ranked;
$$;

revoke all on function private.match_detail_table(text,timestamptz,text,boolean,text,integer) from public,anon,authenticated;

commit;
