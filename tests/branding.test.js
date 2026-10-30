const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const loadTool = () => import(pathToFileURL(path.join(root, 'tools/apply-branding.mjs')).href);

test('headings get their look from the element instead of per-area classes', () => {
  const style = read('style.css');
  assert.match(style, /\bh2 \{[^}]*font-family: var\(--font-heading\);[^}]*font-weight: var\(--heading-font-weight\);/);
  assert.match(style, /\bh3,\s*\.eyebrow \{[^}]*text-transform: uppercase;/);

  const scripts = fs.readdirSync(path.join(root, 'js')).map(name => `js/${name}`);
  for (const file of ['index.html', 'tipp/index.html', 'style.css', 'account.css', 'match-statistics.css', 'whats-new.css', ...scripts]) {
    assert.doesNotMatch(read(file), /\bsh-title(?!-)|\bwidget-label\b|\bspieltag-label\b|\bspieltag-group\b/, file);
  }
});

test('every branding defines the same variables as the OG-Design', async () => {
  const { readBrandingVariables } = await loadTool();
  const reference = Object.keys(readBrandingVariables(read('branding/og-design.css'))).sort();
  assert.ok(reference.includes('--bg') && reference.includes('--button-radius') && reference.includes('--container-radius') && reference.includes('--section-gap') && reference.includes('--widget-bg'));

  for (const file of fs.readdirSync(path.join(root, 'branding')).filter(name => name.endsWith('.css'))) {
    assert.deepEqual(Object.keys(readBrandingVariables(read(`branding/${file}`))).sort(), reference, file);
  }
});

test('shared stylesheets keep no brand values', () => {
  for (const file of ['style.css', 'account.css', 'match-statistics.css', 'whats-new.css']) {
    const css = read(file);
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgba?\(|@font-face/, file);
    assert.doesNotMatch(css, /^\s*--(bg|accent|font-body|text-heading|section-gap|button-radius|container-radius|widget-bg|widget-padding):/m, file);
    assert.doesNotMatch(css, /--radius-(xs|sm|lg)\b|--widget-radius/, file);
  }
});

test('pages and manifest follow the active branding', async () => {
  const { readBrandingVariables, getActiveBrandingName, getBrandingVersion } = await loadTool();
  const index = read('index.html');
  const name = getActiveBrandingName(index);
  assert.ok(name);
  const css = read(`branding/${name}.css`);
  const variables = readBrandingVariables(css);
  const version = getBrandingVersion(css);

  for (const file of ['index.html', 'tipp/index.html']) {
    const html = read(file);
    assert.equal(getActiveBrandingName(html), name, file);
    assert.ok(html.includes(`branding/${name}.css?v=${version}"`), `${file}: Branding-Version veraltet, tools/apply-branding.mjs ausführen`);
    assert.ok(html.indexOf(`branding/${name}.css`) < html.indexOf('style.css'), `${file}: Branding vor style.css laden`);
    assert.ok(html.includes(`<meta name="theme-color" content="${variables['--bg']}">`), file);
  }
  assert.ok(index.includes(`color="${variables['--accent']}"`));

  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.background_color, variables['--bg']);
  assert.equal(manifest.theme_color, variables['--bg']);
});

test('the admin design preview offers every branding with matching wireframe colors', async () => {
  const { readBrandingVariables } = await loadTool();
  const source = read('js/branding-preview.js');
  const offered = [...source.matchAll(/name: '([a-z0-9-]+)',\s*label: '[^']+',\s*colors: \{([^}]*)\}/g)]
    .map(([, name, colors]) => [name, Object.fromEntries([...colors.matchAll(/(\w+): '([^']+)'/g)].map(([, key, value]) => [key, value]))]);
  const files = fs.readdirSync(path.join(root, 'branding')).filter(name => name.endsWith('.css')).map(name => name.slice(0, -4));
  assert.deepEqual(offered.map(([name]) => name).sort(), files.sort());

  for (const [name, colors] of offered) {
    const variables = readBrandingVariables(read(`branding/${name}.css`));
    for (const [key, value] of Object.entries(colors)) {
      assert.equal(value.toLowerCase(), variables[`--${key}`].toLowerCase(), `${name}: --${key}`);
    }
  }

  for (const file of ['index.html', 'tipp/index.html']) {
    const html = read(file);
    const branding = html.search(/branding\/[a-z0-9-]+\.css/);
    const earlyPreview = html.indexOf("localStorage.getItem('padel-branding-preview')");
    assert.ok(branding < earlyPreview && earlyPreview < html.indexOf('style.css'), `${file}: Vorschau direkt nach dem Branding anwenden`);
    assert.ok(html.indexOf('js/branding-preview.js') < html.indexOf('js/account.js'), `${file}: Vorschau vor dem Konto laden`);
    assert.match(html, /data-account-branding hidden/);
  }
});

test('the design preview announces a switch once the stylesheet applies and follows other documents', () => {
  const listeners = { link: {}, window: {} };
  const attributes = { href: 'branding/og-design.css?v=abc' };
  const stored = new Map();
  const events = [];
  const window = {
    localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
    addEventListener: (type, handler) => { listeners.window[type] = handler; },
    dispatchEvent: event => events.push(event.type)
  };
  const link = {
    dataset: {},
    getAttribute: name => attributes[name],
    setAttribute: (name, value) => { attributes[name] = value; },
    addEventListener: (type, handler) => { listeners.link[type] = handler; }
  };
  const document = { querySelector: selector => selector.includes('theme-color') ? null : link };
  class CustomEvent { constructor(type) { this.type = type; } }
  vm.runInNewContext(read('js/branding-preview.js'), { window, document, CustomEvent });

  window.PadelBrandingPreview.select('hanako-leben');
  assert.equal(attributes.href, 'branding/hanako-leben.css');
  assert.deepEqual(events, []);
  listeners.link.load();
  assert.deepEqual(events, ['padel:branding-change']);

  stored.delete('padel-branding-preview');
  listeners.window.storage({ key: 'padel-branding-preview' });
  assert.equal(attributes.href, 'branding/og-design.css?v=abc');
  assert.equal(window.PadelBrandingPreview.current(), 'og-design');
});

test('every branding offers readable, distinct player colors and lines without a match keep them', async () => {
  const { readBrandingVariables } = await loadTool();
  const luminance = hex => {
    const [r, g, b] = [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255)
      .map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (first, second) => {
    const [dark, light] = [luminance(first), luminance(second)].sort((a, b) => a - b);
    return (light + 0.05) / (dark + 0.05);
  };

  for (const file of fs.readdirSync(path.join(root, 'branding')).filter(name => name.endsWith('.css'))) {
    const variables = readBrandingVariables(read(`branding/${file}`));
    const colors = Array.from({ length: 18 }, (_, index) => variables[`--player-${index + 1}`]);
    assert.equal(new Set(colors).size, 18, file);
    for (const color of colors) {
      for (const background of ['--bg', '--surface']) {
        assert.ok(contrast(color, variables[background]) >= 4.5, `${file}: ${color} auf ${background}`);
      }
    }
  }

  const app = read('js/app.js');
  assert.doesNotMatch(app, /\bGRAY\b|\bCOLORS\b/);
  const fade = app.match(/function fadeChartColor\(color\) \{[\s\S]*?\n\}/)[0];
  assert.equal(vm.runInNewContext(`const CHART_FADED_ALPHA = '59';\n${fade}\nfadeChartColor('#112233D6');`), '#11223359');
});
