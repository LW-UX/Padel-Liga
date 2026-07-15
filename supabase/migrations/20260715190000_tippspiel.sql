create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.players (
  id text primary key,
  display_name text not null,
  initials text not null,
  company text not null,
  created_at timestamptz not null default now()
);

create table public.seasons (
  id text primary key,
  label text not null,
  title text not null,
  starts_on date,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.leagues (
  season_id text not null references public.seasons(id) on delete cascade,
  id text not null,
  label text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (season_id, id)
);

create table public.season_players (
  season_id text not null,
  league_id text not null,
  player_id text not null references public.players(id) on delete cascade,
  start_elo integer not null check (start_elo > 0),
  created_at timestamptz not null default now(),
  primary key (season_id, league_id, player_id),
  foreign key (season_id, league_id) references public.leagues(season_id, id) on delete cascade
);

create table public.matches (
  id text primary key,
  season_id text not null,
  league_id text not null,
  matchday integer not null check (matchday > 0),
  match_type text not null default 'season' check (match_type in ('season', 'training', 'final')),
  format text not null default 'best-of-three',
  scheduled_date date,
  display_time text,
  lock_at timestamptz,
  team_one_label text not null,
  team_two_label text not null,
  result_details text,
  actual_sets text check (actual_sets is null or actual_sets in ('2:0', '2:1', '1:2', '0:2', '1:0', '0:1')),
  winner smallint check (winner is null or winner in (1, 2)),
  betting_open boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (season_id, league_id) references public.leagues(season_id, id) on delete cascade,
  check ((actual_sets is null and winner is null) or (actual_sets is not null and winner is not null))
);

create table public.match_players (
  match_id text not null references public.matches(id) on delete cascade,
  player_id text not null references public.players(id) on delete restrict,
  team smallint not null check (team in (1, 2)),
  position smallint not null check (position > 0),
  primary key (match_id, player_id),
  unique (match_id, team, position)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 2 and 40),
  player_id text unique references public.players(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.predictions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  match_id text not null references public.matches(id) on delete cascade,
  prediction text not null check (prediction in ('2:0', '2:1', '1:2', '0:2')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, match_id)
);

create index predictions_match_id_idx on public.predictions(match_id);
create index matches_prediction_list_idx on public.matches(season_id, betting_open, matchday);
create index matches_league_idx on public.matches(season_id, league_id);
create index match_players_player_id_idx on public.match_players(player_id);
create index season_players_player_id_idx on public.season_players(player_id);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger predictions_set_updated_at
before update on public.predictions
for each row execute function private.set_updated_at();

create or replace function private.close_decided_match()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.actual_sets is not null then
    new.betting_open = false;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

create trigger matches_close_decided
before insert or update on public.matches
for each row execute function private.close_decided_match();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  requested_name text;
begin
  requested_name := trim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  if char_length(requested_name) < 2 then
    requested_name := split_part(coalesce(new.email, ''), '@', 1);
  end if;
  if char_length(requested_name) < 2 then
    requested_name := 'Tipper';
  end if;

  insert into public.profiles (id, display_name)
  values (new.id, left(requested_name, 40));
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

create or replace function public.update_my_profile(p_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_name text := trim(p_display_name);
begin
  if (select auth.uid()) is null then
    raise exception 'Nicht angemeldet.';
  end if;
  if char_length(clean_name) not between 2 and 40 then
    raise exception 'Der Anzeigename muss zwischen 2 und 40 Zeichen lang sein.';
  end if;

  update public.profiles
  set display_name = clean_name
  where id = (select auth.uid());
end;
$$;

create or replace function public.get_prediction_leaderboard(p_season_id text)
returns table (
  user_id uuid,
  display_name text,
  predictions_count bigint,
  scored_count bigint,
  exact_count bigint,
  tendency_count bigint,
  points bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile.id,
    profile.display_name,
    count(prediction.match_id) as predictions_count,
    count(prediction.match_id) filter (where match.actual_sets is not null) as scored_count,
    count(prediction.match_id) filter (
      where match.actual_sets is not null and prediction.prediction = match.actual_sets
    ) as exact_count,
    count(prediction.match_id) filter (
      where match.actual_sets is not null
        and prediction.prediction <> match.actual_sets
        and (
          (prediction.prediction in ('2:0', '2:1') and match.actual_sets in ('2:0', '2:1'))
          or (prediction.prediction in ('1:2', '0:2') and match.actual_sets in ('1:2', '0:2'))
        )
    ) as tendency_count,
    coalesce(sum(
      case
        when match.actual_sets is null then 0
        when prediction.prediction = match.actual_sets then 4
        when prediction.prediction in ('2:0', '2:1') and match.actual_sets in ('2:0', '2:1') then 2
        when prediction.prediction in ('1:2', '0:2') and match.actual_sets in ('1:2', '0:2') then 2
        else 0
      end
    ), 0)::bigint as points
  from public.profiles as profile
  join public.predictions as prediction on prediction.user_id = profile.id
  join public.matches as match on match.id = prediction.match_id
  where match.season_id = p_season_id
  group by profile.id, profile.display_name
  order by 7 desc, 5 desc, 6 desc, 2 asc;
$$;

alter table public.players enable row level security;
alter table public.seasons enable row level security;
alter table public.leagues enable row level security;
alter table public.season_players enable row level security;
alter table public.matches enable row level security;
alter table public.match_players enable row level security;
alter table public.profiles enable row level security;
alter table public.predictions enable row level security;

create policy "League data is public" on public.players for select to anon, authenticated using (true);
create policy "Seasons are public" on public.seasons for select to anon, authenticated using (true);
create policy "Leagues are public" on public.leagues for select to anon, authenticated using (true);
create policy "Season players are public" on public.season_players for select to anon, authenticated using (true);
create policy "Matches are public" on public.matches for select to anon, authenticated using (true);
create policy "Match players are public" on public.match_players for select to anon, authenticated using (true);
create policy "Users read their profile" on public.profiles for select to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = id);
create policy "Users update their display name" on public.profiles for update to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = id)
with check ((select auth.uid()) is not null and (select auth.uid()) = id);
create policy "Users read their predictions" on public.predictions for select to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy "Users create open predictions" on public.predictions for insert to authenticated
with check (
  (select auth.uid()) is not null
  and (select auth.uid()) = user_id
  and exists (
    select 1 from public.matches as match
    where match.id = match_id
      and match.betting_open
      and match.actual_sets is null
      and (match.lock_at is null or match.lock_at > now())
  )
);
create policy "Users update open predictions" on public.predictions for update to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.uid()) = user_id
  and exists (
    select 1 from public.matches as match
    where match.id = match_id
      and match.betting_open
      and match.actual_sets is null
      and (match.lock_at is null or match.lock_at > now())
  )
)
with check (
  (select auth.uid()) is not null
  and (select auth.uid()) = user_id
  and exists (
    select 1 from public.matches as match
    where match.id = match_id
      and match.betting_open
      and match.actual_sets is null
      and (match.lock_at is null or match.lock_at > now())
  )
);
create policy "Users delete open predictions" on public.predictions for delete to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.uid()) = user_id
  and exists (
    select 1 from public.matches as match
    where match.id = match_id
      and match.betting_open
      and match.actual_sets is null
      and (match.lock_at is null or match.lock_at > now())
  )
);

