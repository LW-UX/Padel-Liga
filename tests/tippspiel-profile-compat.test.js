const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const tippspielSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'tippspiel.js'), 'utf8');

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
    { match_id: 'waiting', my_team: 1, task_type: 'waiting', scheduled_date: '2026-08-29', display_time: '18:00' }
  ], now);

  assert.deepEqual(
    JSON.parse(JSON.stringify(groups.map(group => [group.key, group.tasks.map(task => task.match_id)]))),
    [['review', ['review']], ['past', ['past']], ['future', ['future']]]
  );
  const adminGroups = getGroups([
    { match_id: 'admin-review', my_team: null, task_type: 'review', scheduled_date: '2026-08-28', display_time: '18:00' },
    { match_id: 'admin-past', my_team: null, task_type: 'enter', scheduled_date: '2026-08-31', display_time: '18:00' },
    { match_id: 'admin-future', my_team: null, task_type: 'enter', scheduled_date: '2026-09-02', display_time: '18:00' }
  ], now, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(adminGroups.map(group => [group.key, group.tasks.map(task => task.match_id)]))),
    [['review', ['admin-review']], ['past', ['admin-past']], ['future', ['admin-future']]]
  );
});

test('training confirmations join the first group and own trainings stay in training management', () => {
  assert.match(tippspielSource, /function isTrainingTaskVisible\(task\)[\s\S]*app_role === 'admin'/);
  assert.match(tippspielSource, /const trainingConfirmations = state\.trainingTasks[\s\S]*!task\.created_by_me && isTrainingTaskVisible\(task\)/);
  assert.match(tippspielSource, /trainingTasks\.forEach\([\s\S]*kind: 'training'/);
  assert.match(tippspielSource, /const ownTrainingTasks = state\.trainingTasks[\s\S]*task\.created_by_me && isTrainingTaskVisible\(task\)/);
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
  assert.match(scoreReader, /Bei 1:1 bitte auch das Entscheidungsergebnis eingeben/);
  assert.doesNotMatch(tippspielSource, /name="actualSets"/);
});

test('score derivation handles straight sets and a deciding match tiebreak', () => {
  const scoreReader = tippspielSource.match(
    /function readResultScore\(form\) \{[\s\S]*?(?=\n  function updateResultSummary)/
  )?.[0] || '';
  const readResultScore = vm.runInNewContext(`(() => {
    const SINGLE_SET_PREDICTIONS = ['6:0', '6:1', '6:2', '6:3', '6:4', '7:5', '7:6', '0:6', '1:6', '2:6', '3:6', '4:6', '5:7', '6:7'];
    return (${scoreReader.replace('function readResultScore', 'function')});
  })()`);
  const formFor = values => ({
    querySelector(selector) {
      const [, setIndex, teamIndex] = selector.match(/data-score-set="(\d)".*data-score-team="(\d)"/);
      return { value: values[setIndex]?.[teamIndex] ?? '' };
    }
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(readResultScore(formFor([[6, 4], [6, 3], ['', '']])))),
    { actualSets: '2:0', winner: 1, resultDetails: '6:4, 6:3' }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(readResultScore(formFor([[6, 2], [3, 6], [4, 10]])))),
    { actualSets: '1:2', winner: 2, resultDetails: '6:2, 3:6 – 4:10' }
  );
});

test('score derivation stores one-set finals as 1:0 or 0:1', () => {
  const scoreReader = tippspielSource.match(
    /function readResultScore\(form\) \{[\s\S]*?(?=\n  function updateResultSummary)/
  )?.[0] || '';
  const readResultScore = vm.runInNewContext(`(() => {
    const SINGLE_SET_PREDICTIONS = ['6:0', '6:1', '6:2', '6:3', '6:4', '7:5', '7:6', '0:6', '1:6', '2:6', '3:6', '4:6', '5:7', '6:7'];
    return (${scoreReader.replace('function readResultScore', 'function')});
  })()`);
  const form = {
    dataset: { resultFormat: 'single-set' },
    querySelector(selector) {
      const [, setIndex, teamIndex] = selector.match(/data-score-set="(\d)".*data-score-team="(\d)"/);
      return { value: setIndex === '0' ? ['7', '5'][Number(teamIndex)] : '' };
    }
  };

  assert.deepEqual(
    JSON.parse(JSON.stringify(readResultScore(form))),
    { actualSets: '1:0', winner: 1, resultDetails: '7:5' }
  );
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

test('result submission and confirmation refresh in place without closing the account dialog', () => {
  const resultHandlers = tippspielSource.match(
    /async function handleResultSubmit\(event\) \{[\s\S]*?(?=\n  function getTrainingPairing)/
  )?.[0] || '';
  assert.match(resultHandlers, /await refresh\(\);/);
  assert.doesNotMatch(resultHandlers, /window\.location\.reload/);
  assert.doesNotMatch(resultHandlers, /closeAuthDialog/);
});
