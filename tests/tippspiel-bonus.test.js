const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const tipping = fs.readFileSync(path.join(root, 'js/tippspiel.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'tipp/index.html'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261027120000_prediction_bonus_questions.sql'),
  'utf8'
);
const summerMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261028130000_summer_2026_prediction_bonus_questions.sql'),
  'utf8'
);
const bonusCountMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261028140000_count_bonus_questions_as_predictions.sql'),
  'utf8'
);
const wordingMigration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261028150000_update_prediction_bonus_question_wording.sql'),
  'utf8'
);

function functionSource(name) {
  const match = tipping.match(new RegExp('  function ' + name + '\\([^]*?\\n  }'));
  assert.ok(match, name);
  return match[0];
}

test('winter bonus questions have a server-enforced second-matchday deadline', () => {
  assert.match(migration, /create table public\.prediction_bonus_questions/);
  assert.match(migration, /create table public\.prediction_bonus_selections/);
  assert.match(migration, /'2026-11-16 00:00:00 Europe\/Berlin'::timestamptz/);
  assert.match(migration, /Die sechs Bonustipps für Winter 2026 konnten nicht vollständig angelegt werden/);
  assert.match(migration, /if now\(\) >= selected_question\.lock_at/);
  assert.match(migration, /revoke all on public\.prediction_bonus_selections from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.save_prediction_bonus_answers\(text, text\[\]\) to authenticated/);
});

test('bonus scoring uses the six agreed questions and league-only Elo changes', () => {
  for (const type of [
    'final_four_players', 'champion', 'league_elo_gain',
    'league_winner', 'league_game_difference', 'company_winner'
  ]) assert.match(migration, new RegExp(`'${type}'`));

  assert.match(migration, /match\.competition_stage = 'league'[\s\S]*match\.counts_for_elo/);
  assert.match(migration, /sum\(stats\.points\)::numeric \/ count\(\*\)::numeric as average_points/);
  assert.match(migration, /order by average_points desc, game_difference desc/);
  assert.match(migration, /dense_rank\(\) over \(\s*order by points desc, game_difference desc, games_for desc\s*\)/);
  assert.match(migration, /dense_rank\(\) over \(order by game_difference desc\)/);
  assert.match(migration, /dense_rank\(\) over \(order by elo_gain desc\)/);
  assert.match(migration, /order by wins desc, game_difference desc, games_won desc, league_rank, player_id/);
  assert.doesNotMatch(migration, /from public\.player_achievements as achievement/);
  assert.match(migration, /count\(\*\)::integer \* question\.points_per_correct/);
  assert.match(migration, /max_selections, points_per_correct[\s\S]*4::smallint/);
});

test('summer 2026 exposes completed bonus results without retroactive points', () => {
  assert.match(summerMigration, /where season\.id = '2026'/);
  assert.match(summerMigration, /'2026-05-24T22:00:00Z'::timestamptz/);
  assert.match(summerMigration, /achievement\.kind in \('winner', 'final_four'\)/);
  assert.match(summerMigration, /semifinal_status\.match_count > 0/);
  assert.doesNotMatch(summerMigration, /insert into public\.prediction_bonus_selections/);
  assert.match(page, /id="prediction-bonus-season-info"/);
  assert.match(fs.readFileSync(path.join(root, 'js/tipp-page.js'), 'utf8'), /Für Sommer 2026 werden die sechs Bonustipps rückblickend/);
});

test('partial Final Four answers score every hit and the total maximum is 36 points', () => {
  const correct = new Set(['a', 'b', 'c', 'd']);
  const score = answers => answers.filter(answer => correct.has(answer)).length * 4;

  assert.deepEqual([0, 1, 2, 3, 4].map(hitCount =>
    score(['a', 'b', 'c', 'd'].slice(0, hitCount))
  ), [0, 4, 8, 12, 16]);
  assert.equal(score(['a', 'b', 'wrong']), 8);
  assert.equal(score(['a', 'b', 'c', 'd']) + (5 * 4), 36);
});

