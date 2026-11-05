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
vm.runInNewContext(fs.readFileSync(path.join(projectRoot, 'data/players.js'), 'utf8'), context);
vm.runInNewContext(fs.readFileSync(path.join(projectRoot, 'data/seasons.js'), 'utf8'), context);
vm.runInNewContext(fs.readFileSync(path.join(projectRoot, 'js/season-routing.js'), 'utf8'), context);
vm.runInNewContext(fs.readFileSync(path.join(projectRoot, 'data/supabase-config.js'), 'utf8'), context);

// Partien liegen ausschließlich in der Datenbank; die öffentliche Saisonabfrage liefert sie für die Unterseiten.
async function loadDatabaseMatches(season) {
  const config = context.window.PADEL_SUPABASE_CONFIG;
  if (!config?.url || !config?.publishableKey) throw new Error('Supabase ist nicht konfiguriert.');
  const response = await fetch(new URL('/rest/v1/rpc/get_public_season', config.url), {
    method: 'POST',
    headers: {
      apikey: config.publishableKey,
      authorization: `Bearer ${config.publishableKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ p_season_id: season.databaseId || season.id })
  });
  if (!response.ok) throw new Error(`Saison ${season.id} konnte nicht geladen werden (HTTP ${response.status}).`);
  const payload = await response.json();
  if (!Array.isArray(payload?.matches)) throw new Error(`Saison ${season.id} liefert keine Partien.`);
  return payload.matches;
}

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

  const playerIds = new Set();
  for (const player of context.window.PADEL_PLAYERS || []) {
    const id = String(player?.id || '');
    if (!id) continue;
    if (playerIds.has(id)) throw new Error(`Doppelter Spielerpfad ${season.route}/spieler/${id}/`);
    playerIds.add(id);
    writePage(
      'index.html',
      path.join(outputRoot, season.route, 'spieler', id, 'index.html'),
      '../../../'
    );
  }

  const matches = await loadDatabaseMatches(season);
  const slugs = new Set();
  for (const match of matches) {
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

  const liveMatches = matches
    .map(match => ({ match, slug: context.window.PadelSeasonRouting.getLiveSlug(match) }))
    .filter(item => item.slug);
  if (liveMatches.length) {
    writePage('index.html', path.join(outputRoot, season.route, 'live', 'index.html'), '../../');
    const liveSlugs = new Set();
    for (const { slug } of liveMatches) {
      if (liveSlugs.has(slug)) throw new Error(`Doppelter Livepfad ${season.route}/live/${slug}/`);
      liveSlugs.add(slug);
      writePage(
        'index.html',
        path.join(outputRoot, season.route, 'live', slug, 'index.html'),
        '../../../'
      );
    }
  }
}
