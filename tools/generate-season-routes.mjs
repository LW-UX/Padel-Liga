import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.resolve(process.argv[2] || projectRoot);
const context = {
  window: { location: new URL('https://example.test/') },
  document: { baseURI: 'https://example.test/' },
  URL,
  URLSearchParams
};
vm.runInNewContext(fs.readFileSync(path.join(projectRoot, 'data/seasons.js'), 'utf8'), context);
vm.runInNewContext(fs.readFileSync(path.join(projectRoot, 'js/season-routing.js'), 'utf8'), context);

function addBase(html, href) {
  return html.replace('<head>', `<head>\n  <base href="${href}">`);
}

function writePage(source, destination, baseHref) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, addBase(fs.readFileSync(path.join(projectRoot, source), 'utf8'), baseHref));
}

const pages = [
  { source: 'index.html', destination: route => path.join(outputRoot, route, 'index.html'), baseHref: '../' },
  { source: 'tipp/index.html', destination: route => path.join(outputRoot, 'tipp', route, 'index.html'), baseHref: '../' }
];

for (const season of context.window.PADEL_SEASONS || []) {
  if (!season.route) continue;
  for (const page of pages) {
    writePage(page.source, page.destination(season.route), page.baseHref);
  }

  const seasonFile = String(season.file || '').split('?')[0];
  if (!seasonFile) continue;
  context.window.PADEL_SEASON = null;
  vm.runInNewContext(fs.readFileSync(path.join(projectRoot, seasonFile), 'utf8'), context);
  const slugs = new Set();
  for (const match of context.window.PADEL_SEASON?.matches || []) {
    const slug = context.window.PadelSeasonRouting.getMatchSlug(match);
    if (!slug) continue;
    if (slugs.has(slug)) throw new Error(`Doppelter Partiepfad ${season.route}/partie/${slug}/`);
    slugs.add(slug);
    writePage(
      'index.html',
      path.join(outputRoot, season.route, 'partie', slug, 'index.html'),
      '../../../'
    );
  }
}
