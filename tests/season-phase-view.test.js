const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const tippspiel = fs.readFileSync(path.join(root, 'js/tippspiel.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} is missing`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} is incomplete`);
}

const phaseSandbox = {};
vm.runInNewContext([
  extractFunction(app, 'countsForRanking'),
  extractFunction(app, 'getMatchStage'),
  extractFunction(app, 'isCompletedSeasonMatch'),
  extractFunction(app, 'hasAssignedMatchPlayers'),
  extractFunction(app, 'getSeasonDisplayPhase'),
  extractFunction(app, 'getSeasonStageOrder'),
  'this.getSeasonDisplayPhase = getSeasonDisplayPhase;',
  'this.getSeasonStageOrder = getSeasonStageOrder;'
].join('\n'), phaseSandbox);

function team(assigned = true) {
  return { playerIds: assigned ? ['one', 'two'] : [] };
}

function match(stage, { complete = false, assigned = true } = {}) {
  return {
    stage,
    countsForRanking: stage === 'league',
    sieger: complete ? 1 : null,
    saetze: complete ? (stage === 'final-four' ? '1:0' : '2:0') : null,
    team1: team(assigned),
    team2: team(assigned)
  };
}

function season(tournamentMode, matches, overrides = {}) {
  return {
    completedAt: null,
    competition: { tournamentMode, regularScheduleLocked: true },
    matches,
    ...overrides
  };
}

test('direct Final4 advances only after league completion and assigned finalists', () => {
  const league = match('league');
  const placeholders = [1, 2, 3].map(() => match('final-four', { assigned: false }));
  assert.equal(phaseSandbox.getSeasonDisplayPhase(season('direct-final-four', [league, ...placeholders])), 'league');

  league.sieger = 1;
  league.saetze = '2:0';
  assert.equal(phaseSandbox.getSeasonDisplayPhase(season('direct-final-four', [league, ...placeholders])), 'league');

  const finals = [1, 2, 3].map(() => match('final-four'));
  const unlocked = season('direct-final-four', [league, ...finals]);
  unlocked.competition.regularScheduleLocked = false;
  assert.equal(phaseSandbox.getSeasonDisplayPhase(unlocked), 'league');
  assert.equal(phaseSandbox.getSeasonDisplayPhase(season('direct-final-four', [league, ...finals])), 'final-four');
});

test('top8 season moves from league through semifinals to Final4', () => {
  const league = match('league', { complete: true });
  const semifinals = [match('semifinal'), match('semifinal')];
  const placeholders = [1, 2, 3].map(() => match('final-four', { assigned: false }));
  const data = season('top8-semifinals', [league, ...semifinals, ...placeholders]);

  assert.equal(phaseSandbox.getSeasonDisplayPhase(data), 'semifinal');
  semifinals.forEach(item => {
    item.sieger = 1;
    item.saetze = '2:0';
  });
  assert.equal(phaseSandbox.getSeasonDisplayPhase(data), 'semifinal');

  data.matches = [league, ...semifinals, ...[1, 2, 3].map(() => match('final-four'))];
  assert.equal(phaseSandbox.getSeasonDisplayPhase(data), 'final-four');
  assert.equal(phaseSandbox.getSeasonDisplayPhase({ ...data, completedAt: '2026-12-01T20:00:00Z' }), 'completed');
});

test('stage order follows the active phase and keeps older phases below', () => {
  assert.deepEqual(Array.from(phaseSandbox.getSeasonStageOrder('league')), ['league', 'semifinal', 'finalFour']);
  assert.deepEqual(Array.from(phaseSandbox.getSeasonStageOrder('semifinal')), ['semifinal', 'league', 'finalFour']);
  assert.deepEqual(Array.from(phaseSandbox.getSeasonStageOrder('final-four')), ['finalFour', 'semifinal', 'league']);
  assert.deepEqual(Array.from(phaseSandbox.getSeasonStageOrder('completed')), ['finalFour', 'semifinal', 'league']);
});

test('ranking, matches, and calculator share the phase layout controls', () => {
  assert.match(html, /id="final-four-ranking-section"/);
  assert.match(html, /id="league-calculator"/);
  assert.match(html, /id="calculator-nav-button"/);
  assert.match(html, /id="home-calculator-link"/);
  assert.match(app, /rankingSection\.prepend\(finalFourRanking\)/);
  assert.match(app, /leagueCalculator\.hidden = phase !== 'league'/);
  assert.match(app, /section\.id === 'rechner' && calculatorUnavailable/);
  assert.match(app, /homeCalculatorLink\.hidden = calculatorUnavailable/);
  assert.match(app, /renderPartienByMatchday[\s\S]*joinSeasonPhaseSections/);
  assert.match(app, /renderPartienByDate[\s\S]*joinSeasonPhaseSections/);
  assert.match(style, /#league-calculator\[hidden\] \+ #final-four-calculator \.section-subheading/);
});

test('only official result changes refresh the complete season view', () => {
  assert.match(tippspiel, /const resultIsOfficialImmediately = state\.profile\?\.app_role === 'admin'/);
  assert.match(tippspiel, /if \(resultIsOfficialImmediately\) publishOfficialResultChange\(form\.dataset\.resultSubmit\)/);
  assert.match(tippspiel, /confirmResult[\s\S]*publishOfficialResultChange\(\)/);
  assert.match(app, /addEventListener\('padel:official-result-changed'/);
  assert.match(app, /PADEL_DATA = await loadSeasonData\(selectedSeason\)/);
  assert.match(app, /window\.PadelTippspiel\?\.setSeasonData\?\.\(PADEL_DATA\)/);
});
