const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const functionNames = [
  'countsForRanking', 'isCancelledMatch', 'getMatchStage', 'hasAssignedMatchPlayers', 'getFinalFourMatches',
  'getFinalFourDetailEntryMatchId', 'getFinalFourPlayerNames', 'getPlayerMatchTeamIndex',
  'getSingleSetGameStats', 'getFinalFourStats', 'getHomeSeasonPodiumPlacements'
];

function finalMatch(id, team1, team2, sieger, ergebnis) {
  return {
    id,
    stage: 'final-four',
    team1: { playerIds: team1, spieler: team1 },
    team2: { playerIds: team2, spieler: team2 },
    sieger,
    ergebnis
  };
}

function setup() {
  const context = vm.createContext({});
  vm.runInContext(`
    let PADEL_DATA = {
      completedAt: '2026-10-15T20:00:00Z',
      competition: { tournamentMode: 'direct-final-four' },
      players: ['A', 'B', 'C', 'D'].map(name => ({ id: name, name })),
      matches: [
        ${JSON.stringify(finalMatch('ff1', ['A', 'B'], ['C', 'D'], 1, '6:2'))},
        ${JSON.stringify(finalMatch('ff2', ['A', 'D'], ['B', 'C'], 2, '4:6'))},
        ${JSON.stringify(finalMatch('ff3', ['A', 'C'], ['B', 'D'], 1, '6:1'))}
      ]
    };
    const compareMatchesByNumber = (left, right) => left.id.localeCompare(right.id);
    const getCompetitionConfig = () => PADEL_DATA.competition;
    const getRankingPositionMap = () => new Map([['A', 1], ['B', 2], ['C', 3], ['D', 4]]);
    ${functionNames.map(name => source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))?.[0] || '').join('\n')}
    this.getPlacements = () => getHomeSeasonPodiumPlacements().map(item => item.player.name);
    this.updateSeason = change => Object.assign(PADEL_DATA, change);
    this.updateMatch = (index, change) => Object.assign(PADEL_DATA.matches[index], change);
  `, context);
  return context;
}

test('completed Final Four uses the official ranking order for the homepage podium', () => {
  const context = setup();
  assert.deepEqual(Array.from(context.getPlacements()), ['A', 'C', 'B']);
  context.updateSeason({ competition: { tournamentMode: 'top8-semifinals' } });
  assert.deepEqual(Array.from(context.getPlacements()), ['A', 'C', 'B']);
});

test('podium remains hidden before completion and for competitions without a Final Four', () => {
  const context = setup();
  context.updateSeason({ completedAt: null });
  assert.deepEqual(Array.from(context.getPlacements()), []);
  context.updateSeason({ completedAt: '2026-10-15T20:00:00Z', competition: { tournamentMode: 'none' } });
  assert.deepEqual(Array.from(context.getPlacements()), []);
  context.updateSeason({ competition: { tournamentMode: 'knockout-redraw' } });
  assert.deepEqual(Array.from(context.getPlacements()), []);
});

test('podium requires three valid Final Four results and known participants', () => {
  const context = setup();
  context.updateMatch(2, { sieger: null });
  assert.deepEqual(Array.from(context.getPlacements()), []);
  context.updateMatch(2, { sieger: 1, cancelledAt: '2026-10-15T19:00:00Z' });
  assert.deepEqual(Array.from(context.getPlacements()), []);
  context.updateMatch(2, { cancelledAt: null, ergebnis: null });
  assert.deepEqual(Array.from(context.getPlacements()), []);
  context.updateMatch(2, { ergebnis: '6:1', team2: { playerIds: ['B', 'E'], spieler: ['B', 'E'] } });
  assert.deepEqual(Array.from(context.getPlacements()), []);
});
