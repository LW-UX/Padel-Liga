const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const tippspielSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'tippspiel.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const styleSource = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
const scoreInputSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'score-input.js'), 'utf8');
const scoreInput = vm.runInNewContext(`(() => { const window = {}; ${scoreInputSource}\nreturn window.PadelScoreInput; })()`);

function getResultScoreReader() {
  const scoreLogic = tippspielSource.match(
    /function readResultScorePair\(form, kind, setIndex\) \{[\s\S]*?(?=\n  function updateResultSummary)/
  )?.[0] || '';
  return vm.runInNewContext(`(() => { ${scoreLogic}\nreturn readResultScore; })()`, {
    window: { PadelScoreInput: scoreInput }
  });
}

function resultFormFor({ sets = [], setTiebreaks = [], matchTiebreak = [], format = 'best-of-three' }) {
  return {
    dataset: { resultFormat: format },
    querySelector(selector) {
      const kind = selector.match(/data-score-kind="([^"]+)"/)?.[1];
      const setIndex = Number(selector.match(/data-score-set="(\d+)"/)?.[1]);
      const teamIndex = Number(selector.match(/data-score-team="(\d+)"/)?.[1]);
      const values = kind === 'set' ? sets[setIndex]
        : kind === 'set-tiebreak' ? setTiebreaks[setIndex]
          : matchTiebreak;
      return { value: values?.[teamIndex] ?? '' };
    }
  };
}

