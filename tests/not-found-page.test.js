const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, '404.html'), 'utf8');

function resolveBase(href) {
  const source = html.match(/<script id="site-base-bootstrap">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(source, 'Basis-Skript der 404-Seite fehlt');

  const location = new URL(href);
  const document = {
    created: null,
    createElement(name) {
      assert.equal(name, 'base');
      return {};
    },
    head: {
      appendChild(element) { document.created = element; }
    }
  };
  const window = { location };
  vm.runInNewContext(source, { window, document, URL });
  return document.created?.href;
}

test('404 page resolves assets from the project root on deep GitHub Pages paths', () => {
  assert.equal(
    resolveBase('https://lw-ux.github.io/Padel-Liga/wi26/partie/unbekannt/'),
    '/Padel-Liga/'
  );
});

test('404 page uses the domain root on the custom domain', () => {
  assert.equal(resolveBase('https://padelliga.envidual.com/wi26/unbekannt/'), '/');
});

test('404 page keeps local file assets beside the page', () => {
  assert.equal(
    resolveBase('file:///Users/example/Padel-Liga/404.html'),
    'file:///Users/example/Padel-Liga/'
  );
});

test('404 page offers recovery, branding and no application bootstrap', () => {
  assert.match(html, /<a class="primary-button" href="\.\/">Zur Startseite<\/a>/);
  assert.match(html, /<button class="secondary-button" id="not-found-back"/);
  assert.match(html, /branding\/og-design\.css\?v=/);
  assert.doesNotMatch(html, /js\/(app|account|tipp-page)\.js/);
});
