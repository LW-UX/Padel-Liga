const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const statisticsStyle = fs.readFileSync(path.join(root, 'match-statistics.css'), 'utf8');
const statisticsSource = fs.readFileSync(path.join(root, 'js', 'match-statistics.js'), 'utf8');
const initialMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261019180000_match_forecast_votes.sql'),
  'utf8'
);
const unificationMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261020120000_unify_match_forecasts_with_predictions.sql'),
  'utf8'
);
const exactChoicesMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261020130000_match_forecast_exact_choices.sql'),
  'utf8'
);
const archivedForecastMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261020140000_preserve_archived_match_forecasts.sql'),
  'utf8'
);
const { renderMatchForecast } = require('../js/match-statistics.js');
const fixture = require('./fixtures/match-statistics.cjs');

const forecast = patch => ({
  matchId: 'season-2026-partie-1',
  mode: 'preview',
  open: true,
  totalVotes: 4,
  team1Percentage: 75,
  team2Percentage: 25,
  userVote: null,
  userPrediction: null,
  ...patch
});
const confirmedSession = { user: { id: 'u', email_confirmed_at: '2026-10-19T10:00:00Z' } };

test('detail forecast offers all four exact PadelTipp values at the existing total width', () => {
  const data = fixture();
  const choice = renderMatchForecast(data, forecast(), { session: confirmedSession });
  assert.equal((choice.match(/live-point-team-button match-forecast-choice/g) || []).length, 4);
  for (const prediction of ['2:0', '2:1', '1:2', '0:2']) {
    assert.match(choice, new RegExp(`data-match-forecast-prediction="${prediction}"`));
  }
  assert.equal((choice.match(/<strong>Team 1<\/strong>/g) || []).length, 2);
  assert.equal((choice.match(/<strong>Team 2<\/strong>/g) || []).length, 2);
  assert.match(choice, /<strong>Team 1<\/strong><span>2:0<\/span>/);
  assert.match(choice, /<strong>Team 2<\/strong><span>0:2<\/span>/);
  assert.doesNotMatch(choice, /Greta P\. \/ Agnes K\.|Christoph L\. \/ Marco M\./);
  assert.doesNotMatch(choice, /match-forecast-bar|Tipp ändern/);

  const result = renderMatchForecast(data, forecast({ userVote: 1, userPrediction: '2:1' }), { session: confirmedSession });
  assert.match(result, /match-forecast-percentages"><span>75 %<\/span><span>25 %<\/span>/);
  assert.match(result, /match-forecast-team-one" style="width:37\.5%/);
  assert.doesNotMatch(result, /Dein Tipp|match-forecast-own/);
  assert.match(result, /data-match-forecast-change>Tipp ändern/);

  const exactChange = renderMatchForecast(data, forecast({ userVote: 1, userPrediction: '2:1' }), {
    session: confirmedSession,
    selectionOpen: true
  });
  assert.match(exactChange, /match-forecast-choice active" data-match-forecast-prediction="2:1"/);
  assert.doesNotMatch(exactChange, /Dein Tipp|match-forecast-own/);
  assert.doesNotMatch(exactChange, /data-match-forecast-change/);

  const quickChange = renderMatchForecast(data, forecast({ userVote: 1, userPrediction: '2:0' }), {
    session: confirmedSession,
    selectionOpen: true
  });
  assert.match(quickChange, /match-forecast-choice active" data-match-forecast-prediction="2:0"/);
});

test('guests see a dimmed aggregate with login, while closed and historical results cannot be changed', () => {
  const data = fixture();
  const guest = renderMatchForecast(data, forecast(), {});
  assert.match(guest, /is-guest-locked/);
  assert.match(guest, /data-auth-open>Einloggen, um zu tippen/);

  const unconfirmed = renderMatchForecast(data, forecast(), { session: { user: { id: 'u' } } });
  assert.match(unconfirmed, /data-auth-open>E-Mail bestätigen, um zu tippen/);

  const closed = renderMatchForecast(data, forecast({ open: false, userVote: 2, userPrediction: '1:2' }), {
    session: confirmedSession
  });
  assert.match(closed, /match-forecast-bar/);
  assert.doesNotMatch(closed, /Dein Tipp|match-forecast-own|Tipp ändern|match-forecast-choice/);

  const analysis = renderMatchForecast(fixture('analysis'), forecast({ mode: 'analysis', open: false }), {});
  assert.match(analysis, /75 %/);
  assert.doesNotMatch(analysis, /data-auth-open|Tipp ändern/);
  assert.equal(renderMatchForecast(fixture('basic'), forecast(), {}), '');
});

test('a player cannot tip their own match even when another viewer is selected', () => {
  const data = fixture();
  const ownMatch = renderMatchForecast(data, forecast(), {
    session: confirmedSession,
    profile: { player_id: 'greta_p' },
    selectedPlayerId: 'marco_m'
  });

  assert.match(ownMatch, /match-forecast-own-notice" role="status">Eigene Partie\. Kein Tipp möglich\./);
  assert.doesNotMatch(ownMatch, /data-match-forecast-prediction|data-match-forecast-change/);
});

test('a deliberately unavailable forecast stays hidden instead of showing a loading error', () => {
  const data = fixture();
  assert.equal(renderMatchForecast(data, null, {}), '');
  assert.match(renderMatchForecast(data, null, { message: 'Tipps werden geladen …' }), /Tipps werden geladen …/);
  assert.match(renderMatchForecast(data, { error: true }, {}), /Die Tipps konnten nicht geladen werden\./);
});

test('match cards use only a solid forecast line and homepage pending labels are removed', () => {
  const row = app.match(/function renderMatchRow\(m\) \{[\s\S]*?(?=\n\}\n\nfunction renderMatchdayGroup)/)?.[0] || '';
  const pendingRow = row.split('const t1w =')[0];
  const line = app.match(/function renderMatchForecastLine\(match\) \{[\s\S]*?(?=\n\}\n\nfunction renderMatchRow)/)?.[0] || '';
  const home = app.match(/function renderHomeMatchCard\(match, options = \{\}\) \{[\s\S]*?(?=\nfunction getCurrentArticle)/)?.[0] || '';
  assert.match(row, /statistics\?\.mode === 'preview' \? renderMatchForecastLine\(m\) : ''/);
  assert.doesNotMatch(pendingRow, /getPendingMatchLabel|statistics\?\.icon/);
  assert.match(line, /mc-forecast-line/);
  assert.doesNotMatch(line, /%<\/|mc-pending-label/);
  assert.doesNotMatch(home, /getPendingMatchLabel|renderMatchForecastLine/);
  assert.match(style, /\.mc-forecast-line \{[\s\S]*height: 4px;[\s\S]*border: 0;[\s\S]*background: transparent;/);
  assert.match(style, /\.mc-forecast-line::before,[\s\S]*width: calc\(50% - 1px\);[\s\S]*background: var\(--border\);/);
});

test('detail layout is three-column, borderless and responsive with centered mobile change action', () => {
  assert.match(statisticsStyle, /\.match-forecast \{[\s\S]*grid-template-columns: minmax\(150px, \.7fr\) minmax\(320px, 1\.6fr\) minmax\(150px, \.7fr\);/);
  assert.match(statisticsStyle, /\.match-forecast-choices \{[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);[\s\S]*gap: 4px;/);
  assert.match(statisticsStyle, /\.match-forecast-bar \{[\s\S]*height: 8px;[\s\S]*border: 0;[\s\S]*background: transparent;/);
  assert.match(statisticsStyle, /\.match-forecast-bar::before,[\s\S]*width: calc\(50% - 2px\);[\s\S]*background: var\(--border\);/);
  assert.match(statisticsStyle, /\.match-forecast-team-one \{ right: 50%; background: var\(--team-one\); \}/);
  assert.match(statisticsStyle, /\.match-forecast-team-two \{ left: 50%; background: var\(--team-two\); \}/);
  assert.match(statisticsStyle, /\.match-forecast-bar\.has-both-team-colors \.match-forecast-team-one \{ right: calc\(50% \+ 2px\); \}/);
  assert.match(statisticsStyle, /@media \(max-width: 768px\)[\s\S]*\.match-forecast \{[\s\S]*grid-template-columns: minmax\(0, 1fr\);[\s\S]*\.match-forecast-action \{[\s\S]*justify-self: center; \}/);
});

test('database contract replaces separate votes with exact predictions', () => {
  assert.match(initialMigration, /create table public\.match_forecast_votes/);
  assert.match(unificationMigration, /from public\.predictions as prediction/);
  assert.match(unificationMigration, /prediction\.prediction in \('2:0', '2:1'\)/);
  assert.match(unificationMigration, /prediction\.prediction in \('1:2', '0:2'\)/);
  assert.match(unificationMigration, /'userPrediction', selected_prediction/);
  assert.match(unificationMigration, /quick_prediction := case when p_team = 1 then '2:0' else '0:2' end/);
  assert.match(unificationMigration, /on conflict \(user_id, match_id\) do update/);
  assert.match(unificationMigration, /drop table public\.match_forecast_votes/);
  assert.match(unificationMigration, /drop function public\.submit_match_forecast_vote\(text,smallint\)/);
  assert.match(unificationMigration, /grant execute on function public\.submit_match_quick_prediction\(text,smallint\) to authenticated/);
  assert.match(exactChoicesMigration, /create or replace function public\.submit_match_quick_prediction\([\s\S]*p_prediction text/);
  assert.match(exactChoicesMigration, /p_prediction not in \('2:0', '2:1', '1:2', '0:2'\)/);
  assert.match(exactChoicesMigration, /values \(current_user_id, p_match_id, p_prediction\)/);
  assert.match(exactChoicesMigration, /grant execute on function public\.submit_match_quick_prediction\(text,text\) to authenticated/);
  assert.match(archivedForecastMigration, /not selected_season\.predictions_enabled[\s\S]*not exists \([\s\S]*from public\.predictions/);
  assert.match(statisticsSource, /client\.rpc\('submit_match_quick_prediction'/);
  assert.match(statisticsSource, /p_prediction: prediction/);
});

test('preview details render before their Padeltipp forecast is requested', () => {
  const open = statisticsSource.match(/async function open\(matchId,[\s\S]*?(?=\n  function prepareProfileOpen)/)?.[0] || '';
  const detailRequest = open.indexOf("client.rpc('get_public_match_detail'");
  const detailRender = open.indexOf("forecastMessage = 'Tipps werden geladen …'");
  const forecastRequest = open.indexOf('const forecast = await loadForecast');
  assert.ok(detailRequest >= 0 && detailRequest < detailRender);
  assert.ok(detailRender < forecastRequest);
  assert.match(open, /if \(direct\) return;[\s\S]*const forecast = await loadForecast/);
  assert.match(statisticsSource, /return data \?\? null;/);
});

test('forecast SQL shares exact tips, supports quick changes, cutoffs and archived reads', { skip: !process.env.PGLITE_MODULE }, async t => {
  const { PGlite } = require(process.env.PGLITE_MODULE);
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create schema auth; create schema private;
    create role anon; create role authenticated;
    create table auth.users(id uuid primary key, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table public.players(id text primary key);
    create table public.seasons(id text primary key, counts_for_profile boolean not null default true, tournament_mode text not null default 'none', predictions_enabled boolean not null default true);
    create table public.profiles(id uuid primary key references auth.users(id), app_role text not null default 'tipper');
    create table public.matches(
      id text primary key, season_id text not null references public.seasons(id), matchday integer,
      match_at timestamptz, match_type text not null default 'season', competition_stage text not null default 'league',
      format text not null default 'best-of-three', betting_open boolean not null default true,
      counts_for_elo boolean not null default true, cancelled_at timestamptz, winner smallint, actual_sets text
    );
    create table public.match_players(match_id text references public.matches(id), player_id text references public.players(id), team smallint, position smallint);
    create table public.predictions(
      user_id uuid not null references public.profiles(id), match_id text not null references public.matches(id),
      prediction text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      primary key(user_id,match_id)
    );
    create table public.season_matchdays(season_id text, matchday integer, starts_on date, ends_on date);
    create function private.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
    create function private.user_email_is_confirmed(p_user_id uuid) returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null)
    $$;
  `);
  await db.exec(initialMigration);
  await db.exec(unificationMigration);
  await db.exec(exactChoicesMigration);
  await db.exec(archivedForecastMigration);
  await db.exec(`
    insert into players values ('a'),('b'),('c'),('d');
    insert into seasons values
      ('season',true,'none',true),('cup',true,'knockout_redraw',true),
      ('disabled',true,'none',false),('test-2026',false,'none',false);
    insert into season_matchdays values ('season',1,current_date-1,current_date+1);
    insert into matches(id,season_id,matchday,match_at,match_type,competition_stage,cancelled_at) values
      ('match','season',1,now()+interval '1 day','season','league',null),
      ('basic','season',5,null,'season','league',null),
      ('training','season',1,null,'training','league',null),
      ('final-four','season',1,null,'final','final_four',null),
      ('cancelled','season',1,null,'season','league',now()),
      ('incomplete','season',1,null,'season','league',null),
      ('disabled','disabled',1,now()+interval '1 day','season','league',null),
      ('archived-disabled','disabled',1,now()-interval '2 days','season','league',null),
      ('test','test-2026',1,now()+interval '1 day','season','league',null),
      ('cup-quarterfinal','cup',null,null,'season','quarterfinal',null),
      ('cup-final','cup',null,null,'final','final',null);
    insert into match_players
      select match_id, player_id, team, position
      from (values ('a',1,1),('b',1,2),('c',2,1),('d',2,2)) players(player_id,team,position)
      cross join (values ('match'),('basic'),('training'),('final-four'),('cancelled'),('disabled'),('archived-disabled'),('test'),('cup-quarterfinal'),('cup-final')) matches(match_id);
    insert into match_players values ('incomplete','a',1,1),('incomplete','b',1,2),('incomplete','c',2,1);
    insert into auth.users values
      ('00000000-0000-0000-0000-000000000001',now()),
      ('00000000-0000-0000-0000-000000000002',now()),
      ('00000000-0000-0000-0000-000000000003',now()),
      ('00000000-0000-0000-0000-000000000004',null),
      ('00000000-0000-0000-0000-000000000005',now());
    insert into profiles values
      ('00000000-0000-0000-0000-000000000001','tipper'),
      ('00000000-0000-0000-0000-000000000002','player'),
      ('00000000-0000-0000-0000-000000000003','admin'),
      ('00000000-0000-0000-0000-000000000004','tipper'),
      ('00000000-0000-0000-0000-000000000005','tipper');
    select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
  `);
  const mode = async matchId => (await db.query('select private.match_forecast_mode($1) mode', [matchId])).rows[0].mode;
  assert.equal(await mode('match'), 'preview');
  assert.equal(await mode('basic'), 'basic');
  for (const matchId of ['training', 'final-four', 'cancelled', 'incomplete']) assert.equal(await mode(matchId), null);
  assert.equal(await mode('disabled'), null);
  assert.equal(await mode('test'), 'preview');
  assert.equal(await mode('cup-quarterfinal'), 'preview');
  assert.equal(await mode('cup-final'), 'basic');

  let state = (await db.query("select public.submit_match_quick_prediction('test','2:1') state")).rows[0].state;
  assert.equal(state.userPrediction, '2:1');

  await db.exec("update matches set winner=2,actual_sets='0:2',betting_open=false where id='archived-disabled'");
  await db.exec("insert into predictions(user_id,match_id,prediction) values ('00000000-0000-0000-0000-000000000002','archived-disabled','1:2')");
  assert.equal(await mode('archived-disabled'), 'analysis');
  state = (await db.query("select public.get_public_match_forecast('archived-disabled') state")).rows[0].state;
  assert.equal(state.open, false);
  assert.equal(state.totalVotes, 1);
  assert.equal(state.team2Percentage, 100);

  state = (await db.query("select public.submit_match_quick_prediction('match','2:0') state")).rows[0].state;
  assert.equal(state.userVote, 1);
  assert.equal(state.userPrediction, '2:0');
  assert.equal(state.team1Percentage, 100);
  state = (await db.query("select public.submit_match_quick_prediction('match','2:1') state")).rows[0].state;
  assert.equal(state.userVote, 1);
  assert.equal(state.userPrediction, '2:1');
  state = (await db.query("select public.submit_match_quick_prediction('match','1:2') state")).rows[0].state;
  assert.equal(state.userVote, 2);
  assert.equal(state.userPrediction, '1:2');
  state = (await db.query("select public.submit_match_quick_prediction('match','0:2') state")).rows[0].state;
  assert.equal(state.userVote, 2);
  assert.equal(state.userPrediction, '0:2');
  assert.equal((await db.query("select count(*)::int count from predictions where match_id='match'")).rows[0].count, 1);

  await db.exec(`insert into predictions(user_id,match_id,prediction) values
    ('00000000-0000-0000-0000-000000000002','match','2:0'),
    ('00000000-0000-0000-0000-000000000003','match','2:1'),
    ('00000000-0000-0000-0000-000000000005','match','1:2')`);
  state = (await db.query("select public.get_public_match_forecast('match') state")).rows[0].state;
  assert.equal(state.totalVotes, 4);
  assert.equal(state.team1Percentage, 50);
  assert.equal(state.team2Percentage, 50);

  await db.query("select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false)");
  await assert.rejects(
    db.query("select public.submit_match_quick_prediction('match','2:0')"),
    /E-Mail-Adresse bestätigen/
  );
  await db.query("select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false)");

  await db.exec("update matches set match_at=now()-interval '1 minute' where id='match'");
  await assert.rejects(db.query("select public.submit_match_quick_prediction('match','2:0')"), /bereits beendet/);
  await db.exec("update matches set match_at=null where id='match'");
  state = (await db.query("select public.submit_match_quick_prediction('match','2:0') state")).rows[0].state;
  assert.equal(state.open, true);
  assert.equal(state.userVote, 1);
  assert.equal(state.userPrediction, '2:0');
  await db.exec("update matches set match_at=now()+interval '2 days' where id='match'");
  state = (await db.query("select public.submit_match_quick_prediction('match','2:1') state")).rows[0].state;
  assert.equal(state.open, true);
  assert.equal(state.userVote, 1);

  await db.exec("update matches set winner=1,actual_sets='2:0' where id='match'");
  state = (await db.query("select public.get_public_match_forecast('match') state")).rows[0].state;
  assert.equal(state.mode, 'analysis');
  assert.equal(state.open, false);
  assert.equal(state.team1Percentage, 75);

  assert.equal((await db.query("select to_regclass('public.match_forecast_votes') name")).rows[0].name, null);
  assert.equal((await db.query("select to_regprocedure('public.submit_match_forecast_vote(text,smallint)') name")).rows[0].name, null);
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.exec('set role anon');
  try {
    const publicState = (await db.query("select public.get_public_match_forecast('match') state")).rows[0].state;
    assert.equal(publicState.userVote, null);
    assert.equal(publicState.userPrediction, null);
    await assert.rejects(
      db.query("select public.submit_match_quick_prediction('match','2:0')"),
      /permission denied/
    );
  } finally {
    await db.exec('reset role');
  }
});
