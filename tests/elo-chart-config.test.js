const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const styleSource = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

test('Elo history chart starts at 500 and is 620 pixels high', () => {
  assert.match(appSource, /min:\s*500,\s*max:\s*1250/);
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
  assert.match(appSource, /external:\s*externalPlayerProfileEloTooltip/);
  assert.match(appSource, /external:\s*externalEloTooltip/);
  assert.match(appSource, /external:\s*externalPlacementTooltip/);
  assert.match(styleSource, /\.player-profile-chart-wrap\s*\{[^}]*position:\s*relative;/);
  assert.match(appSource, /getOrCreateChartTooltip\(chartInstance, 'elo-chart-tooltip'\)/);
  assert.match(appSource, /getOrCreateChartTooltip\(chartInstance, 'placement-chart-tooltip'\)/);
  assert.match(appSource, /getOrCreateChartTooltip\(chartInstance, 'player-profile-chart-tooltip'\)/);
  assert.match(styleSource, /\.elo-chart-tooltip\s*\{\s*width:\s*260px;/);
  assert.match(styleSource, /\.placement-chart-tooltip\s*\{\s*width:\s*220px;/);
  assert.match(styleSource, /\.player-profile-chart-tooltip\s*\{[^}]*width:\s*auto;[^}]*min-width:\s*210px;/);
});

test('ranking and calculator help tooltips open toward the viewport center', () => {
  assert.match(appSource, /function positionHelpTooltip\(anchor\) \{[\s\S]*anchorViewportX <= window\.innerWidth \/ 2/);
  assert.match(appSource, /help-tooltip-opens-right/);
  assert.match(appSource, /help-tooltip-opens-left/);
  assert.match(appSource, /if \(helpIcon\) positionHelpTooltip\(helpIcon\)/);
  assert.match(appSource, /--help-tooltip-anchor-y/);
  assert.match(styleSource, /top:\s*var\(--help-tooltip-anchor-y\);[\s\S]*transform:\s*none;/);
  assert.match(styleSource, /\.th-help-wrap\.help-tooltip-opens-right \.help-tooltip[\s\S]*left:\s*calc\(var\(--help-tooltip-anchor-x\) \+ 10px\)/);
  assert.match(styleSource, /\.th-help-wrap\.help-tooltip-opens-left \.help-tooltip[\s\S]*right:\s*calc\(100% - var\(--help-tooltip-anchor-x\) \+ 10px\)/);
});

test('player profile Elo history connects seasons with a color transition', () => {
  const segmentColorSource = appSource.match(
    /function getPlayerProfileSegmentColor\(context, pointColors = \[\]\) \{[\s\S]*?(?=\nfunction renderPlayerProfileEloChart)/
  )?.[0] || '';
  const getSegmentColor = vm.runInNewContext(`(${segmentColorSource.replace(
    'function getPlayerProfileSegmentColor',
    'function'
  )})`);
  const gradients = [];
  const context = {
    p0DataIndex: 0,
    p1DataIndex: 1,
    chart: {
      scales: { x: { getPixelForValue: value => value * 100 } },
      ctx: {
        createLinearGradient(...coordinates) {
          const gradient = {
            coordinates,
            stops: [],
            addColorStop(offset, color) { this.stops.push([offset, color]); }
          };
          gradients.push(gradient);
          return gradient;
        }
      }
    }
  };

  assert.equal(getSegmentColor(context, ['#111111', '#111111']), '#111111');
  const transition = getSegmentColor(context, ['#111111', '#eeeeee']);
  assert.deepEqual(transition.coordinates, [0, 0, 100, 0]);
  assert.deepEqual(transition.stops, [[0, '#111111'], [1, '#eeeeee']]);
  assert.match(appSource, /const datasets = \[\{[\s\S]*data: values,[\s\S]*pointBackgroundColor: pointColors,[\s\S]*segment:/);
});
