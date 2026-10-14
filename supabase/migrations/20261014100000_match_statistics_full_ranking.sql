begin;

-- Add the complete league table to the match detail payload. Match players
-- remain a separate list because the header, impacts and Elo graph are scoped
-- to those four players.
create or replace function public.get_public_match_detail(p_match_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with match_context as (
    select match.*, season.qualification_places, season.tournament_mode
    from public.matches match
    join public.seasons season on season.id = match.season_id
    where match.id = p_match_id
  ), detail as (
    select private.get_public_match_detail_without_qualification_places(p_match_id) as value
  ), ranking_table as (
    select private.match_detail_table(
      match_context.season_id,
      case
        when match_context.winner is not null and match_context.actual_sets is not null then match_context.match_at
        else now()
      end,
      case
        when match_context.winner is not null and match_context.actual_sets is not null then match_context.id
        else chr(65535)
      end,
      match_context.winner is not null and match_context.actual_sets is not null
    ) as value
    from match_context
  )
  select detail.value || jsonb_build_object(
    'qualificationPlaces', match_context.qualification_places,
    'ranking', case
      when match_context.tournament_mode = 'knockout_redraw' then null
      else coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'playerId', player.id,
            'displayName', player.display_name,
            'statistics', ranking_table.value -> player.id
          )
          order by (ranking_table.value -> player.id ->> 'rank')::integer
        )
        from public.season_players season_player
        join public.players player on player.id = season_player.player_id
        where season_player.season_id = match_context.season_id
          and season_player.league_id = match_context.league_id
      ), '[]'::jsonb)
    end
  )
  from detail
  join match_context on true
  left join ranking_table on true;
$$;

revoke all on function public.get_public_match_detail(text) from public;
grant execute on function public.get_public_match_detail(text) to anon, authenticated;

commit;
