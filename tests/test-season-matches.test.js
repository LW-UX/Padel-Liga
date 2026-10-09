const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'data', 'data-test-2026.js'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260922130000_reset_test_season_roster.sql'),
  'utf8'
);
const openMatchMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261008140000_add_open_test_matchday_three.sql'),
  'utf8'
);

const context = { window: {} };
vm.runInNewContext(source, context);
const season = context.window.PADEL_SEASON;

test('test season contains five clean matches including an open matchday three', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(season.matches.map(match => match.id))),
    Array.from({ length: 5 }, (_, index) => `test-2026-partie-${index + 1}`)
  );
  assert.ok(season.matches.every(match => (
    match.result === null && match.sets === null && match.winner === null
  )));
  assert.match(migration, /delete from public\.matches[\s\S]*id not in/);
  assert.match(migration, /delete from public\.result_proposals/);
  assert.match(migration, /delete from public\.match_elo_changes/);
  assert.deepEqual(JSON.parse(JSON.stringify(season.matchdays.at(-1))), {
    spieltag: 3,
    startDate: '2026-10-05',
    endDate: '2026-10-09'
  });
  assert.match(openMatchMigration, /values \('test-2026', 3, null, null, null\)/);
  assert.match(openMatchMigration, /'test-2026-partie-5'[\s\S]*'league'[\s\S]*'best-of-three'[\s\S]*null/);
  assert.match(openMatchMigration, /public\.profiles[\s\S]*profile\.player_id = any\(expected_players\)/);
});

test('all test matches use only the four test players with GMX and Gmail opposing', () => {
  const expectedPlayers = ['ludi_gmail', 'ludi_gmx', 'ludi_ionos', 'ludwig_w'];
  const participantIds = JSON.parse(JSON.stringify(
    season.participants.map(participant => participant.playerId).sort()
  ));

  assert.deepEqual(participantIds, expectedPlayers);

  season.matches.forEach(match => {
    const playerIds = JSON.parse(JSON.stringify(
      [...match.team1.playerIds, ...match.team2.playerIds].sort()
    ));
    const gmxTeam = match.team1.playerIds.includes('ludi_gmx') ? 1 : 2;
    const gmailTeam = match.team1.playerIds.includes('ludi_gmail') ? 1 : 2;

    assert.deepEqual(playerIds, expectedPlayers, match.id);
    assert.notEqual(gmxTeam, gmailTeam, match.id);
  });
});
