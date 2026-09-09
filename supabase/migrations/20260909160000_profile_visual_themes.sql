begin;

alter table public.seasons
  add column if not exists visual_theme text not null default 'neutral';

alter table public.seasons
  drop constraint if exists seasons_visual_theme_check;
alter table public.seasons
  add constraint seasons_visual_theme_check
  check (visual_theme in ('summer', 'winter', 'cup', 'neutral'));

update public.seasons
set visual_theme = case id
  when '2026' then 'summer'
  when 'winter-2026' then 'winter'
  when 'cup-2027' then 'cup'
  when 'test-2026' then 'neutral'
  else visual_theme
end;

drop function if exists public.get_public_seasons();
create function public.get_public_seasons()
returns table (
  id text,
  label text,
  title text,
  starts_on date,
  is_active boolean,
  results_entry_enabled boolean,
  visual_theme text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select season.id, season.label, season.title, season.starts_on,
    season.is_active, season.results_entry_enabled, season.visual_theme
  from public.seasons as season
  order by season.is_active desc, season.starts_on desc nulls last, season.id;
$$;

revoke all on function public.get_public_seasons() from public;
grant execute on function public.get_public_seasons() to anon, authenticated;

create or replace function public.get_public_season(p_season_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', season.id,
    'label', season.label,
    'title', season.title,
    'startDate', season.starts_on,
    'visualTheme', season.visual_theme,
    'eloFinalDate', season.elo_final_date,
    'organizations', to_jsonb(season.organizations),
    'shortInfo', to_jsonb(season.short_info),
    'resultsEntryEnabled', season.results_entry_enabled,
    'competition', jsonb_build_object(
      'tournamentMode', replace(season.tournament_mode, '_', '-'),
      'qualificationPlaces', season.qualification_places,
      'homeRankingLimit', season.home_ranking_limit,
      'regularScheduleLocked', season.regular_schedule_locked,
      'predictionsEnabled', season.predictions_enabled
    ),
    'leagues', coalesce((
      select jsonb_agg(jsonb_build_object('id', league.id, 'label', league.label, 'default', league.is_default)
        order by league.is_default desc, league.id)
      from public.leagues as league where league.season_id = season.id
    ), '[]'::jsonb),
    'matchdays', coalesce((
      select jsonb_agg(jsonb_build_object(
        'spieltag', matchday.matchday, 'startDate', matchday.starts_on,
        'endDate', matchday.ends_on, 'title', matchday.title
      ) order by matchday.matchday)
      from public.season_matchdays as matchday where matchday.season_id = season.id
    ), '[]'::jsonb),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'playerId', participant.player_id, 'leagueId', participant.league_id, 'startElo', participant.start_elo
      ) order by player.display_name)
      from public.season_players as participant
      join public.players as player on player.id = participant.player_id
      where participant.season_id = season.id
    ), '[]'::jsonb),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', match.id,
        'type', 'season',
        'stage', replace(match.competition_stage, '_', '-'),
        'seasonId', match.season_id,
        'leagueId', match.league_id,
        'format', match.format,
        'countsForRanking', match.counts_for_ranking,
        'countsForElo', match.counts_for_elo,
        'matchday', match.matchday,
        'date', match.scheduled_date,
        'time', match.display_time,
        'result', match.result_details,
        'sets', match.actual_sets,
        'winner', match.winner,
        'displayLabel', match.display_label,
        'team1', jsonb_build_object(
          'playerIds', coalesce((
            select jsonb_agg(member.player_id order by member.position)
            from public.match_players as member where member.match_id = match.id and member.team = 1
          ), '[]'::jsonb),
          'qualifierRanks', to_jsonb(match.team_one_qualifier_ranks),
          'qualifierLabels', to_jsonb(string_to_array(match.team_one_label, ' / '))
        ),
        'team2', jsonb_build_object(
          'playerIds', coalesce((
            select jsonb_agg(member.player_id order by member.position)
            from public.match_players as member where member.match_id = match.id and member.team = 2
          ), '[]'::jsonb),
          'qualifierRanks', to_jsonb(match.team_two_qualifier_ranks),
          'qualifierLabels', to_jsonb(string_to_array(match.team_two_label, ' / '))
        )
      ) order by
        case match.competition_stage when 'league' then 1 when 'semifinal' then 2 else 3 end,
        match.matchday, match.id)
      from public.matches as match where match.season_id = season.id
    ), '[]'::jsonb)
  )
  from public.seasons as season where season.id = p_season_id;
$$;

revoke all on function public.get_public_season(text) from public;
grant execute on function public.get_public_season(text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
