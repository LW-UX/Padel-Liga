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

test('personal result tasks load across seasons and keep the admin archive collapsed', () => {
  assert.match(tippspielSource, /get_my_result_tasks', \{ p_season_id: null \}/);
  assert.match(tippspielSource, /typeof task\?\.is_open === 'boolean'/);
  assert.match(tippspielSource, /task\.task_type === 'completed'/);
  assert.match(tippspielSource, /if \(!details\?\.open\) return/);
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
  const readResultScore = vm.runInNewContext(`(${scoreReader.replace('function readResultScore', 'function')})`);
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

test('result submission and confirmation refresh in place without closing the account dialog', () => {
  const resultHandlers = tippspielSource.match(
    /async function handleResultSubmit\(event\) \{[\s\S]*?(?=\n  function getTrainingPairing)/
  )?.[0] || '';
  assert.match(resultHandlers, /await refresh\(\);/);
  assert.doesNotMatch(resultHandlers, /window\.location\.reload/);
  assert.doesNotMatch(resultHandlers, /closeAuthDialog/);
});