revoke all on public.players, public.seasons, public.leagues, public.season_players, public.matches, public.match_players, public.profiles, public.predictions from anon, authenticated;
grant select on public.players, public.seasons, public.leagues, public.season_players, public.matches, public.match_players to anon, authenticated;
grant select, update(display_name) on public.profiles to authenticated;
grant select, insert, update, delete on public.predictions to authenticated;
revoke execute on function public.update_my_profile(text) from public, anon;
grant execute on function public.update_my_profile(text) to authenticated;
revoke execute on function public.get_prediction_leaderboard(text) from public;
grant execute on function public.get_prediction_leaderboard(text) to anon, authenticated;

insert into public.players (id, display_name, initials, company) values
  ('agnes_k', 'Agnes K.', 'AK', 'Headsquare'),
  ('andreas_l', 'Andreas L.', 'AL', 'Headsquare'),
  ('chris_m', 'Chris M.', 'ChM', 'Envidual'),
  ('christoph_l', 'Christoph L.', 'CL', 'Headsquare'),
  ('cristian_b', 'Cristian B.', 'CB', 'Hanako'),
  ('florian_z', 'Florian Z.', 'FZ', 'Hanako'),
  ('greta_p', 'Greta P.', 'GP', 'Hanako'),
  ('irene_w', 'Irene W.', 'IW', 'Headsquare'),
  ('jonas_l', 'Jonas L.', 'JL', 'Envidual'),
  ('leonie_r', 'Leonie R.', 'LR', 'Hanako'),
  ('luca_w', 'Luca W.', 'LW', 'Envidual'),
  ('ludwig_w', 'Ludwig W.', 'LuW', 'Envidual'),
  ('lukas_p', 'Lukas P.', 'LP', 'Headsquare'),
  ('marcel_m', 'Marcel M.', 'MzM', 'Envidual'),
  ('marco_m', 'Marco M.', 'MaMay', 'Headsquare'),
  ('martin_b', 'Martin B.', 'MB', 'Headsquare'),
  ('niklas_k', 'Niklas K.', 'NK', 'Hanako'),
  ('raphael_h', 'Raphael H.', 'RH', 'Headsquare');

