const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const invitation = fs.readFileSync(path.join(root, 'js', 'tipp-invitation.js'), 'utf8');
const accountStyle = fs.readFileSync(path.join(root, 'account.css'), 'utf8');
const decisions = fs.readFileSync(path.join(root, 'docs', 'project-decisions', 'tipping.md'), 'utf8');

function runInvitation({ enabled = true, search = '', pathname = '/', seen = false, embedded = false } = {}) {
  const storage = new Map(seen ? [['padel-liga:tipp-invitation-seen', 'winter-2026']] : []);
  const listeners = new Map();
  const dialog = {
    open: false,
    showCount: 0,
    listeners: new Map(),
    tippLink: { dataset: {}, addEventListener(type, listener) { this.listener = listener; } },
    querySelector() { return this.tippLink; },
    addEventListener(type, listener) { this.listeners.set(type, listener); },
    showModal() {
      this.open = true;
      this.showCount += 1;
    },
    close() {
      this.open = false;
    }
  };
  const window = {
    location: { search, pathname, assign(href) { this.assignedHref = href; } },
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value)
    },
    addEventListener: (type, listener) => listeners.set(type, listener)
  };
  const document = {
    documentElement: { classList: { contains: name => embedded && name === 'is-detail-embed' } },
    getElementById: id => id === 'tipp-invitation-dialog' ? dialog : null
  };

  vm.runInNewContext(invitation, { document, URLSearchParams, window });
  const fire = () => listeners.get('padel:season-ready')({
    detail: { predictionsEnabled: enabled, tippHref: 'http://localhost/tipp/?saison=2026-winter' }
  });
  return { dialog, fire, storage };
}

test('the first-visit prompt offers both requested actions and an accessible close control', () => {
  assert.match(html, /id="tipp-invitation-dialog"[^>]*aria-labelledby="tipp-invitation-title"[^>]*aria-describedby="tipp-invitation-copy"/);
  assert.match(html, /data-tipp-invitation-close[^>]*aria-label="Tipp-Hinweis schließen"/);
  assert.match(html, /data-tipp-invitation-close>Nicht jetzt</);
  assert.match(html, /data-tipp-invitation-link>Jetzt tippen</);
  assert.match(html, /id="tipp-invitation-title">Schon getippt\?</);
  assert.match(html, /<p class="auth-dialog-copy" id="tipp-invitation-copy">/);
  assert.match(html, /class="tipp-invitation-icon"[\s\S]*?<svg/);
  assert.match(html, /<div class="player-email-actions">[\s\S]*class="secondary-button"[\s\S]*class="primary-button"/);
  assert.doesNotMatch(html, /tipp-invitation\.css|class="[^"]*tipp-invitation-(?:actions|link)/);
  assert.match(accountStyle, /\.tipp-invitation-card \{[\s\S]*?align-items: center;[\s\S]*?text-align: center;/);
  assert.match(accountStyle, /\.tipp-invitation-dialog \.auth-dialog-copy \{[\s\S]*?font-size: var\(--text-base\);/);
  assert.doesNotMatch(accountStyle, /\.tipp-invitation-(?:actions|link)|\.tipp-invitation[^}]*\.primary-button|\.tipp-invitation[^}]*\.secondary-button/);
});

test('the prompt is persisted once and only opens for an enabled tipping season', () => {
  assert.match(invitation, /localStorage\.getItem\(STORAGE_KEY\) === INVITATION_ID/);
  assert.match(invitation, /localStorage\.setItem\(STORAGE_KEY, INVITATION_ID\)/);
  assert.doesNotMatch(invitation, /shownThisPage = true;\s*markInvitationSeen\(\);\s*dialog\.showModal/);
  assert.match(invitation, /dialog\.addEventListener\('cancel', \(\) => markInvitationSeen\(\)\)/);
  assert.match(invitation, /tippLink\?\.addEventListener\('click', \(\) => \{[\s\S]*markInvitationSeen\(\);[\s\S]*window\.location\.assign/);
  assert.match(invitation, /!event\.detail\?\.predictionsEnabled/);
  assert.match(invitation, /dialog\.showModal\(\)/);
  assert.match(app, /new CustomEvent\('padel:season-ready'/);
  assert.match(app, /predictionsEnabled: getCompetitionConfig\(\)\.predictionsEnabled/);
});

test('direct detail views stay free of the first-visit prompt', () => {
  assert.match(invitation, /\['partie', 'live', 'spielerprofil'\]/);
  assert.match(invitation, /classList\.contains\('is-detail-embed'\)/);
  assert.match(decisions, /Direkt verlinkte Detailansichten und die eingebettete Liga-Ansicht bleiben davon ungestört/);
});

test('runtime behavior persists only after interaction and respects eligibility', () => {
  const firstVisit = runInvitation();
  firstVisit.fire();
  firstVisit.fire();
  assert.equal(firstVisit.dialog.showCount, 1);
  assert.equal(firstVisit.storage.has('padel-liga:tipp-invitation-seen'), false);

  firstVisit.dialog.listeners.get('cancel')();
  assert.equal(firstVisit.storage.get('padel-liga:tipp-invitation-seen'), 'winter-2026');

  const tippVisit = runInvitation();
  tippVisit.fire();
  tippVisit.dialog.tippLink.listener();
  assert.equal(tippVisit.storage.get('padel-liga:tipp-invitation-seen'), 'winter-2026');
  assert.equal(tippVisit.dialog.tippLink.dataset.href, 'http://localhost/tipp/?saison=2026-winter');

  const returningVisit = runInvitation({ seen: true });
  returningVisit.fire();
  assert.equal(returningVisit.dialog.showCount, 0);

  const disabledSeason = runInvitation({ enabled: false });
  disabledSeason.fire();
  assert.equal(disabledSeason.dialog.showCount, 0);

  const directDetail = runInvitation({ search: '?partie=season-2026-partie-1' });
  directDetail.fire();
  assert.equal(directDetail.dialog.showCount, 0);

  const shortDetail = runInvitation({ pathname: '/Padel-Liga/wi26/partie/1/' });
  shortDetail.fire();
  assert.equal(shortDetail.dialog.showCount, 0);
});
