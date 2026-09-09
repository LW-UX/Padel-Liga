const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const pages = [
  fs.readFileSync(path.join(root, 'index.html'), 'utf8'),
  fs.readFileSync(path.join(root, 'tipp', 'index.html'), 'utf8')
];
const client = fs.readFileSync(path.join(root, 'js', 'tippspiel.js'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260909200000_player_invitations.sql'),
  'utf8'
);
const edgeFunction = fs.readFileSync(
  path.join(root, 'supabase', 'functions', 'invite-player', 'index.ts'),
  'utf8'
);
const domainMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260909220000_company_signup_domains.sql'),
  'utf8'
);
const strictDomainMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260909230000_strict_company_signup_domains.sql'),
  'utf8'
);
const adminEmailExceptionMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260909250000_admin_invitation_email_exceptions.sql'),
  'utf8'
);

test('company users can register while admins also get a player invitation dialog', () => {
  pages.forEach(source => {
    assert.match(source, /data-auth-mode="signup">Konto erstellen/);
    assert.match(source, /data-password-reset>Passwort vergessen\?/);
    assert.match(source, /id="auth-password-form"/);
    assert.match(source, /data-player-invite-open[^>]*hidden/);
    assert.match(source, /id="player-invite-dialog"/);
    assert.match(source, /id="player-invite-form"[\s\S]*name="playerId"[\s\S]*name="email"/);
    assert.match(source, /data-player-email-action="assign">E-Mail zuordnen/);
    assert.match(source, /data-player-email-action="prepare">Zuordnen &amp; Einladung vorbereiten/);
    assert.match(source, /id="player-invite-output"[\s\S]*data-player-invite-copy-link[\s\S]*data-player-invite-copy-message/);
    assert.doesNotMatch(source, /data-player-invite-open-outlook|In Outlook öffnen/);
  });
  assert.match(client, /auth\.signUp\(/);
  assert.match(client, /Registrierung ist nur mit einer freigegebenen Firmen-E-Mail möglich/);
  assert.match(client, /auth\.signInWithPassword\(/);
  assert.match(client, /auth\.resetPasswordForEmail\(/);
  assert.match(client, /auth\.updateUser\(\{ password \}\)/);
  assert.match(client, /functions\.invoke\('invite-player'/);
});

test('invitation preparation is restricted to admins and preserves unique player mapping', () => {
  assert.match(migration, /create or replace function public\.get_admin_player_invitation_options/);
  assert.match(migration, /when auth_user\.email_confirmed_at is not null then 'active'/);
  assert.match(migration, /when profile\.id is not null then 'pending'/);
  assert.match(migration, /when allowlist\.player_id is not null then 'assigned'/);
  assert.match(migration, /profile\.app_role = 'admin'/);
  assert.match(migration, /Nur Admins können Spieler-E-Mails zuordnen/);
  assert.match(migration, /extensions\.digest\(normalized_email, 'sha256'\)/);
  assert.doesNotMatch(migration, /signup_email_domains/);
  assert.match(migration, /Diese E-Mail-Adresse ist bereits einem anderen Spieler zugeordnet/);
  assert.match(migration, /Für diesen Spieler besteht bereits ein Konto mit einer anderen E-Mail-Adresse/);
  assert.match(migration, /insert into public\.profiles[\s\S]*p_player_id[\s\S]*on conflict \(id\) do update/);
  assert.match(migration, /email_confirmed_at[\s\S]*then 'reinvite' else 'linked'/);
  assert.match(migration, /revoke execute on function public\.save_player_email_assignment\(text, text\) from public, anon/);
  assert.match(migration, /grant execute on function public\.save_player_email_assignment\(text, text\) to authenticated/);
  assert.match(client, /rpc\('get_admin_player_invitation_options'\)/);
  assert.match(client, /rpc\('save_player_email_assignment'/);
  assert.match(client, /Konto vorhanden/);
  assert.match(client, /Einladung offen/);
  assert.match(client, /E-Mail hinterlegt/);
});

test('invitation link is generated only by the server-side function', () => {
  assert.match(edgeFunction, /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
  assert.match(edgeFunction, /userClient\.rpc\([\s\S]*"save_player_email_assignment"/);
  assert.match(edgeFunction, /serviceClient\.auth\.admin\.generateLink/);
  assert.match(edgeFunction, /linkData\?\.properties\?\.action_link/);
  assert.doesNotMatch(edgeFunction, /inviteUserByEmail/);
  assert.doesNotMatch(client, /SUPABASE_SERVICE_ROLE_KEY|serviceRoleKey|generateLink/);
  assert.match(client, /Du bist zur Padel-Liga eingeladen/);
  assert.match(client, /Zugang einrichten\n\$\{actionLink\}/);
  assert.match(client, /deine anstehenden Partien und offenen Aufgaben sehen/);
  assert.match(client, /Dein Hanako-Leben-Squad/);
  assert.match(client, /buildPlayerInviteHtml/);
  assert.match(client, /'text\/html': new Blob/);
  assert.match(client, /navigator\.clipboard\?\.writeText/);
  assert.doesNotMatch(client, /In Outlook öffnen|player-invite-open-outlook/);
});

test('public self-registration is restricted while admin-assigned emails may use any domain', () => {
  assert.match(domainMigration, /'envidual\.com'/);
  assert.match(domainMigration, /'headsquare\.group'/);
  assert.match(domainMigration, /'hanako-health\.com'/);
  assert.match(domainMigration, /delete from private\.signup_email_domains/);
  assert.match(domainMigration, /where domain not in/);
  assert.match(strictDomainMigration, /allowed_domain\.domain = requested_domain/);
  assert.doesNotMatch(strictDomainMigration, /player_email_allowlist/);
  assert.match(adminEmailExceptionMigration, /private\.player_email_allowlist/);
  assert.match(adminEmailExceptionMigration, /or exists \(select 1 from private\.signup_email_domains where domain = requested_domain\)/);
  assert.doesNotMatch(adminEmailExceptionMigration, /nicht für Spielerzugänge freigegeben/);
});
