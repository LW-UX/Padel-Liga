const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
// Optional local PostgreSQL runtime. Never connects to or writes a project database.
test('match history migration enforces access, scores, revisions and stale-history hiding', { skip: !process.env.PADEL_PGLITE_MODULE }, async () => {
 const { PGlite } = await import(pathToFileURL(process.env.PADEL_PGLITE_MODULE).href);
 const db = new PGlite();
 try {
  await db.exec(`
   create role anon; create role authenticated;
   create schema private; create schema auth;
   create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   create table public.profiles(id uuid primary key,app_role text);
   create table public.matches(id text primary key,competition_stage text,match_type text,cancelled_at timestamptz,winner smallint,actual_sets text,format text,result_details text);
   create table public.match_players(match_id text,player_id text,team integer,position integer);
   create function private.validate_result_for_format(text,text,text,smallint) returns void language plpgsql as $$ begin return; end; $$;
   create function public.get_public_match_detail(p_match_id text) returns jsonb language sql stable as $$
    select jsonb_build_object('availability','analysis','stage',competition_stage,'result',result_details) from public.matches where id=p_match_id $$;
   insert into auth.users values ('00000000-0000-0000-0000-000000000001',now()),('00000000-0000-0000-0000-000000000002',null);
   insert into public.profiles values ('00000000-0000-0000-0000-000000000001','admin'),('00000000-0000-0000-0000-000000000002','admin');
   insert into public.matches values ('m','league','season',null,1,'2:0','best-of-three','6:0, 6:0');
   insert into public.match_players values ('m','a',1,1),('m','b',1,2),('m','c',2,1),('m','d',2,2);
  `);
  await db.exec(fs.readFileSync(path.resolve(__dirname,'../supabase/migrations/20261113120000_league_match_history.sql'),'utf8'));
  const part=winners=>({winners,servers:winners.map(()=>null),points:[]});
  let sections=[part(Array(6).fill(1)),part(Array(6).fill(1))];
  const save=(sections,version=0,reason='Nachtrag')=>db.query('select public.admin_save_match_history($1,$2::jsonb,$3,$4) value',['m',JSON.stringify(sections),reason,version]);
  const detail=async()=> (await db.query("select public.get_public_match_detail('m') value")).rows[0].value;
  assert.equal((await detail()).historyVersion,0);
  await assert.rejects(save(sections),/bestätigte Admins/);
  await db.exec("set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002'");
  await assert.rejects(save(sections),/bestätigte Admins/);
  await db.exec("set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001'");
  await assert.rejects(save(sections,0,'x'),/Grund/);
  await assert.rejects(save([sections[0]]),/alle Sätze/);
  await assert.rejects(save([part([1,1]),sections[1]]),/Endstand/);
  const unknown=structuredClone(sections);unknown[0].servers[0]='unknown';
  await assert.rejects(save(unknown),/Aufschläger/);
  const bad=structuredClone(sections);bad[0].winners.push(2);bad[0].servers.push(null);
  await assert.rejects(save(bad),/Satzende/);
  const invalid=structuredClone(sections);invalid[0].winners[0]='1';
  await assert.rejects(save(invalid),/Ungültiger Gewinn/);
  await assert.rejects(save(null),/Ungültiger Verlauf/);
  await save(sections);
  assert.deepEqual((await detail()).matchHistory.sections,sections);
  await assert.rejects(save(sections),/inzwischen geändert/);
  await save(sections,1,'Korrektur');
  assert.equal((await detail()).historyVersion,2);
  assert.equal((await db.query('select count(*)::int n from private.league_match_history')).rows[0].n,2);
  await db.exec("update public.match_players set player_id='e' where player_id='a'");
  assert.equal((await detail()).matchHistory,null);
  await db.exec("update public.match_players set player_id='a' where player_id='e'; update public.matches set result_details='6:0, 0:6 – 10:0',actual_sets='2:1'");
  assert.equal((await detail()).matchHistory,null);
  sections=[part(Array(6).fill(1)),part(Array(6).fill(2)),part(Array(10).fill(1))];
  await save(sections,2);
  const tbServer=structuredClone(sections);tbServer[2].servers[0]='a';
  await assert.rejects(save(tbServer,3),/Aufschläger/);
  const late=structuredClone(sections);late[2]=part([...Array(10).fill(1),2]);
  await assert.rejects(save(late,3),/Satzende/);
  await db.exec("update public.matches set result_details='7:6 (7:5), 6:0',actual_sets='2:0'");
  sections=[part([1,2,1,2,1,2,1,2,1,2,1,2,1]),part(Array(6).fill(1))];
  await save(sections,3);
  sections[0].points=[1,2,1,2,1,2,1,2,1,2,1];
  await assert.rejects(save(sections,4),/Endstand/);
  sections[0].points.push(1);
  await save(sections,4);
  sections[0].servers[12]='a';
  await assert.rejects(save(sections,5),/Aufschläger/);
  await db.exec("set role anon");
  await assert.rejects(db.query("select public.admin_save_match_history('m','[]','Grund',5)"),/permission denied/);
  await assert.rejects(db.query('select * from private.league_match_history'),/permission denied/);
  await assert.rejects(db.query("select private.get_public_match_detail_without_game_history('m')"),/permission denied/);
  assert.equal((await detail()).historyVersion,5);
  await db.exec(`reset role;
   alter table public.profiles add column player_id text;
   update public.profiles set player_id='ludwig_w' where id='00000000-0000-0000-0000-000000000001';
   insert into public.matches values
    ('winter-2026-partie-1','league','season',null,1,'2:0','best-of-three','6:4, 6:0'),
    ('winter-2026-partie-9','league','season',null,1,'2:0','best-of-three','6:2, 6:3');
   insert into public.match_players values
    ('winter-2026-partie-1','ludwig_w',1,1),('winter-2026-partie-1','florian_z',1,2),
    ('winter-2026-partie-1','luca_w',2,1),('winter-2026-partie-1','christoph_l',2,2),
    ('winter-2026-partie-9','jonas_l',1,1),('winter-2026-partie-9','ludwig_w',1,2),
    ('winter-2026-partie-9','andreas_l',2,1),('winter-2026-partie-9','chris_m',2,2);
  `);
  const importSql=fs.readFileSync(path.resolve(__dirname,'../tools/import-winter-2026-match-histories.sql'),'utf8');
  await db.exec(importSql);
  const imported=(await db.query("select match_id,sections from private.league_match_history where match_id like 'winter-%' order by match_id")).rows;
  assert.equal(imported.length,2);
  const scoring=require('../js/match-history.js');
  for(const row of imported){
   const result=row.match_id.endsWith('-1')?'6:4, 6:0':'6:2, 6:3';
   const players=(await db.query('select player_id as "playerId" from public.match_players where match_id=$1',[row.match_id])).rows;
   assert.ok(scoring.validate(result,row.sections,players));
  }
  assert.deepEqual(imported[0].sections[0].servers.slice(0,4),['florian_z','christoph_l','ludwig_w','luca_w']);
  assert.deepEqual(imported[1].sections[1].winners,[1,1,2,1,1,1,2,2,1]);
  await assert.rejects(db.exec(importSql),/bereits ein Verlauf/);
  await db.exec('rollback');

 } finally { await db.close(); }
});
