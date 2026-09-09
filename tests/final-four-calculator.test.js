const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const functions = [
  'getMatchStage', 'countsForRanking', 'isSingleSetMatch', 'getFinalFourMatches',
  'getFinalFourPlayerNames', 'getSingleSetGameStats', 'getPlayerMatchTeamIndex',
  'getFinalFourStats',
  'getCalculatorEntry', 'getCalculatorPair', 'parseCalculatorScorePair', 'validateRegularSet',
  'validateMatchTiebreak', 'formatCalculatorScore', 'parseCalculatorResult',
  'getFinalFourCalculatorMatches', 'getFinalFourCalculatorOutcomes', 'getOpenMatches',
  'getFinalFourEliminatedPlayerNames', 'getCalculatorSimulatedMatches', 'resetCalculator',
  'deactivateCalculatorAutoTip'
];
function setup() {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/score-input.js'), 'utf8'), context);
  vm.runInContext(`
    let calculatorResults = new Map(), finalFourCalculatorResults = new Map();
    let activeCalculatorMatchId = null, calculatorAutoTip = false;
    const compareMatchesByNumber = (a, b) => a.id.localeCompare(b.id);
    const renderCalculator = () => {}, updateCalculatorAutoTipUi = () => {};
    const PADEL_DATA = { players: [], matches: [
      { id: 'ff1', stage: 'final-four', format: 'single-set', countsForRanking: false, team1: { spieler: ['A', 'B'] }, team2: { spieler: ['C', 'D'] }, sieger: null },
      { id: 'ff2', stage: 'final-four', format: 'single-set', countsForRanking: false, team1: { spieler: ['A', 'D'] }, team2: { spieler: ['B', 'C'] }, sieger: null },
      { id: 'ff3', stage: 'final-four', format: 'single-set', countsForRanking: false, team1: { spieler: ['A', 'C'] }, team2: { spieler: ['B', 'D'] }, sieger: null },
      { id: 'league1', stage: 'league', team1: { spieler: ['A', 'B'] }, team2: { spieler: ['C', 'D'] }, sieger: null }
    ] };
    ${functions.map(name => source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))?.[0] || '').join('\n')}
    function setScore(id, score) { getCalculatorEntry(id).set1 = score.split(':'); }
  `, context);
  return code => vm.runInContext(code, context);
}

test('one valid Final4 set counts immediately; partial and invalid scores do not', () => {
  const run = setup();
  for (const score of ['6:0', '6:4', '7:5', '7:6', '0:6', '6:7']) {
    assert.equal(run(`setScore('ff1', '${score}'); parseCalculatorResult(PADEL_DATA.matches[0]).status`), 'complete');
    assert.equal(run('getFinalFourStats(getFinalFourCalculatorMatches()).stats[0].partien'), 1);
  }
  for (const score of ['3:2', '6:5', '7:4', '8:6', '6:', ':']) {
    assert.notEqual(run(`setScore('ff1', '${score}'); parseCalculatorResult(PADEL_DATA.matches[0]).status`), 'complete');
    assert.equal(run('getFinalFourStats(getFinalFourCalculatorMatches()).stats[0].partien'), 0);
  }
});

test('confirmed scores prefill, can be simulated, and reset independently of league results', () => {
  const run = setup();
  assert.equal(run(`PADEL_DATA.matches[0].sieger = 1; PADEL_DATA.matches[0].ergebnis = '7:6 (7:4)'; getCalculatorEntry('ff1').set1.join(':')`), '7:6');
  assert.equal(run(`setScore('ff1', '2:6'); resetCalculator(); getCalculatorEntry('ff1').set1.join(':')`), '2:6');
  assert.equal(run(`getCalculatorEntry('league1').set1 = ['6', '2']; finalFourCalculatorResults = new Map(); getCalculatorEntry('ff1').set1.join(':')`), '7:6');
  assert.equal(run(`getCalculatorEntry('league1').set1.join(':')`), '6:2');
  assert.equal(run(`setScore('ff1', '3:2'); getFinalFourCalculatorMatches()[0].sieger`), null);
  assert.equal(run(`PADEL_DATA.matches[0].ergebnis`), '7:6 (7:4)');
  assert.equal(run(`calculatorAutoTip = true; deactivateCalculatorAutoTip('ff1'); calculatorAutoTip`), true);
});

test('Final4 simulations do not change league matches and league requires two sets', () => {
  const run = setup();
  assert.equal(run(`setScore('ff1', '6:2'); getCalculatorSimulatedMatches()[0].sieger`), null);
  assert.equal(run(`setScore('league1', '6:2'); parseCalculatorResult(PADEL_DATA.matches[3]).status`), 'partial');
  assert.equal(run(`getCalculatorEntry('league1').set2 = ['6', '4']; parseCalculatorResult(PADEL_DATA.matches[3]).status`), 'complete');
});

test('last-set scenarios include every valid end score and use the full Final4 ranking order', () => {
  const run = setup();
  assert.equal(run(`getFinalFourCalculatorOutcomes(getFinalFourCalculatorMatches(), 'ff3').length`), 0);
  run(`setScore('ff1', '6:2'); setScore('ff2', '2:6');`);
  assert.equal(run(`getFinalFourCalculatorOutcomes(getFinalFourCalculatorMatches(), 'ff3').length`), 14);
  assert.deepEqual(
    Array.from(run(`getFinalFourEliminatedPlayerNames(getFinalFourStats(getFinalFourCalculatorMatches()).stats, getFinalFourCalculatorOutcomes(getFinalFourCalculatorMatches(), 'ff3'))`)),
    ['C', 'D']
  );
  // A, B and C each finish on two wins when A/C win the third round.
  // A and C have +margin; B has 8-margin. At margin 4 all three tie and the seed decides.
  assert.equal(run(`getFinalFourCalculatorOutcomes(getFinalFourCalculatorMatches(), 'ff3').find(row => row.score === '6:0').winner.name`), 'A');
  assert.equal(run(`getFinalFourCalculatorOutcomes(getFinalFourCalculatorMatches(), 'ff3').find(row => row.score === '0:6').winner.name`), 'B');
  run(`setScore('ff1', '6:4'); setScore('ff2', '4:6');`);
  assert.equal(run(`getFinalFourCalculatorOutcomes(getFinalFourCalculatorMatches(), 'ff3').find(row => row.score === '6:0').winner.name`), 'A');
  assert.equal(run(`getFinalFourCalculatorOutcomes(getFinalFourCalculatorMatches(), 'ff3').find(row => row.score === '6:4').winner.name`), 'A');
  assert.equal(run(`getFinalFourCalculatorOutcomes(getFinalFourCalculatorMatches(), 'ff3').find(row => row.score === '7:6').winner.name`), 'B');
  assert.match(source, /b\.siege - a\.siege \|\|[\s\S]*b\.diff - a\.diff \|\|[\s\S]*b\.gamesWon - a\.gamesWon \|\|[\s\S]*a\.seed - b\.seed/);
  // Enumerating a scenario must never mutate entered or official results.
  assert.equal(run(`getCalculatorEntry('ff3').set1.join(':')`), ':');
  assert.equal(run(`PADEL_DATA.matches.every(match => match.sieger === null)`), true);
});
