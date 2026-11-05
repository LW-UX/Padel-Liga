// Erzeugt die eigenen Mauszeiger.
// Schwarze Zeiger (Schläger, Textnetz) sind in jedem Branding gleich und liegen als Dateien in assets/cursors/.
// Hände und Ball-Zeiger folgen der Akzentfarbe: Sie stehen als eingebettete Bilder in einem eigenen :root-Block am Ende
// jeder Datei branding/<name>.css. Eingebettete Bilder umgehen, dass Browser relative Pfade in CSS-Variablen
// unterschiedlich auflösen.
// Aufruf: node tools/build-cursors.mjs   (tools/apply-branding.mjs ruft das Werkzeug ebenfalls auf)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = '#ffffff';
const K = '#111111';
const SPIN_ANGLES = [0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5];
export const CURSOR_BLOCK_START = '/* Mauszeiger in der Akzentfarbe: erzeugt von tools/build-cursors.mjs, nicht von Hand ändern. */';
const CURSOR_BLOCK_PATTERN = /\n*\/\* Mauszeiger in der Akzentfarbe:[^\n]*\*\/\n:root \{[\s\S]*?\n\}\n?/;

const n = (v) => Number(v.toFixed(2));
const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 32 32">${inner}</svg>`;

// Form einmal weiß mit breitem Rand, darüber schwarz: so bleiben Schläger, Textnetz und Pfeile auf hellem und
// dunklem Grund sichtbar. Bälle und Hände haben keinen weißen Rand.
const HALO = 3.4;
const outlined = (shapes, width = HALO) => shapes.replace(/FILL/g, W).replace(/SW/g, width) + shapes.replace(/FILL/g, K).replace(/SW/g, 0.3);
const rect = (x, y, w, h, r) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="FILL" stroke="FILL" stroke-width="SW" stroke-linejoin="round"/>`;
const shape = (d) => `<path d="${d}" fill="FILL" stroke="FILL" stroke-width="SW" stroke-linejoin="round" stroke-linecap="round"/>`;

// Schlägerform wie das Schläger-Symbol der Tippseite.
const RACKET_HEAD = 'M12 1.5c3.4 0 5.6 2.7 5.6 6.2 0 3.6-2.4 6.6-5.6 6.6s-5.6-3-5.6-6.6c0-3.5 2.2-6.2 5.6-6.2Z';
function racket(transform, holes = true) {
  const body = shape(RACKET_HEAD) + shape('M9.9 13.3 11 16.8h2l1.1-3.5') + rect(10.7, 16.4, 2.6, 6, 1.2);
  const dots = holes ? [[10, 5.4], [14, 5.4], [12, 7.6], [10, 9.8], [14, 9.8]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="0.85" fill="${W}"/>`).join('') : '';
  return `<g transform="${transform}">${outlined(body)}${dots}</g>`;
}
const STANDARD_RACKET = 'translate(8 4) rotate(-25) scale(1.3) translate(-12 -1.5)';
const PROGRESS_RACKET = 'translate(7 3.4) rotate(-25) scale(1.12) translate(-12 -1.5)';
const bar = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="0.6" fill="${W}"/>`;
const zoomRacket = (plus) => svg(racket('translate(13 13) rotate(-45) scale(1.4) translate(-12 -8)', false) + bar(8.5, 11.6, 9, 2.8) + (plus ? bar(11.6, 8.5, 2.8, 9) : ''));

function textNet() {
  const knots = [8.5, 11.7, 14.9, 18.1, 21.3].map((y) => `<rect x="15.2" y="${y}" width="1.6" height="1" fill="${W}"/>`).join('');
  return svg(outlined(rect(10, 3, 12, 3.4, 1.2) + rect(14.6, 5, 2.8, 22, 0.6) + rect(11.5, 26, 9, 3, 1)) + knots);
}
// Hände in der Form des System-Zeigers: Fläche in der Akzentfarbe, Kontur nach der Farbregel unten.
// Die Fingerlinien beginnen jeweils oben an der Spitze des kürzeren Nachbarfingers, damit sie genau
// in die Kontur übergehen, und haben dieselbe Stärke wie die Kontur.
const HANDS = {
  pointer: {
    outline: 'M10 17V4.5a2 2 0 0 1 4 0V13V11.5a2 2 0 0 1 4 0V13V12.3a2 2 0 0 1 4 0V13.8V13.6a1.9 1.9 0 0 1 3.8 0V21C25.8 25 24 27.5 21.5 28.5H13.5C11.5 27 9.5 24.5 7.5 21.5L4.6 17.4a1.9 1.9 0 0 1 2.9-2.4L10 17Z',
    fingers: 'M14 11.5V17M18 12.3V17.2M22 13.6V17.6',
  },
  grab: {
    outline: 'M8 17V7.5a2 2 0 0 1 4 0V13V5a2 2 0 0 1 4 0V13V5.8a2 2 0 0 1 4 0V13.5V8.5a1.9 1.9 0 0 1 3.8 0V20C23.8 25 22 28 19.5 28.5H12.5C10.5 27.5 8.5 25 6.5 22L3.6 17.6a1.9 1.9 0 0 1 2.9-2.4L8 17Z',
    fingers: 'M12 7.5V15M16 5.8V15M20 8.5V15.5',
  },
  grabbing: {
    outline: 'M8 18V13a2 2 0 0 1 4 0V12a2 2 0 0 1 4 0V12.4a2 2 0 0 1 4 0V13.6a1.9 1.9 0 0 1 3.8 0V20C23.8 25 22 28 19.5 28.5H12.5C10.5 27.5 8.5 25 6.5 22.5L4.8 19.6a1.9 1.9 0 0 1 2.9-2.4L8 18Z',
    fingers: 'M12 13V16.5M16 12.4V16.5M20 13.6V17',
  },
};
// Auf dunklen Akzentfarben wie Blau und Rot werden Linien auf der Akzentfläche weiß (Kontur und Fingerlinien
// der Hände, Rand und Nähte der Bälle); auf helleren wie Gelb und Orange bleiben sie schwarz.
const WHITE_LINES_BELOW = 0.23;
const lineColor = (accent) => (luminance(accent) < WHITE_LINES_BELOW ? W : K);
// Die Zeigehand steht im selben Winkel wie der Standard-Schläger; Klickstelle ist die Fingerspitze.
const POINTER_HAND = 'translate(5 2) rotate(-25) scale(1.1) translate(-12 -2.5)';
function hand(kind, color, transform = '') {
  const { outline, fingers } = HANDS[kind];
  const line = lineColor(color);
  return svg(`<g transform="${transform}"><path d="${outline}" fill="${color}" stroke="${line}" stroke-width="1.5" stroke-linejoin="round"/><path d="${fingers}" stroke="${line}" stroke-width="1.5" stroke-linecap="round"/></g>`);
}

// end und bend legen fest, wo die Naht am Rand ansetzt und wie weit sie sich zur Mitte wölbt (Anteile des Radius).
function seams(cx, cy, r, angle, width, color, { end = [0.9, 0.5], bend = [0.3, 0.25] } = {}) {
  const side = (s) => `M${n(cx + s * r * end[0])} ${n(cy - r * end[1])}C${n(cx + s * r * bend[0])} ${n(cy - r * bend[1])} ${n(cx + s * r * bend[0])} ${n(cy + r * bend[1])} ${n(cx + s * r * end[0])} ${n(cy + r * end[1])}`;
  // Die Nähte werden auf die Ballfläche zugeschnitten; der Rand wird danach darübergezeichnet und deckt ihre Enden ab.
  return `<clipPath id="seam-clip"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath><g clip-path="url(#seam-clip)"><g transform="rotate(${angle} ${cx} ${cy})"><path d="${side(-1)}${side(1)}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/></g></g>`;
}
function ballShape(cx, cy, r, color, outline, seamMarkup) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>${seamMarkup}<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${lineColor(color)}" stroke-width="${outline}"/>`;
}
function ball(cx, cy, r, color, angle, outline) {
  return ballShape(cx, cy, r, color, outline, seams(cx, cy, r, angle, n(r / 5), lineColor(color)));
}
function luminance(hex) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
const bigBall = (color, angle, extra = '') => svg(ball(16, 16, 12, color, angle, 1.8) + extra);
function helpBall(color) {
  const mark = lineColor(color);
  // Flachere Nähte nahe am Rand lassen dem Fragezeichen mehr Platz.
  const ballWithFlatSeams = ballShape(16, 16, 12, color, 1.8, seams(16, 16, 12, 0, 2.4, lineColor(color), { end: [0.8, 0.62], bend: [0.6, 0.3] }));
  return svg(ballWithFlatSeams + `<path d="M13 13 A3.2 3.1 0 1 1 17.7 15.8 C16.5 16.5 16 17.2 16 18.6" fill="none" stroke="${mark}" stroke-width="2.8" stroke-linecap="round"/><circle cx="16" cy="22.4" r="1.75" fill="${mark}"/>`);
}
const progressRacket = (color, angle) => svg(racket(PROGRESS_RACKET) + ball(22.4, 22.4, 7.4, color, angle, 1.5));
function moveBall(color) {
  const arrows = [0, 90, 180, 270].map((a) => `<g transform="rotate(${a} 16 16)"><path d="M16 1.5 L21 7.5 H11 Z" fill="FILL" stroke="FILL" stroke-width="SW" stroke-linejoin="round"/></g>`).join('');
  return svg(outlined(arrows, 3) + ball(16, 16, 6.6, color, 0, 1.5));
}
function ballInNet(color) {
  const cx = 16, cy = 17.8, R = 8.8, top = 9, bottom = 28, left = 2, right = 30, mesh = 6.2;
  const push = (x, y) => {
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy), s = Math.max(0, 1 - d / 13) * 2.6;
    return d ? [x + dx / d * s, y + dy / d * s] : [x, y];
  };
  const line = (points) => 'M' + points.map((p) => p.map(n).join(' ')).join('L');
  let d = '';
  for (let x = left + 1; x <= right; x += mesh) { const p = []; for (let y = top; y <= bottom; y += 2) p.push(push(x, y)); d += line(p); }
  for (let y = top + mesh; y < bottom; y += mesh) { const p = []; for (let x = left; x <= right; x += 2) p.push(push(x, y)); d += line(p); }
  return svg(`<circle cx="${cx + 1.3}" cy="${cy + 1.8}" r="${R}" fill="${K}" opacity="0.25"/>${ball(cx, cy, R, color, 25, 1.4)}`
    + `<path d="${d}" fill="none" stroke="${W}" stroke-width="3" stroke-linejoin="round" opacity="0.9"/><path d="${d}" fill="none" stroke="${K}" stroke-width="1" stroke-linejoin="round"/>`
    + `<rect x="1.4" y="${bottom - 0.6}" width="29.2" height="1.8" fill="${K}" stroke="${W}" stroke-width="1.6"/>`
    + `<rect x="0.6" y="3.6" width="30.8" height="6.4" rx="1.2" fill="${W}"/><rect x="1.6" y="4.6" width="28.8" height="4.4" rx="0.8" fill="${W}" stroke="${K}" stroke-width="1.4"/>`);
}

