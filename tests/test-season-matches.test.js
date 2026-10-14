const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'data', 'data-2026-test.js'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260922130000_reset_test_season_roster.sql'),
  'utf8'
);
const openMatchMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261008140000_add_open_test_matchday_three.sql'),
  'utf8'
);
const openMatchSixMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261012230000_add_open_test_match_six.sql'),
  'utf8'
);
const matchStatisticsMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261014110000_test_season_match_statistics.sql'),
  'utf8'
);
const matchStatisticsShowcaseMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261014120000_test_match_statistics_showcase.sql'),
  'utf8'
);

const context = { window: {} };
vm.runInNewContext(source, context);
const season = context.window.PADEL_SEASON;

test('test season contains six interactive matches plus a separate statistics history fixture', () => {
  assert.equal(season.id, '2026-test');
  assert.equal(season.competition.qualificationPlaces, 3);
  assert.match(season.shortInfo.join(' '), /isoliertes Test-Elo/);
  assert.deepEqual(
    JSON.parse(JSON.stringify(season.matches.map(match => match.id))),
    Array.from({ length: 6 }, (_, index) => `test-2026-partie-${index + 1}`)
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
  assert.match(openMatchSixMigration, /target_season_id[\s\S]*'test-2026-partie-6'[\s\S]*'league'[\s\S]*'best-of-three'/);
  assert.match(openMatchSixMigration, /match\.cancelled_at is null[\s\S]*match\.betting_open/);
  assert.match(matchStatisticsMigration, /recalculate_test_match_elo/);
  assert.match(matchStatisticsMigration, /set qualification_places = 3/);
  assert.match(matchStatisticsMigration, /not season\.counts_for_profile/);
  assert.match(matchStatisticsShowcaseMigration, /test-2026-statistics-history/);
  assert.match(matchStatisticsShowcaseMigration, /Testbetrieb Nord/);
  assert.equal(season.matches.find(match => match.id === 'test-2026-partie-6').date, '2026-10-20');
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
