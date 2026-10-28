const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const pages = [
  fs.readFileSync(path.join(root, 'index.html'), 'utf8'),
  fs.readFileSync(path.join(root, 'tipp', 'index.html'), 'utf8')
];
const client = fs.readFileSync(path.join(root, 'js', 'account.js'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260909200000_player_invitations.sql'),
  'utf8'
);
const edgeFunction = fs.readFileSync(
  path.join(root, 'supabase', 'functions', 'invite-player', 'index.ts'),
  'utf8'
);
const signupTemplate = fs.readFileSync(
  path.join(root, 'supabase', 'templates', 'confirm-signup.html'),
  'utf8'
);
const passwordResetTemplate = fs.readFileSync(
  path.join(root, 'supabase', 'templates', 'reset-password.html'),
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
const testNetAccountMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261020190000_add_test_net_account.sql'),
  'utf8'
);
const correctedTestNetEmailMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261020191000_correct_test_net_email.sql'),
  'utf8'
);

test('company users can register while admins also get a player invitation dialog', () => {
  pages.forEach(source => {
    assert.match(source, /data-auth-mode="signup">Konto erstellen/);
    assert.match(source, /data-password-reset>Passwort vergessen\?/);
    assert.match(source, /id="auth-confirmation-view"[\s\S]*data-auth-confirmation-continue/);
    assert.match(source, /id="auth-password-form"/);
    assert.match(source, /data-current-password-field[^>]*hidden[\s\S]*name="currentPassword"/);
    assert.match(source, /data-password-change>Passwort ändern/);
    assert.match(source, /data-password-change-cancel[^>]*hidden>Abbrechen/);
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
  assert.match(client, /state\.passwordFlow = 'change'/);
  assert.match(client, /state\.passwordFlow === 'change'[\s\S]*auth\.signInWithPassword\(/);
  assert.match(client, /Das aktuelle Passwort stimmt nicht/);
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
  assert.doesNotMatch(client, /option\.disabled = player\.account_status === 'active'/);
  assert.match(client, /state\.invitationPlayers\.some\(player => player\.player_id === selectedValue\)/);
});

test('invitation link is generated only by the server-side function', () => {
  assert.match(edgeFunction, /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
  assert.match(edgeFunction, /userClient\.rpc\([\s\S]*"save_player_email_assignment"/);
  assert.match(edgeFunction, /serviceClient\.auth\.admin\.generateLink/);
  assert.match(edgeFunction, /preparation\?\.status === "linked"[\s\S]*\? "recovery"/);
  assert.match(edgeFunction, /accountStatus: preparation\?\.status === "linked" \? "active" : "pending"/);
  assert.doesNotMatch(edgeFunction, /if \(preparation\?\.status === "linked"\) return jsonResponse/);
  assert.match(edgeFunction, /linkData\?\.properties\?\.action_link/);
  assert.match(edgeFunction, /confirmationPageUrl\.searchParams\.set\("auth", "confirm"\)/);
  assert.match(edgeFunction, /confirmationPageUrl\.hash = actionLink/);
  assert.match(edgeFunction, /actionLink: confirmationPageUrl\.href/);
  assert.doesNotMatch(edgeFunction, /inviteUserByEmail/);
  assert.doesNotMatch(client, /SUPABASE_SERVICE_ROLE_KEY|serviceRoleKey|generateLink/);
  assert.match(client, /Du bist zur Padel-Liga eingeladen/);
  assert.match(client, /Hallo \$\{playerName\}, für dich wurde ein persönliches Spielerprofil vorbereitet/);
  assert.match(client, /const safePlayerName = escapeHtml\(playerName\)/);
  assert.match(client, /buildPlayerInviteCopy\(data\.actionLink, invitedPlayerName\)/);
  assert.match(client, /buildPlayerInviteHtml\(data\.actionLink, invitedPlayerName\)/);
  assert.match(client, /Zugang einrichten\n\$\{actionLink\}/);
  assert.match(client, /deine anstehenden Partien und offenen Aufgaben sehen/);
  assert.match(client, /Dein Hanako-Leben-Squad/);
  assert.match(client, /buildPlayerInviteHtml/);
  assert.match(client, /'text\/html': new Blob/);
  assert.match(client, /navigator\.clipboard\?\.writeText/);
  assert.doesNotMatch(client, /In Outlook öffnen|player-invite-open-outlook/);
  assert.match(client, /confirmationUrl\.origin !== supabaseUrl\.origin/);
  assert.match(client, /confirmationUrl\.pathname !== '\/auth\/v1\/verify'/);
  assert.match(client, /window\.location\.assign\(confirmationUrl\.href\)/);
  assert.match(signupTemplate, /\?auth=confirm&amp;purpose=signup#\{\{ \.ConfirmationURL \}\}/);
  assert.match(passwordResetTemplate, /\?auth=confirm&amp;purpose=recovery&amp;confirmation_url=\{\{ \.ConfirmationURL \}\}/);
  assert.match(passwordResetTemplate, /PADEL<span[^>]*>LIGA<\/span>/);
  assert.match(passwordResetTemplate, /Der Link ist 48 Stunden gültig und kann nur einmal verwendet werden\./);
  assert.match(passwordResetTemplate, /Passwort-Link im Browser öffnen/);
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

test('Test Net receives the same private player-role access as the other test accounts', () => {
  assert.match(testNetAccountMigration, /'test_net', 'Test Net', 'TNET', 'Test', 800/);
  assert.match(testNetAccountMigration, /decode\('[a-f0-9]{64}', 'hex'\),[\s\S]*'test_net',[\s\S]*'player'/);
  assert.doesNotMatch(testNetAccountMigration, /@/);
  assert.doesNotMatch(testNetAccountMigration, /season_players/);
  assert.match(correctedTestNetEmailMigration, /auth_user\.email_confirmed_at is null/);
  assert.match(correctedTestNetEmailMigration, /Der unbestätigte Fehlzugang besitzt bereits abhängige Aktivität/);
  assert.match(correctedTestNetEmailMigration, /delete from auth\.users where id = target_user_id/);
  assert.match(correctedTestNetEmailMigration, /update private\.player_email_allowlist[\s\S]*set email_hash/);
  assert.doesNotMatch(correctedTestNetEmailMigration, /@/);
});
