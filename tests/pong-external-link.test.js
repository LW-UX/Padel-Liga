const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('league opens the standalone PadelPong site without season coupling', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

  assert.match(html, /id="pong-link" href="https:\/\/lw-ux\.github\.io\/PadelPong\/" target="_blank" rel="noopener"/);
  assert.doesNotMatch(html, /js\/arcade-link\.js|href="arcade\/"|id="arcade-link"/);
  assert.match(style, /\.pong-link\s*\{/);
  assert.doesNotMatch(style, /\.arcade-link\b/);
});
