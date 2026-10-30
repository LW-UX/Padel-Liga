const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('header opens the standalone game without local dependencies or season coupling', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

  assert.match(html, /id="external-game-link" href="https:\/\/lw-ux\.github\.io\/PadelPong\/" target="_blank" rel="noopener"/);
  assert.doesNotMatch(html, /js\/arcade-link\.js|href="arcade\/"|id="arcade-link"|id="pong-link"/);
  assert.match(html, /class="secondary-button secondary-button--icon global-action" id="external-game-link"/);
  assert.doesNotMatch(style, /\.(?:arcade|pong)-link\b/);
});
