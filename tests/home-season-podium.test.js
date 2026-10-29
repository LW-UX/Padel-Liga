const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const style = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
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
      id: '2026-sommer',
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

test('test season no longer receives a hard-coded podium preview', () => {
  const context = setup();
  context.updateSeason({ id: '2026-test', completedAt: null, competition: { tournamentMode: 'none' } });
  assert.deepEqual(Array.from(context.getPlacements()), []);
  assert.doesNotMatch(source, /PADEL_DATA\?\.id === '2026-test'/);
});

test('completed podium is not rendered in the Final Four matches section', () => {
  const tournamentGroup = source.match(/function renderTournamentGroup\([^]*?(?=\nfunction matchesCurrentMatchScope)/)?.[0] || '';
  assert.match(tournamentGroup, /className === 'final-four-group'/);
  assert.doesNotMatch(tournamentGroup, /getHomeSeasonPodiumPlacements|renderFinalFourPodiumSteps|final-four-page-podium/);
  assert.doesNotMatch(style, /\.final-four-page-podium/);
});

test('homepage podium steps open the Final Four overview', () => {
  const homePodium = source.match(/function renderHomeSeasonPodium\([^]*?(?=\nfunction renderHome)/)?.[0] || '';
  const podiumSteps = source.match(/function renderFinalFourPodiumSteps\([^]*?(?=\nwindow\.PadelLigaSeasonPodium)/)?.[0] || '';

  assert.match(homePodium, /renderFinalFourPodiumSteps\([^]*\{ overviewMatchId \}\)/);
  assert.match(podiumSteps, /<button type="button" class="home-season-podium-step"[^>]*data-live-open-match=/);
  assert.match(podiumSteps, /data-live-view="overview"/);
  assert.match(podiumSteps, /<div class="home-season-podium-step" aria-hidden="true">/);
  assert.match(style, /button\.home-season-podium-step:hover/);
});

test('homepage top four appends a selected player from lower in the ranking', () => {
  const helper = source.match(/function getHomeRankingEntries\([^]*?\n\}/)?.[0] || '';
  assert.ok(helper);
  const context = vm.createContext({});
  vm.runInContext(`${helper}\nthis.getEntries = getHomeRankingEntries;`, context);
  const players = Array.from({ length: 7 }, (_, index) => ({ id: `p${index + 1}` }));

  const outsideTopFour = JSON.parse(JSON.stringify(context.getEntries(players, 'p6', 4)));
  assert.deepEqual(outsideTopFour.map(entry => [entry.player.id, entry.rank, entry.separated]), [
    ['p1', 1, false],
    ['p2', 2, false],
    ['p3', 3, false],
    ['p4', 4, false],
    ['p6', 6, true]
  ]);

  const insideTopFour = JSON.parse(JSON.stringify(context.getEntries(players, 'p2', 4)));
  assert.deepEqual(insideTopFour.map(entry => entry.player.id), ['p1', 'p2', 'p3', 'p4']);
  assert.match(style, /\.home-ranking-selected-row \{ margin-top: 10px; border-top: 1px solid var\(--border\); \}/);
});
