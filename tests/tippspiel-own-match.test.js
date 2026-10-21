const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js', 'tippspiel.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261020170000_prevent_own_match_predictions.sql'),
  'utf8'
);

function fn(name) {
  const match = source.match(new RegExp(`  function ${name}\\([^]*?\\n  }`));
  assert.ok(match, name);
  return match[0];
}

test('PadelTipp uses the authenticated profile player for blue names and own-match locking', () => {
  const state = { profile: { player_id: 'a' } };
  const context = vm.createContext({ state, escapeHtml: value => String(value) });
  vm.runInContext([fn('isOwnMatch'), fn('renderTeam'), fn('getStatusChip')].join('\n'), context);

  const ownMatch = {
    team1: { playerIds: ['a', 'b'] },
    team2: { playerIds: ['c', 'd'] }
  };
  assert.equal(context.isOwnMatch(ownMatch), true);
  assert.equal(context.isOwnMatch({ team1: { playerIds: ['x'] }, team2: { playerIds: ['y'] } }), false);
  assert.match(
    context.renderTeam({ playerIds: ['a', 'b'], spieler: ['Spieler A', 'Spieler B'] }),
    /class="prediction-player is-authenticated-player player-profile-link" href="\.\.\/\?spielerprofil=a"[^>]*>Spieler A<\/a>/
  );
  assert.equal(context.getStatusChip({ isOwn: true }).label, 'Eigene Partie');
  assert.match(source, /state\.session\?\.user\?\.id === entry\.user_id \? 'authenticated-player-highlight'/);
  assert.doesNotMatch(source, /entry\.user_id \? 'viewer-highlight'/);
  assert.match(style, /\.prediction-player\.is-authenticated-player \{ color: var\(--accent2\); \}/);
});

test('own-match protection and automatic floor scoring are part of the database contract', () => {
  assert.match(migration, /Eigene Partien können nicht getippt werden/);
  assert.match(migration, /not exists \([\s\S]*public\.match_players/);
  assert.match(migration, /min\(awarded_points\)/);
  assert.match(migration, /where awarded_points is not null/);
  assert.match(migration, /join public\.match_players as member on member\.match_id = floor\.match_id/);
  assert.match(migration, /count\(entry\.match_id\) filter \(where entry\.is_prediction\)/);
});

test('database awards participants the lowest submitted score and ignores non-submitters', { skip: !process.env.PGLITE_MODULE }, async t => {
  const { PGlite } = require(process.env.PGLITE_MODULE);
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create schema auth; create schema private;
    create role anon; create role authenticated;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function private.user_email_is_confirmed(uuid) returns boolean language sql stable as $$ select true $$;
    create function private.match_forecast_mode(text) returns text language sql stable as $$ select 'preview'::text $$;
    create function private.get_match_forecast_state(text,uuid) returns jsonb language sql stable as $$ select '{}'::jsonb $$;
    create table public.players(id text primary key);
    create table public.seasons(id text primary key, predictions_enabled boolean not null default true);
    create table public.profiles(
      id uuid primary key,
      display_name text not null,
      player_id text unique references public.players(id)
    );
    create table public.matches(
      id text primary key,
      season_id text not null references public.seasons(id),
      format text not null default 'best-of-three',
      result_details text,
      actual_sets text,
      cancelled_at timestamptz,
      betting_open boolean not null default true,
      match_at timestamptz,
      competition_stage text not null default 'league',
      winner smallint
    );
    create table public.match_players(
      match_id text references public.matches(id),
      player_id text references public.players(id),
      team smallint,
      position smallint,
      primary key(match_id,player_id)
    );
    create table public.predictions(
      user_id uuid references public.profiles(id),
      match_id text references public.matches(id),
      prediction text not null,
      updated_at timestamptz not null default now(),
      primary key(user_id,match_id)
    );
    alter table public.predictions enable row level security;
    grant usage on schema public, auth, private to authenticated;
    grant select on public.profiles, public.matches, public.seasons, public.match_players to authenticated;
    grant select, insert, update on public.predictions to authenticated;
  `);
  await db.exec(migration);
  await db.exec(`
    insert into players values ('a'),('b'),('c'),('d');
    insert into seasons values ('season',true);
    insert into profiles values
      ('00000000-0000-0000-0000-000000000001','Spieler A','a'),
      ('00000000-0000-0000-0000-000000000002','Spieler B','b'),
      ('00000000-0000-0000-0000-000000000003','Spieler C','c'),
      ('00000000-0000-0000-0000-000000000004','Spieler D','d'),
      ('00000000-0000-0000-0000-000000000011','Tipper 1',null),
      ('00000000-0000-0000-0000-000000000012','Tipper 2',null),
      ('00000000-0000-0000-0000-000000000013','Tipper 3',null),
      ('00000000-0000-0000-0000-000000000014','Ohne Tipp',null);
    insert into matches(id,season_id,actual_sets,winner,betting_open) values
      ('all-four','season','2:0',1,false),
      ('includes-zero','season','2:0',1,false);
    insert into matches(id,season_id,match_at) values ('open','season',now()+interval '1 day');
    insert into match_players
      select match_id, player_id, team, position
      from (values ('a',1,1),('b',1,2),('c',2,1),('d',2,2)) as players(player_id,team,position)
      cross join (values ('all-four'),('includes-zero'),('open')) as matches(match_id);
    insert into predictions values
      ('00000000-0000-0000-0000-000000000011','all-four','2:0',now()),
      ('00000000-0000-0000-0000-000000000012','all-four','2:0',now()),
      ('00000000-0000-0000-0000-000000000013','all-four','2:0',now()),
      ('00000000-0000-0000-0000-000000000011','includes-zero','2:0',now()),
      ('00000000-0000-0000-0000-000000000012','includes-zero','2:1',now()),
      ('00000000-0000-0000-0000-000000000013','includes-zero','1:2',now()),
      ('00000000-0000-0000-0000-000000000001','includes-zero','2:0',now());
  `);

  const leaderboard = (await db.query("select * from public.get_prediction_leaderboard('season')")).rows;
  const player = leaderboard.find(entry => entry.display_name === 'Spieler A');
  assert.equal(Number(player.points), 4);
  assert.equal(Number(player.predictions_count), 0);
  assert.equal(Number(player.scored_count), 2);
  assert.equal(leaderboard.some(entry => entry.display_name === 'Ohne Tipp'), false);

  await db.query("select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false)");
  await assert.rejects(
    db.query("select public.submit_match_quick_prediction('open','2:0')"),
    /Eigene Partien/
  );

  await db.exec('set role authenticated');
  await assert.rejects(
    db.exec("insert into public.predictions values ('00000000-0000-0000-0000-000000000001','open','2:0',now())"),
    /row-level security policy/
  );
});
