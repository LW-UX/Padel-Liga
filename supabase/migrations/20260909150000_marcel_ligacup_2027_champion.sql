begin;

alter table public.player_achievements
  drop constraint if exists player_achievements_kind_check;
alter table public.player_achievements
  add constraint player_achievements_kind_check
  check (kind in ('winner', 'final_four', 'finalist', 'custom'));

insert into public.player_achievements (
  player_id,
  season_id,
  league_id,
  kind,
  title,
  subtitle,
  achieved_on,
  priority
)
select
  'marcel_m',
  'cup-2027',
  'main',
  'winner',
  'Champion',
  'Ligacup 2027',
  '2027-01-01'::date,
  200
where not exists (
  select 1
  from public.player_achievements as achievement
  where achievement.player_id = 'marcel_m'
    and achievement.season_id = 'cup-2027'
    and achievement.league_id = 'main'
    and achievement.kind = 'winner'
    and achievement.title = 'Champion'
    and achievement.subtitle = 'Ligacup 2027'
);

do $$
begin
  if (
    select count(*)
    from public.player_achievements as achievement
    where achievement.player_id = 'marcel_m'
      and achievement.season_id = 'cup-2027'
      and achievement.league_id = 'main'
      and achievement.kind = 'winner'
      and achievement.title = 'Champion'
      and achievement.subtitle = 'Ligacup 2027'
      and achievement.achieved_on = '2027-01-01'
      and achievement.priority = 200
  ) <> 1 then
    raise exception 'Marcels Ligacup-2027-Champion-Auszeichnung wurde nicht eindeutig angelegt.';
  end if;
end
$$;

create or replace function private.award_knockout_final_achievements_after_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_season record;
  default_league record;
  award_date date;
begin
  if new.competition_stage <> 'final'
    or new.actual_sets is null
    or new.winner is null then
    return new;
  end if;

  select season.* into selected_season
  from public.seasons as season
  where season.id = new.season_id;
  if not found or selected_season.tournament_mode <> 'knockout_redraw' then
    return new;
  end if;

  select league.id, league.label into default_league
  from public.leagues as league
  where league.season_id = new.season_id and league.is_default
  order by league.id
  limit 1;
  if not found then
    raise exception 'Für die Cup-Saison % fehlt die Standardliga.', new.season_id;
  end if;

  award_date := coalesce(new.scheduled_date, current_date);

  insert into public.player_achievements (
    player_id, season_id, league_id, kind, title, subtitle, achieved_on, priority
  )
  select
    member.player_id,
    new.season_id,
    default_league.id,
    'winner',
    'Champion',
    default_league.label,
    award_date,
    200
  from public.match_players as member
  where member.match_id = new.id
    and member.team = new.winner
    and not exists (
      select 1
      from public.player_achievements as achievement
      where achievement.player_id = member.player_id
        and achievement.season_id = new.season_id
        and achievement.league_id = default_league.id
        and achievement.kind = 'winner'
    );

  insert into public.player_achievements (
    player_id, season_id, league_id, kind, title, subtitle, achieved_on, priority
  )
  select
    member.player_id,
    new.season_id,
    default_league.id,
    'finalist',
    'Finale',
    default_league.label,
    award_date,
    100
  from public.match_players as member
  where member.match_id = new.id
    and member.team <> new.winner
    and not exists (
      select 1
      from public.player_achievements as achievement
      where achievement.player_id = member.player_id
        and achievement.season_id = new.season_id
        and achievement.league_id = default_league.id
        and achievement.kind = 'finalist'
    );

  return new;
end;
$$;

drop trigger if exists matches_award_knockout_final_achievements on public.matches;
create trigger matches_award_knockout_final_achievements
after insert or update of actual_sets, winner on public.matches
for each row execute function private.award_knockout_final_achievements_after_result();

notify pgrst, 'reload schema';

commit;
