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

const context = { window: {} };
vm.runInNewContext(source, context);
const season = context.window.PADEL_SEASON;

test('test season contains exactly four clean matches', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(season.matches.map(match => match.id))),
    Array.from({ length: 4 }, (_, index) => `test-2026-partie-${index + 1}`)
  );
  assert.ok(season.matches.every(match => (
    match.result === null && match.sets === null && match.winner === null
  )));
  assert.match(migration, /delete from public\.matches[\s\S]*id not in/);
  assert.match(migration, /delete from public\.result_proposals/);
  assert.match(migration, /delete from public\.match_elo_changes/);
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
