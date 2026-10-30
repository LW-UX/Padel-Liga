const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const loadTool = () => import(pathToFileURL(path.join(root, 'tools/apply-branding.mjs')).href);

test('every branding defines the same variables as the OG-Design', async () => {
  const { readBrandingVariables } = await loadTool();
  const reference = Object.keys(readBrandingVariables(read('branding/og-design.css'))).sort();
  assert.ok(reference.includes('--bg') && reference.includes('--button-radius') && reference.includes('--section-gap') && reference.includes('--widget-bg'));

  for (const file of fs.readdirSync(path.join(root, 'branding')).filter(name => name.endsWith('.css'))) {
    assert.deepEqual(Object.keys(readBrandingVariables(read(`branding/${file}`))).sort(), reference, file);
  }
});

test('shared stylesheets keep no brand values', () => {
  for (const file of ['style.css', 'account.css', 'match-statistics.css', 'whats-new.css']) {
    const css = read(file);
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgba?\(|@font-face/, file);
    assert.doesNotMatch(css, /^\s*--(bg|accent|font-body|text-heading|section-gap|button-radius|widget-bg|widget-padding):/m, file);
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
    const script = html.indexOf('js/branding-preview.js');
    assert.ok(branding < script && script < html.indexOf('style.css'), `${file}: Vorschau direkt nach dem Branding laden`);
    assert.match(html, /data-account-branding hidden/);
  }
});