test('client locking is exact and a Final Four answer stays incomplete below four choices', () => {
  const state = {
    bonusAnswers: new Map([['final-four', ['a', 'b', 'c']]]),
    bonusSaving: new Set()
  };
  const context = vm.createContext({ state });
  vm.runInContext([
    functionSource('isBonusQuestionOpen'),
    functionSource('getBonusAnswers'),
    functionSource('isBonusQuestionComplete'),
    functionSource('getBonusStatusChip')
  ].join('\n'), context);
  const question = {
    question_id: 'final-four',
    max_selections: 4,
    is_open: true,
    lock_at: '2026-11-15T23:00:00Z',
    resolved: false
  };

  vm.runInContext("Date.now = () => Date.parse('2026-11-15T22:59:59.999Z')", context);
  assert.equal(context.isBonusQuestionOpen(question), true);
  assert.equal(context.isBonusQuestionComplete(question), false);
  assert.equal(context.getBonusStatusChip(question).label, 'Gespeichert');

  state.bonusAnswers.set('final-four', ['a', 'b', 'c', 'd']);
  assert.equal(context.isBonusQuestionComplete(question), true);

  vm.runInContext("Date.now = () => Date.parse('2026-11-15T23:00:00Z')", context);
  assert.equal(context.isBonusQuestionOpen(question), false);
  assert.equal(context.getBonusStatusChip(question).label, 'Gesperrt');

  question.resolved = true;
  question.points = 0;
  assert.equal(context.getBonusStatusChip(question).label, '0 Punkte');

  state.bonusAnswers.delete('final-four');
  assert.equal(context.getBonusStatusChip(question).label, 'Kein Tipp');
});

