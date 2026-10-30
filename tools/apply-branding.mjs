// Aktiviert ein Branding aus branding/<name>.css und überträgt dessen Werte an alle Stellen,
// die keine CSS-Variablen lesen können: Browserleiste, Safari-Tab-Symbol und App-Manifest.
// Die E-Mails verwenden vorerst fest die Farben des OG-Designs.
// Aufruf: node tools/apply-branding.mjs [name]   (ohne Name wird das aktive Branding neu übertragen)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const write = (file, content) => fs.writeFileSync(path.join(root, file), content);

const PAGES = ['index.html', 'tipp/index.html'];
const BRANDING_LINK = /(<link rel="stylesheet" href="(?:\.\.\/)?)branding\/([a-z0-9-]+)\.css\?v=[^"]*(">)/;

export function readBrandingVariables(css) {
  const rootBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  return Object.fromEntries([...rootBlock.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

export function getBrandingVersion(css) {
  return crypto.createHash('sha256').update(css).digest('hex').slice(0, 10);
}

export function getActiveBrandingName(html) {
  return html.match(BRANDING_LINK)?.[2] || null;
}

function replaceOnce(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`${label} nicht gefunden`);
  return source.replace(pattern, replacement);
}

function main() {
  const activeName = getActiveBrandingName(read('index.html'));
  const name = process.argv[2] || activeName;
  if (!name) throw new Error('Kein aktives Branding in index.html gefunden.');

  const css = read(`branding/${name}.css`);
  const variables = readBrandingVariables(css);
  const reference = readBrandingVariables(read('branding/og-design.css'));
  const missing = Object.keys(reference).filter(variable => !(variable in variables));
  if (missing.length) throw new Error(`branding/${name}.css definiert nicht: ${missing.join(', ')}`);

  const version = getBrandingVersion(css);
  for (const page of PAGES) {
    let html = read(page);
    html = replaceOnce(html, BRANDING_LINK, `$1branding/${name}.css?v=${version}$3`, `Branding-Link in ${page}`);
    html = replaceOnce(html, /<meta name="theme-color" content="[^"]*">/, `<meta name="theme-color" content="${variables['--bg']}">`, `theme-color in ${page}`);
    if (html.includes('rel="mask-icon"')) {
      html = html.replace(/(<link rel="mask-icon" href="[^"]*" color=")[^"]*(">)/, `$1${variables['--accent']}$2`);
    }
    write(page, html);
  }

  let manifest = read('manifest.webmanifest');
  manifest = replaceOnce(manifest, /("background_color": ")[^"]*(")/, `$1${variables['--bg']}$2`, 'background_color im Manifest');
  manifest = replaceOnce(manifest, /("theme_color": ")[^"]*(")/, `$1${variables['--bg']}$2`, 'theme_color im Manifest');
  write('manifest.webmanifest', manifest);

  console.log(`Branding "${name}" übertragen (Version ${version}).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
