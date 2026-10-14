const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261013100000_public_match_statistics.sql'), 'utf8');
const rankingSizeMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261013110000_match_statistics_ranking_size.sql'), 'utf8');
const qualificationPlacesMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261013120000_match_statistics_qualification_places.sql'), 'utf8');
const fullRankingMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261014100000_match_statistics_full_ranking.sql'), 'utf8');
const testSeasonMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261014110000_test_season_match_statistics.sql'), 'utf8');
const testShowcaseMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261014120000_test_match_statistics_showcase.sql'), 'utf8');
const rankChangesMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261014130000_match_statistics_rank_changes.sql'), 'utf8');
const analysisEloRangesMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261014140000_match_statistics_analysis_elo_ranges.sql'), 'utf8');
const favoriteThresholdMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261014150000_match_statistics_favorite_threshold.sql'), 'utf8');
const migrations = fs.readdirSync(path.join(root, 'supabase/migrations')).sort().filter(f => f < '20261013100000');
test('result impact migration uses inclusive 45 and 55 percent boundaries',()=>{
  assert.match(favoriteThresholdMigration,/value\s*<=\s*0\.45\b/);
  assert.match(favoriteThresholdMigration,/value\s*>=\s*0\.55\b/);
});
function existingFunction(name) {
  let found;
  for (const file of migrations) {
    const source = fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8');
    const regex = new RegExp('create or replace function private\\.' + name + '\\([\\s\\S]*?\\$\\$;', 'g');
    for (const match of source.matchAll(regex)) found = match[0];
  }
  assert.ok(found, name);
  return found;
}
const schema = `
create schema private;
create role anon; create role authenticated;
create table public.players(id text primary key, display_name text, company text, initial_elo integer);
create table public.seasons(id text primary key,label text,counts_for_profile boolean default true,tournament_mode text default 'top4',qualification_places integer default 4);
create table public.matches(id text primary key,season_id text,league_id text default 'main',matchday integer default 1,match_at timestamptz,match_type text default 'season',competition_stage text default 'league',format text default 'best-of-three',counts_for_elo boolean default true,counts_for_ranking boolean default true,cancelled_at timestamptz,winner integer,actual_sets text,result_details text,display_label text);
create table public.match_players(match_id text, player_id text, team integer,position integer);
create table public.season_players(season_id text, player_id text,league_id text default 'main',start_elo integer);
create table public.season_matchdays(season_id text,matchday integer,starts_on date,ends_on date);
create table public.match_elo_changes(match_id text,player_id text,old_elo integer,new_elo integer);
create table public.training_sessions(id bigint,played_on date,display_time time,player_ids text[],status text);
create table public.training_rounds(session_id bigint,round_number integer,team_one_ids text[],team_two_ids text[],result_details text,is_complete boolean);
`;
async function addMatch(db,id,{ season='season', at=null,winner=null,stage='league',day=1,elo=true,ranking=true }={}) {
  await db.query('insert into matches(id,season_id,match_at,winner,actual_sets,result_details,competition_stage,matchday,counts_for_elo,counts_for_ranking) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,season,at,winner,winner===1?'2:0':winner===2?'0:2':null,winner===1?'6:2, 6:2':winner===2?'2:6, 2:6':null,stage,day,elo,ranking]);
  await db.query("insert into match_players select $1,id,case when id in ('a','b') then 1 else 2 end,case when id in ('a','c') then 1 else 2 end from players where id in ('a','b','c','d')",[id]);
}
test('match detail SQL: historical isolation, eligibility, calculations and public permissions', { skip: !process.env.PGLITE_MODULE }, async t => {
  const { PGlite } = require(process.env.PGLITE_MODULE);
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(schema);
  for (const name of ['training_regular_set_state','training_tiebreak_state','profile_regular_game_totals','profile_training_metrics']) await db.exec(existingFunction(name));
  // Profile wrapper's existing dependency is stubbed only for its JSON decoration test.
  await db.exec("create function private.get_player_profile_base_without_cancellation(text) returns jsonb language sql as $$ select jsonb_build_object('matches', coalesce(jsonb_agg(jsonb_build_object('id',id,'date',match_at::date)), '[]'::jsonb)) from public.matches $$;");
  await db.exec(migration);
  await db.exec(rankingSizeMigration);
  await db.exec(qualificationPlacesMigration);
  await db.exec(fullRankingMigration);
  await db.exec(testSeasonMigration);
  await db.exec(testShowcaseMigration);
  await db.exec(rankChangesMigration);
  await db.exec(analysisEloRangesMigration);
  await db.exec(favoriteThresholdMigration);
  await db.exec(`insert into players values ('a','Anna','One',800),('b','Ben','One',800),('c','Chris','Two',800),('d','Dana','Two',800),('e','Emil','Three',800),('f','Frida','Three',800);
    insert into seasons(id,label) values('season','Saison');
    insert into season_players select 'season',id,'main',1100 from players;
    insert into season_matchdays select 'season',i,current_date+(i-1)*14,current_date+i*14-1 from generate_series(1,6) i;`);
  const detail = async id => (await db.query('select public.get_public_match_detail($1) d',[id])).rows[0].d;
  await addMatch(db,'preview');
  let d=await detail('preview');
  assert.equal(d.availability,'preview'); assert.equal(d.qualificationPlaces,4); assert.equal(d.players[0].elo.before,1100,'season start, never global initial 800'); assert.equal(d.players[0].statistics.tableSize,6);
  assert.equal(d.ranking.length,6); assert.deepEqual(d.ranking.map(player=>player.playerId),['a','b','c','d','e','f']);
  assert.equal(d.probability,0.5); assert.equal(d.players[0].elo.winMin,1150);
  assert.ok(d.players[0].elo.lossMin<d.players[0].elo.lossMax);
  await addMatch(db,'far',{day:6}); assert.equal((await detail('far')).availability,'basic');
  await db.exec("update matches set match_at=now()+interval '100 days' where id='far'"); assert.equal((await detail('far')).availability,'preview');
  await addMatch(db,'overdue',{day:0}); await db.exec("insert into season_matchdays values ('season',0,current_date-28,current_date-15)");
  assert.equal((await detail('overdue')).availability,'preview');
  for (const [id,options] of [['ff',{stage:'final_four'}],['nonelo',{elo:false}],['semi',{stage:'semifinal'}]]) { await addMatch(db,id,options); assert.equal(await detail(id),null,id); }
  await db.exec("update matches set cancelled_at=now() where id='overdue'"); assert.equal(await detail('overdue'),null);
  await addMatch(db,'played',{at:'2026-01-05T12:00Z',winner:1});
  await db.exec("insert into match_elo_changes select 'played',id,1100,case when id in ('a','b') then 1150 else 1050 end from players");
  const original=await detail('played'); assert.equal(original.availability,'analysis'); assert.equal(original.players[0].statistics.points,3); assert.equal(original.players[0].elo.after,1150);
  assert.equal(original.players[0].elo.winMin,1150); assert.equal(original.players[0].elo.winMax,1185);
  assert.equal(original.players[0].elo.lossMin,1015); assert.equal(original.players[0].elo.lossMax,1050);
  assert.ok(original.ranking.every(player=>Number.isInteger(player.statistics.previousRank)));
  assert.ok(original.ranking.some(player=>player.statistics.previousRank!==player.statistics.rank));
  assert.ok(!original.impacts.some(i=>i.kind==='leaderGained'),'equally ranked teammates are not sole leaders');
  await addMatch(db,'later',{at:'2026-02-01T12:00Z',winner:2});
  await db.exec("insert into match_elo_changes select 'later',id,1100,1300 from players");
  const later=await detail('played'); delete later.generatedAt; delete original.generatedAt; assert.deepEqual(later,original,'later games must not leak into old analysis');
  // Three official wins create a relationship and a streak; reversed side order still forms a rematch.
  for(let i=1;i<=3;i++) await addMatch(db,`earlier-${i}`,{at:`2026-01-0${i}T12:00Z`,winner:1});
  d=await detail('played');
  assert.equal(d.players[0].streak.length,4); assert.ok(d.players[0].relationships.some(r=>r.kind==='successPartner'&&r.playerId==='b'));
  assert.equal(d.rematches.length,3); assert.equal(d.company.wins1,4);
  await db.exec("update matches set winner=2,actual_sets='0:2',result_details='2:6, 2:6' where id='earlier-3'");
  d=await detail('played'); assert.equal(d.players[0].streak.length,1); assert.equal(d.company.wins1,3); assert.equal(d.company.wins2,1);
  // Non-Elo analysis is still historical, but cannot expose a fake Elo prediction.
  await addMatch(db,'played-nonelo',{at:'2026-01-06T12:00Z',winner:1,elo:false}); d=await detail('played-nonelo'); assert.equal(d.probability,null); assert.equal(d.players[0].elo,null);
  await db.exec("insert into seasons values('cup','Cup',true,'knockout_redraw',0); insert into season_players select 'cup',id,'main',1100 from players");
  await addMatch(db,'cup-q',{season:'cup',stage:'quarterfinal',ranking:false}); d=await detail('cup-q'); assert.equal(d.availability,'preview'); assert.equal(d.players[0].statistics.rank,undefined); assert.equal(d.players[0].statistics.points,undefined);
  await addMatch(db,'cup-later',{season:'cup',stage:'final',ranking:false});
  await db.exec("insert into season_matchdays values ('cup',1,current_date,current_date+14)");
  assert.equal((await detail('cup-later')).availability,'basic','Cup preview follows its active round, not league matchday windows');
  await addMatch(db,'cup-empty',{season:'cup',stage:'final'}); await db.exec("delete from match_players where match_id='cup-empty' and player_id='d'"); assert.equal(await detail('cup-empty'),null);
  await db.exec("insert into seasons values('hidden','Test',false,'top4',4)"); await addMatch(db,'hidden-match',{season:'hidden'}); assert.equal(await detail('hidden-match'),null);
  // The named hidden test season has a self-contained history and Elo replay.
  // It must neither consume nor affect the official history of the same players.
  const officialBeforeTest=await detail('played');
  await db.exec("insert into seasons values('2026-test','Test-Saison',false,'none',3); insert into season_players select '2026-test',id,'main',900 from players where id in ('a','b','c','d')");
  for(let i=1;i<=3;i++) await addMatch(db,`test-history-${i}`,{season:'2026-test',at:`2026-03-0${i}T12:00Z`,winner:1});
  await db.query("select private.recalculate_test_match_elo('2026-test')");
  await addMatch(db,'test-2026-partie-6',{season:'2026-test'});
  const testPreview=await detail('test-2026-partie-6');
  assert.equal(testPreview.availability,'preview');
  assert.equal(testPreview.qualificationPlaces,3);
  assert.equal(testPreview.company.kind,'duel');
  assert.equal(testPreview.company.team1,'Testbetrieb Nord');
  assert.equal(testPreview.rematches.length,3);
  assert.equal(testPreview.players[0].streak.length,3);
  assert.ok(testPreview.players[0].relationships.some(relationship=>relationship.kind==='successPartner'&&relationship.playerId==='b'));
  assert.ok(testPreview.players[0].elo.before>900);
  assert.ok(testPreview.players[0].elo.winMax>testPreview.players[0].elo.before);
  const officialAfterTest=await detail('played');
  assert.equal(officialAfterTest.rematches.length,officialBeforeTest.rematches.length);
  assert.equal(officialAfterTest.players[0].streak.length,officialBeforeTest.players[0].streak.length);
  await db.exec("update matches set winner=1,actual_sets='2:0',result_details='6:0, 6:0' where season_id='season' and competition_stage='league' and winner is null and cancelled_at is null");
  assert.equal((await detail('semi')).availability,'preview');
  const profile=(await db.query("select public.get_player_profile('a') d")).rows[0].d;
  assert.equal(profile.matches.find(m=>m.id==='played').hasMatchStatistics,true);
  assert.equal(profile.matches.find(m=>m.id==='ff').hasMatchStatistics,false);
  assert.equal(profile.matches.find(m=>m.id==='overdue').hasMatchStatistics,false);
  assert.equal(profile.matches.find(m=>m.id==='overdue').date,null);
  // Training changes relationship weights, but never official streaks.
  await db.exec("insert into training_sessions values(1,'2026-01-04','10:00',array['a','b','c','d'],'confirmed'); insert into training_rounds values(1,1,array['a','b'],array['c','d'],'6:1',true)");
  d=await detail('played'); const rel=d.players[0].relationships.find(r=>r.kind==='successPartner'); assert.equal(rel.matches,4.5); assert.equal(rel.wins,3.5); assert.equal(d.players[0].streak.length,1);
  const changedRoles=(await db.query("select private.match_detail_relationships('a','c',array['b','d'],'2026-01-06','next',false) d")).rows[0].d;
  assert.ok(!changedRoles.some(r=>r.kind==='successPartner'&&r.playerId==='b'),'former partner is not a success partner when playing on the opposing team');
  for(const [chance,kind] of [[0.45,'upset'],[0.45001,null],[0.54999,null],[0.55,'favoriteConfirmed']]) {
    const impact=(await db.query('select private.match_detail_result_impact(1,$1) d',[chance])).rows[0].d;
    assert.equal(impact?.kind??null,kind);
  }
  const started=performance.now(); for(let i=0;i<5;i++) await detail('played');
  t.diagnostic(`Local SQL, average of 5 warm reads: ${Math.round((performance.now()-started)/5)} ms`);
  await db.exec("set role anon"); assert.equal((await detail('played')).availability,'analysis');
  await assert.rejects(db.query("select private.match_detail_elo('a','season',now(),'x',false)"),/permission denied/);
});
