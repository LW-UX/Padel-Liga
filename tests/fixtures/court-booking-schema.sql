-- Minimal local PostgreSQL fixture. No production records or external writes.
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create schema private;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select jsonb_build_object('role', current_setting('request.jwt.claim.role', true))
$$;
create function private.user_email_is_confirmed(uuid) returns boolean language sql stable as $$ select true $$;
create table public.profiles (id uuid primary key, player_id text, app_role text);
create table public.seasons (id text primary key, results_entry_enabled boolean);
create table public.leagues (season_id text, id text, label text);
create table public.matches (
  id text primary key, season_id text, league_id text, display_label text,
  team_one_label text, team_two_label text, match_at timestamptz,
  actual_sets text, result_details jsonb, cancelled_at timestamptz
);
create table public.match_players (match_id text, player_id text, team smallint);
create table public.result_proposals (match_id text, status text);
