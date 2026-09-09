begin;

do $$
begin
  if to_regprocedure('private.advance_season_tournament(text)') is null
    or to_regprocedure('private.award_final_four_players(text)') is null
    or to_regprocedure('private.award_tournament_winner(text)') is null then
    raise exception 'Die automatische Auszeichnungsvergabe für Liga-Saisons ist nicht vollständig installiert.';
  end if;

  if to_regprocedure('private.award_knockout_final_achievements_after_result()') is null then
    raise exception 'Die automatische Auszeichnungsvergabe für Cup-Saisons ist nicht installiert.';
  end if;

  if not exists (
    select 1
    from pg_trigger as database_trigger
    join pg_class as relation on relation.oid = database_trigger.tgrelid
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'matches'
      and database_trigger.tgname = 'matches_advance_tournament'
      and not database_trigger.tgisinternal
  ) then
    raise exception 'Der Ergebnis-Trigger für Liga-Turniere fehlt.';
  end if;

  if not exists (
    select 1
    from pg_trigger as database_trigger
    join pg_class as relation on relation.oid = database_trigger.tgrelid
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'matches'
      and database_trigger.tgname = 'matches_award_knockout_final_achievements'
      and not database_trigger.tgisinternal
  ) then
    raise exception 'Der Ergebnis-Trigger für Cup-Finals fehlt.';
  end if;
end;
$$;

with temporary_achievements (player_id, season_id, kind, title, subtitle) as (
  values
    ('marcel_m', '2026', 'winner', 'Gewinner', 'Padel-Liga Sommer 2026'),
    ('marcel_m', 'winter-2026', 'final_four', 'Final 4 Teilnehmer', 'Padel-Liga Winter 2026'),
    ('ludwig_w', '2026', 'final_four', 'Final 4 Teilnehmer', 'Padel-Liga Sommer 2026'),
    ('marcel_m', null, 'final_four', 'Final 4 Teilnehmer', 'Padel-Liga Sommer 2027'),
    ('marcel_m', 'cup-2027', 'winner', 'Champion', 'Ligacup 2027')
)
delete from public.player_achievements as achievement
using temporary_achievements as temporary
where achievement.player_id = temporary.player_id
  and achievement.season_id is not distinct from temporary.season_id
  and achievement.kind = temporary.kind
  and achievement.title = temporary.title
  and achievement.subtitle = temporary.subtitle;

do $$
begin
  if exists (
    select 1
    from public.player_achievements as achievement
    where
      (achievement.player_id = 'marcel_m' and achievement.season_id = '2026'
        and achievement.kind = 'winner' and achievement.subtitle = 'Padel-Liga Sommer 2026')
      or (achievement.player_id = 'marcel_m' and achievement.season_id = 'winter-2026'
        and achievement.kind = 'final_four' and achievement.subtitle = 'Padel-Liga Winter 2026')
      or (achievement.player_id = 'ludwig_w' and achievement.season_id = '2026'
        and achievement.kind = 'final_four' and achievement.subtitle = 'Padel-Liga Sommer 2026')
      or (achievement.player_id = 'marcel_m' and achievement.season_id is null
        and achievement.kind = 'final_four' and achievement.subtitle = 'Padel-Liga Sommer 2027')
      or (achievement.player_id = 'marcel_m' and achievement.season_id = 'cup-2027'
        and achievement.kind = 'winner' and achievement.subtitle = 'Ligacup 2027')
  ) then
    raise exception 'Mindestens eine vorübergehende Testauszeichnung konnte nicht entfernt werden.';
  end if;
end;
$$;

commit;
