const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const seasonSource = fs.readFileSync(path.join(__dirname, '..', 'data', 'data2026.js'), 'utf8');
const scheduleMigrationSource = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260928130000_schedule_summer_2026_final_four.sql'),
  'utf8'
);

test('home article fallback uses the latest published article instead of the first article', () => {
  const getCurrentArticleSource = appSource.match(
    /function getCurrentArticle\(\) \{[\s\S]*?\n\}/
  )?.[0] || '';

  assert.match(getCurrentArticleSource, /publishedArticles\.reduce/);
  assert.match(getCurrentArticleSource, /Array\.isArray\(article\.body\) && article\.body\.length/);
  assert.doesNotMatch(getCurrentArticleSource, /articles\[0\]/);
});

test('home announcement stays separate from the article archive and appears before the current article', () => {
  assert.match(appSource, /homeAnnouncement: staticSeason\?\.homeAnnouncement \|\| null/);
  assert.match(appSource, /getElementById\('home-announcement'\)/);
  assert.match(htmlSource, /id="home-announcement"[\s\S]*home-app-hint[\s\S]*widget-articles/);
  assert.doesNotMatch(appSource, /home-articles'\)\.innerHTML = `[\s\S]*home-announcement/);
  assert.match(seasonSource, /"homeAnnouncement"/);
  assert.match(seasonSource, /"title": "Save the Date"/);
});

test('summer Final Four fallback contains the three approved start times', () => {
  assert.match(seasonSource, /"id": "partie28"[\s\S]*?"datum": "2026-10-08"[\s\S]*?"uhrzeit": "18\.00"/);
  assert.match(seasonSource, /"id": "partie29"[\s\S]*?"datum": "2026-10-08"[\s\S]*?"uhrzeit": "18\.30"/);
  assert.match(seasonSource, /"id": "partie30"[\s\S]*?"datum": "2026-10-08"[\s\S]*?"uhrzeit": "19\.00"/);
});

test('summer Final Four migration schedules exactly the three open matches', () => {
  assert.match(scheduleMigrationSource, /season-2026-partie-28'[\s\S]*2026-10-08 18:00/);
  assert.match(scheduleMigrationSource, /season-2026-partie-29'[\s\S]*2026-10-08 18:30/);
  assert.match(scheduleMigrationSource, /season-2026-partie-30'[\s\S]*2026-10-08 19:00/);
  assert.match(scheduleMigrationSource, /updated_matches <> 3/);
  assert.match(scheduleMigrationSource, /match\.result_details is null/);
});
