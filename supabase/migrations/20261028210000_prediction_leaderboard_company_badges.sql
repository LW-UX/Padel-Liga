begin;

drop function public.get_prediction_leaderboard(text);

create function public.get_prediction_leaderboard(p_season_id text)
returns table (
  user_id uuid,
  display_name text,
  is_player boolean,
  company text,
  previous_prediction_winner boolean,
  previous_prediction_season_label text,
  predictions_count bigint,
  scored_count bigint,
  exact_count bigint,
  tendency_count bigint,
  passive_count bigint,
  bonus_points bigint,
  points bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with current_season as (
    select season.starts_on
    from public.seasons as season
    where season.id = p_season_id
  ), previous_league_season as (
    select season.id, season.label
    from public.seasons as season
    cross join current_season
    where season.id <> p_season_id
      and season.completed_at is not null
      and season.counts_for_profile
      and season.visual_theme <> 'cup'
      and (current_season.starts_on is null or season.starts_on < current_season.starts_on)
    order by season.starts_on desc nulls last, season.completed_at desc, season.id
    limit 1
  ), previous_prediction_winner as (
    select previous_entry.user_id, previous_season.label as season_label
    from previous_league_season as previous_season
    cross join lateral private.get_prediction_leaderboard_rows(previous_season.id) as previous_entry
    order by
      previous_entry.points desc,
      previous_entry.exact_count desc,
      previous_entry.tendency_count desc,
      previous_entry.display_name asc,
      previous_entry.user_id
    limit 1
  )
  select
    current_entry.user_id,
    current_entry.display_name,
    current_entry.is_player,
    player.company,
    previous_winner.user_id is not null,
    previous_winner.season_label,
    current_entry.predictions_count,
    current_entry.scored_count,
    current_entry.exact_count,
    current_entry.tendency_count,
    current_entry.passive_count,
    current_entry.bonus_points,
    current_entry.points
  from private.get_prediction_leaderboard_rows(p_season_id) as current_entry
  left join public.profiles as profile on profile.id = current_entry.user_id
  left join public.players as player on player.id = profile.player_id
  left join previous_prediction_winner as previous_winner
    on previous_winner.user_id = current_entry.user_id
  order by
    current_entry.points desc,
    current_entry.exact_count desc,
    current_entry.tendency_count desc,
    current_entry.display_name asc;
$$;

revoke all on function public.get_prediction_leaderboard(text) from public;
revoke all on function public.get_prediction_leaderboard(text) from anon, authenticated;
grant execute on function public.get_prediction_leaderboard(text) to anon, authenticated;

commit;
