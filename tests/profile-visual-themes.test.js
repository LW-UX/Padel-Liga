const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260909160000_profile_visual_themes.sql'),
  'utf8'
);

function loadSeasonOptions() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'data/seasons.js'), 'utf8'), context);
  return JSON.parse(JSON.stringify(context.window.PADEL_SEASONS));
}

function evaluateProfileTheme(seasonId, achievement, seasons) {
  const colors = app.match(/const PROFILE_SEASON_COLORS = Object\.freeze\(\{[\s\S]*?\}\);/);
  const fallback = app.match(/const DEFAULT_PROFILE_SEASON_COLOR = PROFILE_SEASON_COLORS\.neutral;/);
  const theme = app.match(/function getSeasonVisualTheme\(seasonId, seasons = getSeasonOptions\(\)\) \{[\s\S]*?\n\}/);
  const seasonColor = app.match(/function getPlayerProfileSeasonColor\(seasonId, seasons = getSeasonOptions\(\)\) \{[\s\S]*?\n\}/);
  const achievementContext = app.match(/function getPlayerProfileAchievementContext\(achievement, seasons = getSeasonOptions\(\)\) \{[\s\S]*?\n\}/);
  assert.ok(colors && fallback && theme && seasonColor && achievementContext);

  const context = { seasonId, achievement, seasons, result: null };
  vm.createContext(context);
  vm.runInContext(
    `${colors[0]}\n${fallback[0]}\n${theme[0]}\n${seasonColor[0]}\n${achievementContext[0]}\n` +
    `result = { color: getPlayerProfileSeasonColor(seasonId, seasons), context: getPlayerProfileAchievementContext(achievement, seasons) };`,
    context
  );
  return JSON.parse(JSON.stringify(context.result));
}

test('profile season colors are stable by visual theme instead of list position', () => {
  const seasons = loadSeasonOptions().reverse();

  assert.deepEqual(evaluateProfileTheme('2026', { seasonId: '2026' }, seasons), {
    color: '#FF8A5B',
    context: 'league'
  });
  assert.deepEqual(evaluateProfileTheme('winter-2026', { seasonId: 'winter-2026' }, seasons), {
    color: '#B794F6',
    context: 'league'
  });
  assert.deepEqual(evaluateProfileTheme('cup-2027', { seasonId: 'cup-2027' }, seasons), {
    color: '#50B7F5',
    context: 'cup'
  });
  assert.deepEqual(evaluateProfileTheme('unknown', { seasonId: null }, seasons), {
    color: '#7E828B',
    context: 'league'
  });
  assert.doesNotMatch(app, /function getPlayerProfileSeasonColor\(index\)[\s\S]*?COLORS\[index/);
});

test('league, ranking and cup achievements use their selected metal colors', () => {
  assert.match(style, /--gold:\s+#FFD000;/);
  assert.match(style, /--silver:\s+#ADC8D8;/);
  assert.match(style, /--cup-gold:\s+#C59600;/);
  assert.match(style, /--cup-silver:\s+#7F98A8;/);
  assert.match(style, /\.r1 \.rn \{ color: var\(--gold\)/);
  assert.match(style, /\.r2 \.rn \{ color: var\(--silver\)/);
  assert.match(style, /\.player-profile-achievement-winner\.player-profile-achievement-cup \{ --achievement-color: var\(--cup-gold\); \}/);
  assert.match(style, /\.player-profile-achievement-finalist\.player-profile-achievement-cup \{ --achievement-color: var\(--cup-silver\); \}/);
  assert.match(app, /player-profile-achievement-\$\{kind\} player-profile-achievement-\$\{context\}/);
});

test('public season interfaces expose validated visual themes', () => {
  assert.match(migration, /add column if not exists visual_theme text not null default 'neutral'/);
  assert.match(migration, /visual_theme in \('summer', 'winter', 'cup', 'neutral'\)/);
  assert.match(migration, /when '2026' then 'summer'/);
  assert.match(migration, /when 'winter-2026' then 'winter'/);
  assert.match(migration, /when 'cup-2027' then 'cup'/);
  assert.match(migration, /visual_theme text[\s\S]*season\.visual_theme/);
  assert.match(migration, /'visualTheme', season\.visual_theme/);
  assert.match(app, /visualTheme: season\.visual_theme \|\| staticOptions\.get\(season\.id\)\?\.visualTheme \|\| 'neutral'/);
});
