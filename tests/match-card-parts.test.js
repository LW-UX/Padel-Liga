const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const sources = ['js/app.js', 'js/tippspiel.js', 'style.css', 'tipp.css']
  .map(file => fs.readFileSync(path.join(root, file), 'utf8'))
  .join('\n');

test('match cards share one set of part classes', () => {
  assert.match(style, /\.match-card \{[\s\S]*?border-radius: var\(--container-radius-sm\);[\s\S]*?background: color-mix\(in srgb, var\(--surface\) 33%, transparent\);/);
  assert.match(style, /\.match-card\.is-played \{ background: var\(--surface\); \}/);
  assert.match(style, /\.match-team\.is-winner \{ font-weight: 600; \}/);
  assert.match(style, /\.match-team\.is-loser \{ color: var\(--muted\); \}/);
  assert.match(style, /\.match-player \{[\s\S]*?flex: 0 1 auto;[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/);
  assert.match(style, /\.score \{[\s\S]*?font-weight: 600;/);
  assert.match(style, /\.match-meta \{ color: var\(--dim\); font-size: var\(--text-sm\); \}/);
  assert.match(style, /\.match-prob \{[\s\S]*?font-weight: 400;/);
});

test('old per-family names for shared match parts are gone', () => {
  for (const name of ['mc-player-name', 'mc-players', 'mini-match-winner', 'mini-match-loser', 'mini-match-prob', 'calculator-match-complete']) {
    assert.doesNotMatch(sources, new RegExp(`\\b${name}\\b`), name);
  }
});
