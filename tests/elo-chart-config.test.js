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
