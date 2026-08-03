const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

test('home article fallback uses the latest published article instead of the first article', () => {
  const getCurrentArticleSource = appSource.match(
    /function getCurrentArticle\(\) \{[\s\S]*?\n\}/
  )?.[0] || '';

  assert.match(getCurrentArticleSource, /publishedArticles\.reduce/);
  assert.match(getCurrentArticleSource, /Array\.isArray\(article\.body\) && article\.body\.length/);
  assert.doesNotMatch(getCurrentArticleSource, /articles\[0\]/);
});