test('the save RPC rejects duplicates, limits selections and validates season options', () => {
  assert.match(migration, /cardinality\(cleaned_answers\) <> \([\s\S]*count\(distinct answer\)/);
  assert.match(migration, /Eine Antwort darf nicht mehrfach ausgewählt werden/);
  assert.match(migration, /cardinality\(cleaned_answers\) > selected_question\.max_selections/);
  assert.match(migration, /answer\.value = any\(season\.organizations\)/);
  assert.match(migration, /participant\.season_id = selected_question\.season_id[\s\S]*participant\.player_id = answer\.value/);
});

test('bonus cards share the regular tipping lists and preserve the requested ordering', () => {
  assert.match(tipping, /const openCards = \[[\s\S]*incompleteBonusQuestions\.map\(renderBonusQuestion\)[\s\S]*openMatches\.map\(renderMatch\)[\s\S]*completeBonusQuestions\.map\(renderBonusQuestion\)/);
  assert.match(tipping, /Bonustipps \(\$\{bonusQuestions\.length\}\)/);
  assert.match(tipping, /data-bonus-question=/);
  assert.match(tipping, /const disabled = !isOpen \|\| state\.bonusSaving\.has\(question\.question_id\)/);
  assert.match(tipping, /return \{ label: 'Gesperrt', classes: 'is-locked' \}/);
  assert.match(tipping, /champion: \{[\s\S]*?order: 1,[\s\S]*?final_four_players: \{[\s\S]*?order: 2,[\s\S]*?league_winner: \{[\s\S]*?order: 3,[\s\S]*?league_game_difference: \{[\s\S]*?order: 4,[\s\S]*?league_elo_gain: \{[\s\S]*?order: 5,[\s\S]*?company_winner: \{[\s\S]*?order: 6,/);
  assert.match(tipping, /question: 'Welche Firma gewinnt nach Ø-Punkten je Teilnehmer\?'/);
  assert.match(tipping, /question: 'Wer wird der nächste Padel-Liga-Champion\?'/);
  assert.match(tipping, /question: 'Wer belegt nach der Ligaphase Platz 1\?'/);
  assert.match(tipping, /sort\(compareBonusQuestions\)/);
  assert.doesNotMatch(tipping, /prediction-bonus-selection-count|von \$\{selectionCount\} gewählt/);
  assert.match(tipping, /class="viewer-picker prediction-bonus-picker\$\{searchable \? '' : ' prediction-bonus-picker--no-search'\}"/);
  assert.match(tipping, /class="viewer-split-button">\s*<div class="viewer-combobox">[\s\S]*data-bonus-picker-toggle[\s\S]*data-bonus-picker-search/);
  assert.match(tipping, /data-bonus-picker-search[\s\S]*role="combobox"[\s\S]*placeholder="Spieler suchen …"/);
  assert.match(tipping, /placeholder: isCompanyPicker \? 'Firma auswählen' : 'Spieler auswählen'/);
  assert.match(tipping, /searchable: !isCompanyPicker/);
  assert.match(tipping, /const selectedValues = question\.resolved\s*\? \[\]/);
  assert.match(tipping, /const ownAnswer = question\.resolved && answers\.length[\s\S]*Dein Tipp: \$\{answers\.map\(getBonusOptionLabel\)\.map\(escapeHtml\)\.join\(', '\)\}/);
  assert.match(tipping, /const selectionControls = selects\s*\? `<div class="prediction-bonus-selects">\$\{selects\}<\/div>`\s*: '';/);
  assert.match(tipping, /<div class="prediction-bonus-options">\s*\$\{selectionControls\}\s*\$\{ownAnswer\}\s*\$\{result\}/);
  assert.doesNotMatch(tipping, /Zum Tippen einloggen/);
  assert.match(tipping, /function filterBonusPlayerOptions\([\s\S]*bonusPickerSearchText/);
  assert.doesNotMatch(tipping, /<select[\s\S]*data-bonus-question/);
  assert.match(style, /\.prediction-match-card\.prediction-bonus-card/);
  assert.match(style, /\.prediction-bonus-picker,[\s\S]*\.prediction-bonus-picker \.viewer-combobox \{ width: 100%; \}/);
  assert.match(style, /\.viewer-picker\.open\.prediction-bonus-picker--no-search \.viewer-combobox \.secondary-button/);
  assert.doesNotMatch(style, /\.prediction-bonus-picker \.viewer-search-input \{/);
  assert.match(style, /\.prediction-bonus-copy \{[\s\S]*display: flex;[\s\S]*align-items: baseline;/);
  assert.match(style, /\.prediction-bonus-copy span \{[\s\S]*text-wrap: balance;/);
  assert.match(style, /\.prediction-bonus-answer,[\s\S]*\.prediction-bonus-result \{/);
  assert.match(style, /\.prediction-bonus-options \{[\s\S]*grid-column: 1 \/ -1;[\s\S]*grid-row: 2;/);
  assert.doesNotMatch(page, /data-tip-nav="bonustipp/);
});

test('leaderboard exposes bonus points while exact and passive stay match-only', () => {
  assert.match(migration, /bonus_points bigint/);
  assert.match(migration, /coalesce\(match_totals\.points, 0\) \+ coalesce\(bonus_totals\.bonus_points, 0\)/);
  assert.match(page, /<th class="col-games">Tipps<\/th>[\s\S]*<th class="col-wins">Exakt<\/th>[\s\S]*<th class="col-passive">[\s\S]*Passiv[\s\S]*<th class="col-bonus">Bonus<\/th>[\s\S]*<th class="col-points">Gesamt<\/th>/);
  assert.match(tipping, /<td class="col-games">[\s\S]*<td class="col-wins">[\s\S]*<td class="col-passive"[\s\S]*<td class="col-bonus">[\s\S]*<td class="col-points rank-score">/);
  assert.match(page, /<th class="col-bonus">Bonus<\/th>/);
  assert.match(tipping, /<td class="col-bonus">\$\{Number\(entry\.bonus_points\) \|\| 0\}<\/td>/);
  assert.match(tipping, /const matchPoints = \(Number\(entry\?\.points\) \|\| 0\) - \(Number\(entry\?\.bonus_points\) \|\| 0\)/);
});

test('each answered bonus question counts as one leaderboard prediction', () => {
  assert.match(bonusCountMigration, /count\(distinct selection\.question_id\)::bigint as predictions_count/);
  assert.match(bonusCountMigration, /coalesce\(match_totals\.predictions_count, 0\) \+ coalesce\(bonus_totals\.predictions_count, 0\)/);
  assert.match(bonusCountMigration, /coalesce\(match_totals\.scored_count, 0\),\s*coalesce\(match_totals\.exact_count, 0\)/);
  assert.doesNotMatch(bonusCountMigration, /count\(selection\.answer\).*predictions_count/);
  assert.match(page, /Jede beantwortete Bonusfrage zählt in der Tipprangliste als eine Tippabgabe\./);
});

test('champion and league winner wording is consistent across both bonus seasons', () => {
  assert.match(wordingMigration, /when 'champion' then 'Wer wird der nächste Padel-Liga-Champion\?'/);
  assert.match(wordingMigration, /when 'league_winner' then 'Wer belegt nach der Ligaphase Platz 1\?'/);
  assert.match(wordingMigration, /question\.season_id in \('2026', 'winter-2026'\)/);
  assert.match(wordingMigration, /updated_count <> 4/);
});
