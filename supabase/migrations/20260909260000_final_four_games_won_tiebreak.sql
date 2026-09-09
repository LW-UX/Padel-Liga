begin;

create or replace function private.award_tournament_winner(p_season_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  final_count integer;
  completed_count integer;
  winner_player_id text;
  default_league_id text;
  season_label text;
begin
  select count(*), count(*) filter (where match.actual_sets is not null and match.winner is not null)
  into final_count, completed_count
  from public.matches as match
  where match.season_id = p_season_id and match.competition_stage = 'final_four';
  if final_count <> 3 or completed_count <> 3 then return; end if;

  with finalist_stats as (
    select
      finalist.player_id,
      finalist.seed,
      count(*) filter (where match.winner = member.team)::integer as wins,
      coalesce(sum(case member.team when 1 then score.team_one else score.team_two end), 0)::integer as games_won,
      coalesce(sum(case member.team when 1 then score.team_one - score.team_two else score.team_two - score.team_one end), 0)::integer as game_diff
    from public.season_tournament_players as finalist
    join public.match_players as member on member.player_id = finalist.player_id
    join public.matches as match
      on match.id = member.match_id
     and match.season_id = finalist.season_id
     and match.competition_stage = 'final_four'
    cross join lateral (
      select (score_parts.capture)[1]::integer as team_one, (score_parts.capture)[2]::integer as team_two
      from regexp_matches(match.result_details, '([0-9]+)\s*:\s*([0-9]+)', 'g') as score_parts(capture)
      limit 1
    ) as score
    where finalist.season_id = p_season_id and finalist.stage = 'final_four'
    group by finalist.player_id, finalist.seed
  )
  select finalist.player_id into winner_player_id
  from finalist_stats as finalist
  order by finalist.wins desc, finalist.game_diff desc, finalist.games_won desc, finalist.seed
  limit 1;

  if winner_player_id is null then return; end if;
  select league.id, season.label into default_league_id, season_label
  from public.seasons as season
  join public.leagues as league on league.season_id = season.id and league.is_default
  where season.id = p_season_id;

  insert into public.player_achievements (
    player_id, season_id, league_id, kind, title, subtitle, achieved_on, priority
  )
  select winner_player_id, p_season_id, default_league_id, 'winner', 'Gewinner',
    'Padel-Liga ' || season_label, null, 200
  where not exists (
    select 1 from public.player_achievements as achievement
    where achievement.player_id = winner_player_id
      and achievement.season_id = p_season_id
      and achievement.league_id = default_league_id
      and achievement.kind = 'winner'
  );
end;
$$;

commit;