insert into public.seasons (id, label, title, starts_on, is_active)
values ('2026', '2026', 'Padel-Liga 2026', '2026-05-11', true);

insert into public.leagues (season_id, id, label, is_default)
values ('2026', 'main', 'Padel-Liga 2026', true);

insert into public.season_players (season_id, league_id, player_id, start_elo) values
  ('2026', 'main', 'agnes_k', 750),
  ('2026', 'main', 'andreas_l', 1100),
  ('2026', 'main', 'chris_m', 900),
  ('2026', 'main', 'christoph_l', 850),
  ('2026', 'main', 'cristian_b', 800),
  ('2026', 'main', 'florian_z', 800),
  ('2026', 'main', 'greta_p', 900),
  ('2026', 'main', 'irene_w', 750),
  ('2026', 'main', 'jonas_l', 800),
  ('2026', 'main', 'leonie_r', 800),
  ('2026', 'main', 'luca_w', 800),
  ('2026', 'main', 'ludwig_w', 1100),
  ('2026', 'main', 'lukas_p', 1150),
  ('2026', 'main', 'marcel_m', 1000),
  ('2026', 'main', 'marco_m', 1050),
  ('2026', 'main', 'martin_b', 800),
  ('2026', 'main', 'niklas_k', 850),
  ('2026', 'main', 'raphael_h', 1100);

create temporary table seed_matches (
  id text,
  matchday integer,
  scheduled_date date,
  display_time text,
  lock_at timestamptz,
  team_one_label text,
  team_two_label text,
  result_details text,
  actual_sets text,
  winner smallint,
  betting_open boolean,
  team_one_ids text[],
  team_two_ids text[]
) on commit drop;