// Dateien, die in jedem Branding gleich sind.
export function buildFixedCursorFiles() {
  return {
    'racket.svg': svg(racket(STANDARD_RACKET)),
    'zoom-in.svg': zoomRacket(true),
    'zoom-out.svg': zoomRacket(false),
    'text.svg': textNet(),
  };
}

const dataUri = (markup) => `url("data:image/svg+xml,${markup.replace(/"/g, "'").replace(/%/g, '%25').replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E')}")`;

// :root-Block mit Händen und Ball-Zeigern in der Akzentfarbe eines Brandings.
export function buildCursorBlock(accent) {
  if (!/^#[0-9a-fA-F]{6}$/.test(accent || '')) throw new Error(`Akzentfarbe "${accent}" ist keine sechsstellige Hex-Farbe.`);
  const lines = [
    `  --cursor-pointer: ${dataUri(hand('pointer', accent, POINTER_HAND))} 3 1, pointer;`,
    `  --cursor-grab: ${dataUri(hand('grab', accent))} 10 10, grab;`,
    `  --cursor-grabbing: ${dataUri(hand('grabbing', accent))} 10 10, grabbing;`,
    `  --cursor-help: ${dataUri(helpBall(accent))} 10 10, help;`,
    `  --cursor-not-allowed: ${dataUri(ballInNet(accent))} 10 11, not-allowed;`,
    `  --cursor-move: ${dataUri(moveBall(accent))} 10 10, move;`,
    ...SPIN_ANGLES.map((angle, i) => `  --cursor-wait-${i + 1}: ${dataUri(bigBall(accent, angle))} 10 10, wait;`),
    ...SPIN_ANGLES.map((angle, i) => `  --cursor-progress-${i + 1}: ${dataUri(progressRacket(accent, angle))} 4 2, progress;`),
  ];
  return `${CURSOR_BLOCK_START}\n:root {\n${lines.join('\n')}\n}\n`;
}

export function withCursorBlock(css, accent) {
  return `${css.replace(CURSOR_BLOCK_PATTERN, '\n').replace(/\s*$/, '')}\n\n${buildCursorBlock(accent)}`;
}

export function readCursorBlock(css) {
  return css.match(CURSOR_BLOCK_PATTERN)?.[0].trim() || null;
}

export function buildCursors({ readAccent }) {
  const dir = path.join(root, 'assets/cursors');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, markup] of Object.entries(buildFixedCursorFiles())) fs.writeFileSync(path.join(dir, name), `${markup}\n`);
  for (const file of fs.readdirSync(path.join(root, 'branding')).filter((name) => name.endsWith('.css'))) {
    const target = path.join(root, 'branding', file);
    const css = fs.readFileSync(target, 'utf8');
    const next = withCursorBlock(css, readAccent(css));
    if (next !== css) fs.writeFileSync(target, next);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { readBrandingVariables } = await import('./apply-branding.mjs');
  buildCursors({ readAccent: (css) => readBrandingVariables(css)['--accent'] });
  console.log('Mauszeiger erzeugt.');
}
