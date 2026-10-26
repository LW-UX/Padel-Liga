begin;

lock table public.training_sessions in share row exclusive mode;
lock table public.training_rounds in share row exclusive mode;

do $$
declare
  deleted_count integer;
begin
  if (
    select array_agg(session.id order by session.id)
    from public.training_sessions as session
  ) <> array[2, 3, 4, 5, 6, 8, 9, 12, 13, 14, 15, 16, 17, 18]::bigint[] then
    raise exception 'Der Trainingsbestand entspricht nicht mehr dem geprüften Ausgangsstand.';
  end if;

  if not exists (
    select 1
    from public.training_sessions as session
    where session.id = 16
      and session.played_on = date '2026-10-21'
      and session.display_time = time '13:42'
      and session.status = 'confirmed'
      and (select count(*) from public.training_rounds as round where round.session_id = session.id) = 2
  ) then
    raise exception 'Das zu löschende bestätigte Training 16 wurde nicht eindeutig gefunden.';
  end if;

  if not exists (
    select 1
    from public.training_sessions as session
    where session.id = 18
      and session.played_on = date '2026-10-26'
      and session.display_time = time '14:35'
      and session.status = 'scheduled'
      and not exists (
        select 1 from public.training_rounds as round where round.session_id = session.id
      )
  ) then
    raise exception 'Der zu löschende Trainingstermin 18 wurde nicht eindeutig gefunden.';
  end if;

  delete from public.training_sessions
  where id in (16, 18);

  get diagnostics deleted_count = row_count;
  if deleted_count <> 2 then
    raise exception 'Es wurden nicht genau zwei Trainings gelöscht.';
  end if;
end;
$$;

create temporary table training_session_id_map on commit drop as
select
  session.id as old_id,
  row_number() over (
    order by session.played_on, session.display_time, session.id
  )::bigint as new_id
from public.training_sessions as session;

do $$
begin
  if (select count(*) from training_session_id_map) <> 12
    or (select min(new_id) from training_session_id_map) <> 1
    or (select max(new_id) from training_session_id_map) <> 12 then
    raise exception 'Die neue Trainings-ID-Zuordnung ist unvollständig.';
  end if;
end;
$$;

alter table public.training_rounds
  drop constraint training_rounds_session_id_fkey;

alter table public.training_rounds
  add constraint training_rounds_session_id_fkey
  foreign key (session_id)
  references public.training_sessions(id)
  on update cascade
  on delete cascade;

update public.training_sessions as session
set id = mapping.old_id + 1000
from training_session_id_map as mapping
where session.id = mapping.old_id;

update public.training_sessions as session
set id = mapping.new_id
from training_session_id_map as mapping
where session.id = mapping.old_id + 1000;

alter table public.training_rounds
  drop constraint training_rounds_session_id_fkey;

alter table public.training_rounds
  add constraint training_rounds_session_id_fkey
  foreign key (session_id)
  references public.training_sessions(id)
  on delete cascade;

select setval(
  pg_get_serial_sequence('public.training_sessions', 'id'),
  (select max(session.id) from public.training_sessions as session),
  true
);

do $$
begin
  if (
    select array_agg(session.id order by session.played_on, session.display_time, session.id)
    from public.training_sessions as session
  ) <> array[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]::bigint[] then
    raise exception 'Die Trainings-IDs wurden nicht lückenlos chronologisch neu geschrieben.';
  end if;

  if exists (
    select 1
    from public.training_rounds as round
    left join public.training_sessions as session on session.id = round.session_id
    where session.id is null
  ) then
    raise exception 'Mindestens eine Trainingspaarung besitzt keine gültige Trainings-ID.';
  end if;
end;
$$;

commit;
