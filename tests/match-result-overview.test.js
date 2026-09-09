const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const styleSource = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');

test('result overview neither loads nor renders per-match Elo adjustments', () => {
  assert.doesNotMatch(appSource, /\.from\(['"]match_elo_changes['"]\)/);
  assert.doesNotMatch(appSource, /mc-elo-changes/);
  assert.doesNotMatch(styleSource, /mc-elo-changes/);
});

test('account cards use tournament labels across seasons and task groups', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'tippspiel.js'), 'utf8');
  const context = vm.createContext({
    escapeHtml: value => String(value),
    renderResultTaskStatus: () => '',
    renderTaskMatchup: () => '',
    renderResultTaskBody: () => '',
    formatMatchAt: () => ''
  });
  for (const name of ['getTaskNumber', 'getTaskMatchLabel', 'getTaskLeagueLabel', 'renderResultTaskCard']) {
    const fn = source.match(new RegExp(`  function ${name}\\([^]*?\\n  }`));
    assert.ok(fn, `${name} exists`);
    vm.runInContext(fn[0], context);
  }
  for (const filename of ['data2026.js', 'data-winter-2026.js', 'data-cup-2027.js']) {
    const seasonContext = vm.createContext({ window: {} });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'data', filename), 'utf8'), seasonContext);
    for (const match of seasonContext.window.PADEL_SEASON.matches) {
      const task = {
        match_id: match.id,
        display_label: match.displayLabel,
        competition_stage: (match.stage || 'league').replaceAll('-', '_'),
        league_label: seasonContext.window.PADEL_SEASON.title,
        task_type: 'enter'
      };
      const label = match.displayLabel || `Partie ${match.id.match(/\d+$/)[0]}`;
      for (const group of ['review', 'past', 'future', 'planned']) {
        assert.ok(context.renderResultTaskCard(task, group).includes(
          `<span class="widget-label">${task.league_label} · ${label}</span>`
        ), `${filename}: ${match.id} in ${group} uses ${label}`);
      }
      if (filename !== 'data2026.js') {
        assert.equal(context.getTaskMatchLabel({ ...task, display_label: null }), label);
      }
    }
  }
});

test('account tasks require four distinct players assigned as two complete teams', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'tippspiel.js'), 'utf8');
  const lineup = [
    { player_id: 'a', team: 1 }, { player_id: 'b', team: 1 },
    { player_id: 'c', team: 2 }, { player_id: 'd', team: 2 }
  ];
  let matches = [
    { id: 'complete', display_label: 'Halbfinale 2', match_players: lineup },
    { id: 'empty', match_players: [] },
    { id: 'partial', match_players: lineup.slice(0, 3) },
    { id: 'duplicate', match_players: [...lineup.slice(0, 3), { player_id: 'a', team: 2 }] },
    { id: 'unbalanced', match_players: lineup.map((player, index) => ({ ...player, team: index < 3 ? 1 : 2 })) },
    { id: 'missing-player', match_players: [...lineup.slice(0, 3), { player_id: null, team: 2 }] }
  ];
  const tasks = [...matches, { id: 'missing-match' }].flatMap(match =>
    ['enter', 'review', 'waiting'].map(task_type => ({ match_id: match.id, task_type }))
  );
  let lookupError = null;
  const state = {
    extendedPlayerFeatures: true,
    client: {
      from(table) {
        return {
          select(columns) {
            if (table === 'players') return { order: async () => ({ data: [] }) };
            assert.equal(table, 'matches');
            assert.equal(columns, 'id, display_label, match_players(player_id, team)');
            return { in: async (field, ids) => {
              assert.equal(field, 'id');
              assert.ok(ids.includes('partial'));
              return { data: matches, error: lookupError };
            } };
          }
        };
      },
      async rpc(name) {
        return { data: name === 'get_my_result_tasks' ? tasks : [{ id: 'training' }] };
      }
    }
  };
  const context = vm.createContext({ state, isPlayerAccount: () => true, renderTrainingForm() {} });
  for (const name of ['hasCompleteMatchLineup', 'loadPlayerTools']) {
    const fn = source.match(new RegExp(`  (?:async )?function ${name}\\([^]*?\\n  }`));
    assert.ok(fn);
    vm.runInContext(fn[0], context);
  }
  await context.loadPlayerTools();
  assert.equal(state.resultTasks.length, 3);
  assert.ok(state.resultTasks.every(task => task.match_id === 'complete' && task.display_label === 'Halbfinale 2'));
  assert.equal(state.trainingTasks.length, 1);

  matches = matches.map(match => match.id === 'partial' ? { ...match, match_players: lineup } : match);
  await context.loadPlayerTools();
  assert.equal(state.resultTasks.filter(task => task.match_id === 'partial').length, 3);

  lookupError = new Error('Lineup lookup failed');
  await assert.rejects(context.loadPlayerTools(), /Lineup lookup failed/);
  assert.equal(state.resultTasks.length, 0);
});
