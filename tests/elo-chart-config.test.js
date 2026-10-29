const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const styleSource = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

test('Elo history chart derives rounded bounds from its values and stays 620 pixels high', () => {
  const boundsSource = appSource.match(
    /function getStatisticsEloChartBounds\(datasets = \[\]\) \{[\s\S]*?\n\}/
  )?.[0] || '';
  const getBounds = vm.runInNewContext(
    `(() => { ${boundsSource}\nreturn getStatisticsEloChartBounds; })()`
  );

  assert.deepEqual({ ...getBounds([{ data: [760, null, 921] }, { data: [815] }]) }, { min: 700, max: 1000 });
  assert.deepEqual({ ...getBounds([{ data: [801, 1199] }]) }, { min: 750, max: 1250 });
  assert.deepEqual({ ...getBounds([{ data: [800, 1200] }]) }, { min: 750, max: 1250 });
  assert.deepEqual({ ...getBounds([{ data: [20, 30] }]) }, { min: 0, max: 100 });
  assert.match(appSource, /const eloBounds = getStatisticsEloChartBounds\(datasets\)/);
  assert.match(appSource, /min:\s*eloBounds\.min,\s*max:\s*eloBounds\.max/);
  assert.match(styleSource, /\.chart-wrap\s*\{[^}]*height:\s*620px;/);
});

test('chart tooltips open toward the center of the viewport', () => {
  const placementSource = appSource.match(
    /function getChartTooltipHorizontalTransform\(chartInstance, tooltip\) \{[\s\S]*?\n\}/
  )?.[0] || '';
  const getTransform = vm.runInNewContext(
    `(() => { ${placementSource}\nreturn getChartTooltipHorizontalTransform; })()`,
    { window: { innerWidth: 1200 } }
  );
  const chart = {
    canvas: { getBoundingClientRect: () => ({ left: 100 }) }
  };

  assert.equal(getTransform(chart, { caretX: 400 }), 'translate(12px, -50%)');
  assert.equal(getTransform(chart, { caretX: 700 }), 'translate(calc(-100% - 12px), -50%)');
  assert.match(appSource, /style\.transform = getChartTooltipHorizontalTransform\(chartInstance, tooltip\)/);
  assert.match(appSource, /external:\s*externalEloTooltip/);
  assert.match(appSource, /external:\s*externalPlacementTooltip/);
  assert.match(styleSource, /\.player-profile-chart-wrap\s*\{[^}]*position:\s*relative;/);
  assert.match(appSource, /getOrCreateChartTooltip\(chartInstance, 'elo-chart-tooltip'\)/);
  assert.match(appSource, /getOrCreateChartTooltip\(chartInstance, 'placement-chart-tooltip'\)/);
  assert.match(appSource, /getOrCreateChartTooltip\(chartHost, 'player-profile-chart-tooltip'\)/);
  assert.match(styleSource, /\.elo-chart-tooltip\s*\{\s*width:\s*260px;/);
  assert.match(styleSource, /\.placement-chart-tooltip\s*\{\s*width:\s*220px;/);
  assert.match(styleSource, /\.player-profile-chart-tooltip\s*\{[^}]*width:\s*auto;[^}]*min-width:\s*210px;/);
});

test('ranking and calculator help tooltips open into the available unclipped area', () => {
  assert.match(appSource, /function positionHelpTooltip\(anchor\) \{[\s\S]*anchor\.closest\('\.ranking-wrap'\)/);
  assert.match(appSource, /availableRight >= requiredSpace[\s\S]*availableLeft < requiredSpace/);
  assert.match(appSource, /help-tooltip-opens-right/);
  assert.match(appSource, /help-tooltip-opens-left/);
  assert.match(appSource, /if \(helpIcon\) positionHelpTooltip\(helpIcon\)/);
  assert.match(appSource, /--help-tooltip-anchor-y/);
  assert.match(styleSource, /top:\s*var\(--help-tooltip-anchor-y\);[\s\S]*transform:\s*none;/);
  assert.match(styleSource, /\.th-help-wrap\.help-tooltip-opens-right \.help-tooltip[\s\S]*left:\s*calc\(var\(--help-tooltip-anchor-x\) \+ 10px\)/);
  assert.match(styleSource, /\.th-help-wrap\.help-tooltip-opens-left \.help-tooltip[\s\S]*right:\s*calc\(100% - var\(--help-tooltip-anchor-x\) \+ 10px\)/);
});

test('player profile Elo history connects seasons with a color transition', () => {
  const segmentSource = appSource.match(
    /function getPlayerProfileControlPoints\(points, tension = 0\.2\) \{[\s\S]*?(?=\nfunction showPlayerProfileEloTooltip)/
  )?.[0] || '';
  const renderSegments = vm.runInNewContext(
    `(() => { ${segmentSource}\nreturn renderPlayerProfileEloSegments; })()`,
    { getDefaultProfileSeasonColor: () => '#777777' }
  );
  const points = [{ x: 0, y: 50 }, { x: 100, y: 20 }];

  const sameSeason = renderSegments(points, ['#111111', '#111111']);
  assert.equal(sameSeason.defs, '');
  assert.match(sameSeason.paths, /stroke="#111111"/);

  const transition = renderSegments(points, ['#111111', '#eeeeee']);
  assert.match(transition.defs, /<linearGradient id="player-profile-elo-gradient-0" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0">/);
  assert.match(transition.defs, /<stop offset="0" stop-color="#111111"\/><stop offset="1" stop-color="#eeeeee"\/>/);
  assert.match(transition.paths, /stroke="url\(#player-profile-elo-gradient-0\)"/);
  assert.match(transition.paths, /d="M0,50 C[\d.]+,[\d.]+ [\d.]+,[\d.]+ 100,20"/);
});
