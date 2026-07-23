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
    ['auth-name-field', mockNode()],
    ['auth-dialog-title', mockNode()],
    ['auth-submit', mockNode()],
    ['auth-message', mockNode()]
  ]);
  const nameInput = mockNode();
  const passwordInput = mockNode();
  const document = {
    addEventListener() {},
    getElementById(id) { return requiredNodes.get(id) || null; },
    querySelector(selector) {
      if (selector === '#auth-form [name="displayName"]') return nameInput;
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

test('open result tasks are separated from all season matches', () => {
  assert.match(tippspielSource, /state\.resultScope === 'all' \? state\.resultTasks : openTasks/);
  assert.match(tippspielSource, /typeof task\?\.is_open === 'boolean'/);
  assert.match(tippspielSource, /task\.task_type === 'completed'/);
});
