const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repositoryRoot = path.join(__dirname, '..');
function loadWindowScript(file) {
  const window = {};
  const source = fs.readFileSync(path.join(repositoryRoot, file), 'utf8');
  vm.runInNewContext(source, { window });
  return window;
}

test('Winter 2026 is the repository default season', () => {
  const { PADEL_SEASONS } = loadWindowScript('data/seasons.js');
  const { PADEL_SEASON } = loadWindowScript('data/data-2026-winter.js');

  assert.equal(PADEL_SEASONS.find(season => season.default)?.id, '2026-winter');
  assert.equal(PADEL_SEASON.id, '2026-winter');
  assert.equal(PADEL_SEASON.label, 'Winter 2026');
  assert.equal(PADEL_SEASON.startDate, '2026-11-02');
  assert.deepEqual(
    JSON.parse(JSON.stringify(PADEL_SEASON.competition)),
    {
      tournamentMode: 'top8-semifinals',
      qualificationPlaces: 8,
      homeRankingLimit: 4,
      regularScheduleLocked: true,
      predictionsEnabled: true
    }
  );
  assert.equal(PADEL_SEASON.matches.length, 35);
  assert.equal(PADEL_SEASON.matchdays.length, 8);
});

test('Winter contains two semifinals and the three rotating Final Four sets', () => {
  const { PADEL_SEASON } = loadWindowScript('data/data-2026-winter.js');
  const semifinals = PADEL_SEASON.matches.filter(match => match.stage === 'semifinal');
  const finalFour = PADEL_SEASON.matches.filter(match => match.stage === 'final-four');

  assert.deepEqual(
    JSON.parse(JSON.stringify(semifinals.map(match => [
      match.team1.qualifierRanks,
      match.team2.qualifierRanks,
      match.format
    ]))),
    [[[1, 2], [7, 8], 'best-of-three'], [[3, 4], [5, 6], 'best-of-three']]
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(finalFour.map(match => [
      match.team1.qualifierRanks,
      match.team2.qualifierRanks,
      match.format
    ]))),
    [
      [[1, 2], [3, 4], 'single-set'],
      [[1, 4], [2, 3], 'single-set'],
      [[1, 3], [2, 4], 'single-set']
    ]
  );
});

test('Winter 2026 fallback matches the confirmed roster migration', () => {
  const { PADEL_SEASON } = loadWindowScript('data/data-2026-winter.js');
  const migration = fs.readFileSync(
    path.join(repositoryRoot, 'supabase/migrations/20261021120000_winter_2026_participants.sql'),
    'utf8'
  );
  const eloCorrection = fs.readFileSync(
    path.join(repositoryRoot, 'supabase/migrations/20261026133000_set_winter_new_player_elos.sql'),
    'utf8'
  );
  const correctedStartElos = new Map(
    [...eloCorrection.matchAll(/\('([a-z_]+)', (\d+)\)/g)]
      .map(([, playerId, startElo]) => [playerId, Number(startElo)])
  );
  const migrationParticipants = [...migration.matchAll(/\('([a-z_]+)', (\d+)\)/g)]
    .map(([, playerId, startElo]) => ({
      playerId,
      startElo: correctedStartElos.get(playerId) ?? Number(startElo)
    }));

  assert.equal(PADEL_SEASON.participants.length, 20);
  assert.deepEqual(
    [...correctedStartElos.entries()],
    [['christian_h', 550], ['lisa_s', 550], ['lukas_t', 550], ['yonatan_g', 550]]
  );
  assert.deepEqual(JSON.parse(JSON.stringify(PADEL_SEASON.participants)), migrationParticipants);
});

test('Winter 2026 fallback schedule matches the regular schedule migration', () => {
  const { PADEL_SEASON } = loadWindowScript('data/data-2026-winter.js');
  const migration = fs.readFileSync(
    path.join(repositoryRoot, 'supabase/migrations/20261022120000_winter_2026_regular_schedule.sql'),
    'utf8'
  );
  const migrationTeams = new Map();
  for (const [, matchId, playerId, team, position] of migration.matchAll(/\('(winter-2026-partie-\d+)', '([a-z_]+)', ([12]), ([12])\)/g)) {
    if (!migrationTeams.has(matchId)) migrationTeams.set(matchId, { 1: [], 2: [] });
    migrationTeams.get(matchId)[team][Number(position) - 1] = playerId;
  }
  const migrationMatchdays = Object.fromEntries(
    [...migration.matchAll(/\('(winter-2026-partie-\d+)', (\d), '/g)].map(([, matchId, matchday]) => [matchId, Number(matchday)])
  );
  const leagueMatches = PADEL_SEASON.matches.filter(match => match.stage === 'league');
  const participantIds = new Set(PADEL_SEASON.participants.map(participant => participant.playerId));
  const matchCounts = new Map();

  assert.equal(leagueMatches.length, 30);
  assert.equal(migrationTeams.size, 30);
  for (const match of leagueMatches) {
    assert.deepEqual([...match.team1.playerIds], migrationTeams.get(match.id)[1]);
    assert.deepEqual([...match.team2.playerIds], migrationTeams.get(match.id)[2]);
    assert.equal(match.matchday, migrationMatchdays[match.id]);
    for (const playerId of [...match.team1.playerIds, ...match.team2.playerIds]) {
      assert.ok(participantIds.has(playerId));
      matchCounts.set(playerId, (matchCounts.get(playerId) || 0) + 1);
    }
  }
  assert.equal(matchCounts.size, 20);
  assert.ok([...matchCounts.values()].every(count => count === 6));
  assert.deepEqual(
    [...PADEL_SEASON.matches.filter(match => match.stage !== 'league').map(match => match.matchday)],
    [7, 7, 8, 8, 8]
  );
});

test('the cleanup removes Winter participants and the automation keeps Sommer active', () => {
  const cleanupMigration = fs.readFileSync(
    path.join(repositoryRoot, 'supabase/migrations/20260922110000_clear_winter_2026_players.sql'),
    'utf8'
  );
  const automationMigration = fs.readFileSync(
    path.join(repositoryRoot, 'supabase/migrations/20260902120000_season_tournament_automation.sql'),
    'utf8'
  );

  assert.match(cleanupMigration, /delete from public\.season_players\s+where season_id = 'winter-2026'/);
  assert.match(automationMigration, /tournament_mode = 'direct_final_four'[\s\S]*is_active = true[\s\S]*where id = '2026'/);
  assert.match(automationMigration, /tournament_mode = 'top8_semifinals'[\s\S]*regular_schedule_locked = false[\s\S]*is_active = false[\s\S]*where id = 'winter-2026'/);
});

test('the test season is hidden from pickers but remains available by direct URL', () => {
  const { PADEL_SEASONS } = loadWindowScript('data/seasons.js');
  const testSeason = PADEL_SEASONS.find(season => season.id === '2026-test');
  const app = fs.readFileSync(path.join(repositoryRoot, 'js/app.js'), 'utf8');
  const tipPage = fs.readFileSync(path.join(repositoryRoot, 'js/tipp-page.js'), 'utf8');

  assert.equal(testSeason.hidden, true);
  assert.match(app, /getAllSeasonOptions\(\)\.filter\(season => !season\.hidden\)/);
  assert.match(app, /getAllSeasonOptions\(\)\.find\(season => season\.id === requestedSeasonId\)/);
  assert.match(tipPage, /getAllSeasonOptions\(\)\.filter\(option => !option\.hidden\)/);
  assert.match(tipPage, /getAllSeasonOptions\(\)\.find\(option => option\.id === requested\)/);
});