insert into seed_matches values
  ('season-2026-partie-1',1,'2026-06-11','12.30','2026-06-11 12:30:00+02','Greta P. / Agnes K.','Christoph L. / Marco M.','1:6, 3:6','0:2',2,false,array['greta_p','agnes_k']::text[],array['christoph_l','marco_m']::text[]),
  ('season-2026-partie-2',1,'2026-05-20','12.30','2026-05-20 12:30:00+02','Leonie R. / Cristian B.','Jonas L. / Luca W.','2:6, 0:6','0:2',2,false,array['leonie_r','cristian_b']::text[],array['jonas_l','luca_w']::text[]),
  ('season-2026-partie-3',1,'2026-06-17','13.00','2026-06-17 13:00:00+02','Martin B. / Chris M.','Marcel M. / Irene W.','4:6, 3:6','0:2',2,false,array['martin_b','chris_m']::text[],array['marcel_m','irene_w']::text[]),
  ('season-2026-partie-4',1,'2026-05-13','17.30','2026-05-13 17:30:00+02','Ludwig W. / Raphael H.','Florian Z. / Niklas K.','6:3, 6:2','2:0',1,false,array['ludwig_w','raphael_h']::text[],array['florian_z','niklas_k']::text[]),
  ('season-2026-partie-5',2,'2026-06-10','12.00','2026-06-10 12:00:00+02','Lukas P. / Martin B.','Luca W. / Andreas L.','0:6, 4:6','0:2',2,false,array['lukas_p','martin_b']::text[],array['luca_w','andreas_l']::text[]),
  ('season-2026-partie-6',2,'2026-05-19','13.00','2026-05-19 13:00:00+02','Ludwig W. / Cristian B.','Niklas K. / Greta P.','7:5, 6:1','2:0',1,false,array['ludwig_w','cristian_b']::text[],array['niklas_k','greta_p']::text[]),
  ('season-2026-partie-7',2,'2026-06-12','07.30','2026-06-12 07:30:00+02','Christoph L. / Raphael H.','Marco M. / Marcel M.','1:6, 1:6','0:2',2,false,array['christoph_l','raphael_h']::text[],array['marco_m','marcel_m']::text[]),
  ('season-2026-partie-8',2,'2026-06-17','12.00','2026-06-17 12:00:00+02','Chris M. / Jonas L.','Irene W. / Leonie R.','6:0, 6:2','2:0',1,false,array['chris_m','jonas_l']::text[],array['irene_w','leonie_r']::text[]),
  ('season-2026-partie-9',3,'2026-07-07','07.30','2026-07-07 07:30:00+02','Cristian B. / Chris M.','Raphael H. / Leonie R.','1:6, 6:3 – 10:5','2:1',1,false,array['cristian_b','chris_m']::text[],array['raphael_h','leonie_r']::text[]),
  ('season-2026-partie-10',3,'2026-06-08',null,null,'Agnes K. / Lukas P.','Ludwig W. / Marco M.',null,null,null,true,array['agnes_k','lukas_p']::text[],array['ludwig_w','marco_m']::text[]),
  ('season-2026-partie-11',3,'2026-07-09','07.30','2026-07-09 07:30:00+02','Christoph L. / Florian Z.','Luca W. / Irene W.','4:6, 6:2 – 7:10','1:2',2,false,array['christoph_l','florian_z']::text[],array['luca_w','irene_w']::text[]),
  ('season-2026-partie-12',3,'2026-06-03','12.30','2026-06-03 12:30:00+02','Greta P. / Andreas L.','Marcel M. / Jonas L.','1:6, 6:3 – 6:10','1:2',2,false,array['greta_p','andreas_l']::text[],array['marcel_m','jonas_l']::text[]),
  ('season-2026-partie-13',4,'2026-06-23','07.30','2026-06-23 07:30:00+02','Chris M. / Raphael H.','Ludwig W. / Irene W.','7:6 (11:9), 6:2','2:0',1,false,array['chris_m','raphael_h']::text[],array['ludwig_w','irene_w']::text[]),
  ('season-2026-partie-14',4,'2026-06-25','12.00','2026-06-25 12:00:00+02','Cristian B. / Lukas P.','Christoph L. / Martin B.','6:1, 6:0','2:0',1,false,array['cristian_b','lukas_p']::text[],array['christoph_l','martin_b']::text[]),
  ('season-2026-partie-15',4,'2026-06-22',null,null,'Marco M. / Andreas L.','Leonie R. / Niklas K.',null,null,null,true,array['marco_m','andreas_l']::text[],array['leonie_r','niklas_k']::text[]),
  ('season-2026-partie-16',4,'2026-07-16','07.15','2026-07-16 07:15:00+02','Marcel M. / Florian Z.','Agnes K. / Jonas L.',null,null,null,true,array['marcel_m','florian_z']::text[],array['agnes_k','jonas_l']::text[]),
  ('season-2026-partie-17',5,'2026-07-15','07.30','2026-07-15 07:30:00+02','Martin B. / Luca W.','Florian Z. / Ludwig W.','7:6 (7:4), 2:6 – 2:10','1:2',2,false,array['martin_b','luca_w']::text[],array['florian_z','ludwig_w']::text[]),
  ('season-2026-partie-18',5,'2026-07-06',null,null,'Chris M. / Agnes K.','Jonas L. / Greta P.',null,null,null,true,array['chris_m','agnes_k']::text[],array['jonas_l','greta_p']::text[]),
  ('season-2026-partie-19',5,'2026-07-06',null,null,'Raphael H. / Andreas L.','Lukas P. / Niklas K.',null,null,null,true,array['raphael_h','andreas_l']::text[],array['lukas_p','niklas_k']::text[]),
  ('season-2026-partie-20',5,'2026-07-06',null,null,'Christoph L. / Irene W.','Marco M. / Cristian B.',null,null,null,true,array['christoph_l','irene_w']::text[],array['marco_m','cristian_b']::text[]),
  ('season-2026-partie-21',6,'2026-07-14','12.30','2026-07-14 12:30:00+02','Florian Z. / Leonie R.','Andreas L. / Ludwig W.','0:6, 0:6','0:2',2,false,array['florian_z','leonie_r']::text[],array['andreas_l','ludwig_w']::text[]),
  ('season-2026-partie-22',6,'2026-07-20',null,null,'Irene W. / Cristian B.','Greta P. / Christoph L.',null,null,null,true,array['irene_w','cristian_b']::text[],array['greta_p','christoph_l']::text[]),
  ('season-2026-partie-23',6,'2026-07-20',null,null,'Jonas L. / Marco M.','Agnes K. / Martin B.',null,null,null,true,array['jonas_l','marco_m']::text[],array['agnes_k','martin_b']::text[]),
  ('season-2026-partie-24',6,'2026-06-24','12.00','2026-06-24 12:00:00+02','Marcel M. / Niklas K.','Lukas P. / Luca W.','4:6, 4:6','0:2',2,false,array['marcel_m','niklas_k']::text[],array['lukas_p','luca_w']::text[]),
  ('season-2026-partie-25',7,'2026-07-16','12.30','2026-07-16 12:30:00+02','Niklas K. / Chris M.','Agnes K. / Andreas L.',null,null,null,true,array['niklas_k','chris_m']::text[],array['agnes_k','andreas_l']::text[]),
  ('season-2026-partie-26',7,'2026-07-21','12.30','2026-07-21 12:30:00+02','Florian Z. / Raphael H.','Marcel M. / Luca W.',null,null,null,true,array['florian_z','raphael_h']::text[],array['marcel_m','luca_w']::text[]),
  ('season-2026-partie-27',7,'2026-08-03',null,null,'Leonie R. / Lukas P.','Greta P. / Martin B.',null,null,null,true,array['leonie_r','lukas_p']::text[],array['greta_p','martin_b']::text[]);

insert into public.matches (
  id, season_id, league_id, matchday, scheduled_date, display_time, lock_at,
  team_one_label, team_two_label, result_details, actual_sets, winner, betting_open
)
select
  id, '2026', 'main', matchday, scheduled_date, display_time, lock_at,
  team_one_label, team_two_label, result_details, actual_sets, winner, betting_open
from seed_matches;

insert into public.match_players (match_id, player_id, team, position)
select seed.id, member.player_id, 1, member.position
from seed_matches as seed
cross join lateral unnest(seed.team_one_ids) with ordinality as member(player_id, position)
union all
select seed.id, member.player_id, 2, member.position
from seed_matches as seed
cross join lateral unnest(seed.team_two_ids) with ordinality as member(player_id, position);