test('legacy profiles without app_role still publish their player id', async () => {
  const publishedPlayerIds = [];
  const session = { user: { id: 'account-1', email: 'player@example.test', user_metadata: {} } };
  const client = {
    auth: {
      async getSession() { return { data: { session }, error: null }; },
      onAuthStateChange() {}
    },
    from(table) {
      return {
        select(columns) {
          if (table === 'profiles') {
            return {
              eq() {
                return {
                  async single() {
                    if (columns.includes('app_role')) {
                      return { data: null, error: { message: 'column profiles.app_role does not exist' } };
                    }
                    return {
                      data: {
                        id: session.user.id,
                        display_name: 'Ludi GMX',
                        player_id: 'ludi_gmx',
                        players: { display_name: 'Ludi GMX' }
                      },
                      error: null
                    };
                  }
                };
              }
            };
          }
          if (table === 'matches') {
            return { async eq() { return { data: [], error: null }; } };
          }
          if (table === 'predictions') return Promise.resolve({ data: [], error: null });
          throw new Error(`Unexpected table: ${table}`);
        }
      };
    },
    async rpc(name) {
      if (name === 'get_prediction_leaderboard') return { data: [], error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    }
  };
  const mockNode = () => ({
    classList: { toggle() {} },
    className: '',
    hidden: false,
    required: false,
    autocomplete: '',
    textContent: ''
  });
  const requiredNodes = new Map([
    ['auth-dialog-title', mockNode()],
    ['auth-submit', mockNode()],
    ['auth-message', mockNode()]
  ]);
  const passwordInput = mockNode();
  const document = {
    addEventListener() {},
    getElementById(id) { return requiredNodes.get(id) || null; },
    querySelector(selector) {
      if (selector === '#auth-form [name="password"]') return passwordInput;
      return null;
    },
    querySelectorAll() { return []; }
  };
  const window = {
    PADEL_SUPABASE_CONFIG: { url: 'https://example.test', publishableKey: 'public-test-key' },
    supabase: { createClient: () => client },
    addEventListener() {},
    dispatchEvent() {},
    setTimeout(callback) { callback(); },
    PadelLigaSetAuthenticatedPlayer(playerId) { publishedPlayerIds.push(playerId); }
  };
  const context = vm.createContext({ console, CustomEvent: class {}, document, window });
  vm.runInContext(tippspielSource, context);

  await window.PadelTippspiel.init({ id: 'test-2026', matches: [] });

  assert.equal(publishedPlayerIds.at(-1), 'ludi_gmx');
});

test('delegated result forms submit the form itself with the actual date and time', () => {
  const resultHandler = tippspielSource.match(
    /async function handleResultSubmit\(event\) \{[\s\S]*?(?=\n  async function confirmResult)/
  )?.[0] || '';
  assert.match(resultHandler, /const form = event\.target;/);
  assert.match(resultHandler, /p_played_on: playedOn/);
  assert.match(resultHandler, /p_played_time: playedTime/);
  assert.doesNotMatch(resultHandler, /const form = event\.currentTarget;/);
});

test('result tasks load across seasons without a separate admin archive', () => {
  assert.match(tippspielSource, /get_my_result_tasks', \{ p_season_id: null \}/);
  assert.match(tippspielSource, /typeof task\?\.is_open === 'boolean'/);
  assert.match(tippspielSource, /task\.task_type === 'completed'/);
  assert.doesNotMatch(tippspielSource, /renderAdminAllMatches/);
});

test('games are player-scoped for players and unfiltered for admins', () => {
  const timestampSource = tippspielSource.match(
    /function getMatchTimestamp\(match\) \{[\s\S]*?(?=\n  function renderTeam)/
  )?.[0] || '';
  const groupingSource = tippspielSource.match(
    /function getPlayerResultTaskGroups\(tasks = \[\], now = Date\.now\(\), includeAll = false\) \{[\s\S]*?(?=\n  function getActionableResultTasks)/
  )?.[0] || '';
  const getGroups = vm.runInNewContext(`(() => { ${timestampSource}\n${groupingSource}\nreturn getPlayerResultTaskGroups; })()`);
  const now = new Date('2026-09-01T12:00:00').getTime();
  const groups = getGroups([
    { match_id: 'future', my_team: 1, task_type: 'enter', scheduled_date: '2026-09-02', display_time: '18:00' },
    { match_id: 'admin-only', my_team: null, task_type: 'review', scheduled_date: '2026-08-28', display_time: '18:00' },
    { match_id: 'review', my_team: 2, task_type: 'review', scheduled_date: '2026-08-30', display_time: '18:00' },
    { match_id: 'past', my_team: 1, task_type: 'enter', scheduled_date: '2026-08-31', display_time: '18:00:00' },
    { match_id: 'waiting', my_team: 1, task_type: 'waiting', scheduled_date: '2026-08-29', display_time: '18:00' },
    { match_id: 'planned', matchday: 3, my_team: 1, task_type: 'enter', scheduled_date: null, display_time: null }
  ], now);

  assert.deepEqual(
    JSON.parse(JSON.stringify(groups.map(group => [group.key, group.tasks.map(task => task.match_id)]))),
    [['review', ['waiting', 'review']], ['past', ['past']], ['future', ['future']], ['planned', ['planned']]]
  );
  const adminGroups = getGroups([
    { match_id: 'admin-review', my_team: null, task_type: 'review', scheduled_date: '2026-08-28', display_time: '18:00' },
    { match_id: 'admin-past', my_team: null, task_type: 'enter', scheduled_date: '2026-08-31', display_time: '18:00' },
    { match_id: 'admin-future', my_team: null, task_type: 'enter', scheduled_date: '2026-09-02', display_time: '18:00' },
    { match_id: 'admin-planned', matchday: 4, my_team: null, task_type: 'enter', scheduled_date: null, display_time: null }
  ], now, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(adminGroups.map(group => [group.key, group.tasks.map(task => task.match_id)]))),
    [['review', ['admin-review']], ['past', ['admin-past']], ['future', ['admin-future']], ['planned', ['admin-planned']]]
  );
});

test('all pending trainings join the confirmation group and own trainings stay editable', () => {
  assert.match(tippspielSource, /function isTrainingTaskVisible\(task\)[\s\S]*app_role === 'admin'/);
  assert.match(tippspielSource, /const visibleTrainingTasks = state\.trainingTasks\.filter\(isTrainingTaskVisible\)/);
  assert.match(tippspielSource, /trainingTasks\.forEach\([\s\S]*kind: 'training'/);
  assert.match(tippspielSource, /task\.created_by_me[\s\S]*Auf Bestätigung warten[\s\S]*data-training-edit[\s\S]*data-training-delete/);
  assert.match(tippspielSource, /data-training-confirm="\$\{task\.session_id\}"[\s\S]*Alternative eingeben/);
  assert.doesNotMatch(tippspielSource, /function renderTraining\(\)/);
});

test('training review cards reuse the league proposal structure and styles', () => {
  assert.match(tippspielSource, /Training · Partie \$\{escapeHtml\(task\.training_number \|\| index \+ 1\)\}/);
  assert.match(tippspielSource, /function renderTrainingTaskRound\(task, round, roundIndex, roundCount\)/);
  assert.match(tippspielSource, /class="account-task-matchup"[\s\S]*<span>vs\.<\/span>/);
  assert.match(tippspielSource, /class="result-proposal"/);
  assert.match(tippspielSource, /account-task-actions\$\{task\.created_by_me \? '' : ' result-review-actions'\}/);
  assert.doesNotMatch(tippspielSource, /class="training-player-line"|class="training-round-result/);
});

test('training player selection reuses the custom page viewer dropdown', () => {
  assert.doesNotMatch(tippspielSource, /<select name="playerId"/);
  assert.match(tippspielSource, /class="training-player-picker" data-training-player-picker/);
  assert.match(tippspielSource, /type="hidden" name="playerId"/);
  assert.match(tippspielSource, /secondary-button secondary-button--dropdown training-player-toggle/);
  assert.match(tippspielSource, /viewer-menu training-player-menu/);
  assert.match(tippspielSource, /viewer-option training-player-option/);
  assert.match(tippspielSource, /function setTrainingPlayerPickerValue\(picker, playerId\)/);
  assert.match(tippspielSource, /data-training-player-toggle/);
  assert.match(tippspielSource, /data-training-player-id/);
  assert.match(styleSource, /\.training-player-picker\.open \.training-player-menu/);
});

test('scheduling and future result entry use their dedicated secondary actions', () => {
  assert.match(tippspielSource, /data-match-schedule="\$\{escapeHtml\(task\.match_id\)\}"/);
  assert.match(tippspielSource, /class="secondary-button" type="submit">Terminieren<\/button>/);
  assert.match(tippspielSource, /data-result-entry-toggle="\$\{escapeHtml\(task\.match_id\)\}"/);
  assert.match(tippspielSource, /state\.client\.rpc\('schedule_match'/);
  assert.match(tippspielSource, /p_scheduled_date:/);
  assert.match(tippspielSource, /p_scheduled_time:/);
});

test('account names are derived from email and cannot be submitted by the user', () => {
  assert.match(tippspielSource, /function deriveDisplayNameFromEmail\(email\)/);
  assert.match(tippspielSource, /return `\$\{capitalize\(parts\[0\]\)\} \$\{parts\.at\(-1\)\.charAt\(0\)/);
  assert.doesNotMatch(tippspielSource, /update_my_profile/);
  assert.doesNotMatch(tippspielSource, /data: \{ display_name:/);
});

test('detailed score counters derive the set result and winner', () => {
  const scoreReader = tippspielSource.match(
    /function readResultScore\(form\) \{[\s\S]*?(?=\n  function updateResultSummary)/
  )?.[0] || '';
  assert.match(scoreReader, /const actualSets = `\$\{setWins\[0\]\}:\$\{setWins\[1\]\}`/);
  assert.match(scoreReader, /winner: setWins\[0\] === 2 \? 1 : 2/);
  assert.match(scoreReader, /Bei 1:1 bitte auch den Match-Tiebreak eingeben/);
  assert.doesNotMatch(tippspielSource, /name="actualSets"/);
});

test('score derivation handles straight sets and a deciding match tiebreak', () => {
  const readResultScore = getResultScoreReader();

  assert.deepEqual(
    JSON.parse(JSON.stringify(readResultScore(resultFormFor({ sets: [[6, 4], [6, 3]] })))),
    { actualSets: '2:0', winner: 1, resultDetails: '6:4, 6:3' }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(readResultScore(resultFormFor({ sets: [[6, 2], [3, 6]], matchTiebreak: [4, 10] })))),
    { actualSets: '1:2', winner: 2, resultDetails: '6:2, 3:6 – 4:10' }
  );
});

test('score derivation stores one-set finals as 1:0 or 0:1', () => {
  const readResultScore = getResultScoreReader();

  assert.deepEqual(
    JSON.parse(JSON.stringify(readResultScore(resultFormFor({ sets: [[7, 5]], format: 'single-set' })))),
    { actualSets: '1:0', winner: 1, resultDetails: '7:5' }
  );
});

test('official result entry validates regular sets and both tiebreak types', () => {
  const readResultScore = getResultScoreReader();
  const combined = resultFormFor({
    sets: [[7, 6], [6, 7]],
    setTiebreaks: [[7, 4], [8, 10]],
    matchTiebreak: [10, 6]
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(readResultScore(combined))),
    { actualSets: '2:1', winner: 1, resultDetails: '7:6 (7:4), 6:7 (8:10) – 10:6' }
  );
  assert.throws(
    () => readResultScore(resultFormFor({ sets: [[6, 5], [6, 2]] })),
    /Nur 6:X, 7:5 oder 7:6/
  );
  assert.throws(
    () => readResultScore(resultFormFor({ sets: [[7, 6], [6, 2]] })),
    /Satz-Tiebreak fehlt/
  );
  assert.throws(
    () => readResultScore(resultFormFor({ sets: [[7, 6], [6, 2]], setTiebreaks: [[8, 5]] })),
    /regelkonformen Endstand/
  );
  assert.throws(
    () => readResultScore(resultFormFor({ sets: [[7, 6], [6, 2]], setTiebreaks: [[4, 7]] })),
    /Sieger stimmen nicht überein/
  );
  assert.throws(
    () => readResultScore(resultFormFor({ sets: [[6, 2], [3, 6]], matchTiebreak: [11, 8] })),
    /regelkonformen Endstand/
  );
});

test('result counters start empty, initialize their pair, and highlight only while active', () => {
  assert.doesNotMatch(tippspielSource, /placeholder="0"/);
  assert.match(tippspielSource, /type="text"\s+inputmode="numeric"\s+pattern="\[0-9\]\*"\s+maxlength="2"/);
  assert.match(tippspielSource, /class="calculator-score-pair result-score-pair"/);
  assert.match(tippspielSource, /class="calculator-score-field result-score-counter"/);
  assert.match(tippspielSource, /class="calculator-step"/);
  assert.match(styleSource, /\.calculator-score-pair\.calculator-score-pair-active \.calculator-score-field/);
  assert.match(styleSource, /\.calculator-score-field input \{[\s\S]*?min-width: 0;[\s\S]*?min-height: 0;[\s\S]*?padding: 0;/);
  assert.doesNotMatch(styleSource, /\.result-score-pair\.is-framed/);
  assert.doesNotMatch(tippspielSource, /<span>Satz [12]<\/span>/);
  assert.match(tippspielSource, /data-result-set-tiebreak/);
  assert.match(tippspielSource, />Satz-Tiebreak<\/span>/);
  assert.doesNotMatch(tippspielSource, />Match-Tiebreak<\/span>/);
  assert.match(tippspielSource, /renderScorePair\('Match-Tiebreak'/);

  const initializerSource = tippspielSource.match(
    /function initializeResultScorePair\(input\) \{[\s\S]*?\n  \}/
  )?.[0] || '';
  const initializeResultScorePair = vm.runInNewContext(
    `(() => { ${initializerSource}\nreturn initializeResultScorePair; })()`,
    { window: { PadelScoreInput: scoreInput } }
  );
  const first = { value: '1' };
  const second = { value: '' };
  const pair = { querySelectorAll: () => [first, second] };
  first.closest = second.closest = () => pair;
  initializeResultScorePair(first);
  assert.equal(second.value, '0');
  first.value = '3';
  second.value = '4';
  initializeResultScorePair(first);
  assert.equal(second.value, '4');
});

test('result entry exposes live validation messages beside the submit action', () => {
  assert.match(tippspielSource, /data-result-summary aria-live="polite"/);
  assert.match(tippspielSource, /target\.textContent = error\.message \|\| 'Bitte das Ergebnis prüfen\.'/);
  assert.match(tippspielSource, /target\.classList\.add\(\/fehlt\/i\.test\(target\.textContent\) \? 'is-partial' : 'is-invalid'\)/);
  assert.match(styleSource, /\.result-entry-summary\.is-invalid \{ color: var\(--negativ\); \}/);
  assert.match(styleSource, /\.result-entry-summary\.is-partial \{ color: var\(--accent\); \}/);
});

test('account matchups reuse the muted player separator', () => {
  assert.match(tippspielSource, /join\('<span class="mc-player-sep">&amp;<\/span>'\)/);
});

test('account cards use accent2 for viewer participation while actionable yellow stays dominant', () => {
  assert.match(tippspielSource, /const hasAuthenticatedPlayer = \[1, 2\]\.includes\(Number\(task\.my_team\)\)/);
  assert.match(tippspielSource, /task\.player_ids\.includes\(state\.profile\.player_id\)/);
  assert.match(tippspielSource, /hasAuthenticatedPlayer \? ' has-authenticated-player' : ''/);
  const personalRule = styleSource.indexOf('.account-task-card.has-authenticated-player');
  const actionableRule = styleSource.indexOf('.account-task-card.is-actionable');
  assert.ok(personalRule >= 0 && actionableRule > personalRule);
  assert.match(styleSource.slice(personalRule, actionableRule), /border-color: var\(--accent2\)/);
  assert.match(styleSource.slice(actionableRule), /border-color: var\(--accent\)/);
});

test('calculator enforces a regulation match-tiebreak endpoint', () => {
  const calculatorValidation = appSource.match(
    /function parseCalculatorScorePair\(rawTeam1, rawTeam2\) \{[\s\S]*?(?=\nfunction formatCalculatorScore)/
  )?.[0] || '';
  const validateMatchTiebreak = vm.runInNewContext(
    `(() => { ${calculatorValidation}\nreturn validateMatchTiebreak; })()`,
    { window: { PadelScoreInput: scoreInput } }
  );
  assert.equal(validateMatchTiebreak('10', '8').invalid, undefined);
  assert.equal(validateMatchTiebreak('11', '9').invalid, undefined);
  assert.equal(validateMatchTiebreak('11', '8').invalid, true);
});

test('calculator and result entry share score parsing, validation, and counter state helpers', () => {
  assert.match(appSource, /window\.PadelScoreInput\.parseScorePair/);
  assert.match(appSource, /window\.PadelScoreInput\.isValidRegularSet/);
  assert.match(appSource, /window\.PadelScoreInput\.isValidTiebreak/);
  assert.match(appSource, /window\.PadelScoreInput\.initializePairValues/);
  assert.match(tippspielSource, /window\.PadelScoreInput\.isValidRegularSet/);
  assert.match(tippspielSource, /window\.PadelScoreInput\.isValidTiebreak/);
  assert.match(tippspielSource, /window\.PadelScoreInput\.initializePairValues/);
  assert.match(tippspielSource, /window\.PadelScoreInput\.setActivePair/);
});

test('decision counters unlock only at 1:1 and share the action row with their status', () => {
  assert.match(tippspielSource, /function hasSplitFirstTwoSets\(scores\)/);
  assert.match(tippspielSource, /data-result-decision/);
  assert.match(tippspielSource, /control\.disabled = !decisionEnabled/);
  assert.match(tippspielSource, /<div class="result-entry-actions">\s*<div class="result-entry-summary"[^>]*>Satzergebnis wird automatisch berechnet\.<\/div>\s*<button class="primary-button"/);
});

test('training distinguishes three regular sets from two sets plus match tiebreak', () => {
  assert.match(tippspielSource, /value="two_sets_match_tiebreak">2 Sätze \+ Match-Tiebreak/);
  assert.match(tippspielSource, /value="three_sets">3 Sätze/);
  assert.doesNotMatch(tippspielSource, /3 Sätze \/ Match-Tiebreak/);
  const splitSource = tippspielSource.match(
    /function hasSplitFirstTwoSets\(scores\) \{[\s\S]*?(?=\n  function renderScoreCounters)/
  )?.[0] || '';
  const trainingResultSource = tippspielSource.match(
    /function getTrainingResultData\(round\) \{[\s\S]*?(?=\n  async function handleTrainingSubmit)/
  )?.[0] || '';
  const getTrainingResultData = vm.runInNewContext(
    `(() => { ${splitSource}\n${trainingResultSource}\nreturn getTrainingResultData; })()`
  );
  const roundFor = (resultFormat, result) => ({
    querySelector(selector) {
      return { value: selector.includes('resultFormat') ? resultFormat : result };
    }
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(getTrainingResultData(roundFor('one_set', '6:3')))),
    { resultDetails: '6:3', setCount: 1 }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(getTrainingResultData(roundFor('two_sets_match_tiebreak', '6:3, 4:6, 10:7')))),
    { resultDetails: '6:3, 4:6 – 10:7', setCount: 3 }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(getTrainingResultData(roundFor('three_sets', '6:3, 4:6, 6:4')))),
    { resultDetails: '6:3, 4:6, 6:4', setCount: 3 }
  );
  assert.throws(
    () => getTrainingResultData(roundFor('three_sets', '6:3, 4:6, 10:7')),
    /kein Match-Tiebreak/
  );
  assert.throws(
    () => getTrainingResultData(roundFor('two_sets_match_tiebreak', '6:3, 6:4, 10:7')),
    /nur nach einem Satzstand von 1:1/
  );
});

test('training validation is shown inside the training form before any RPC call', () => {
  ['index.html', 'tipp/index.html'].forEach(relativePath => {
    const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
    assert.match(source, /data-training-message role="status" aria-live="polite"/);
  });
  assert.match(tippspielSource, /function handleTrainingInvalid\(event\)/);
  assert.match(tippspielSource, /trainingForm\?\.addEventListener\('invalid', handleTrainingInvalid, true\)/);
  assert.match(tippspielSource, /setTrainingMessage\('Bitte vier verschiedene Spieler auswählen\.', 'error'\)/);
  assert.match(tippspielSource, /setTrainingMessage\(getFriendlyAuthError\(error\), 'error'\)/);
});

test('result submission and confirmation refresh in place without closing the account dialog', () => {
  const resultHandlers = tippspielSource.match(
    /async function handleResultSubmit\(event\) \{[\s\S]*?(?=\n  function getTrainingPairing)/
  )?.[0] || '';
  assert.match(resultHandlers, /await refresh\(\);/);
  assert.doesNotMatch(resultHandlers, /window\.location\.reload/);
  assert.doesNotMatch(resultHandlers, /closeAuthDialog/);
});
