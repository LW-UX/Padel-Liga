const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261029120000_account_email_notifications.sql'),
  'utf8'
);
const calendarMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261029190000_match_calendar_invitations.sql'),
  'utf8'
);
const calendarBaselineMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261029200000_calendar_invitations_skip_existing.sql'),
  'utf8'
);
const testReminderMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261029210000_test_prediction_reminders_only_test_accounts.sql'),
  'utf8'
);
const edgeFunction = fs.readFileSync(
  path.join(root, 'supabase', 'functions', 'send-match-notifications', 'index.ts'),
  'utf8'
);
const accountScript = fs.readFileSync(path.join(root, 'js', 'account.js'), 'utf8');
const pages = [
  fs.readFileSync(path.join(root, 'index.html'), 'utf8'),
  fs.readFileSync(path.join(root, 'tipp', 'index.html'), 'utf8')
];

test('notification queue encodes the three deadlines and prevents duplicate or obsolete mail', () => {
  assert.match(migration, /match\.match_at \+ interval '5 hours'/);
  assert.match(migration, /proposal\.created_at \+ interval '4 hours'/);
  assert.match(migration, /match\.match_at - interval '24 hours'/);
  assert.match(migration, /dedupe_key text not null unique/);
  assert.match(migration, /on conflict \(dedupe_key\) do nothing/g);
  assert.match(migration, /Bei der Erstaktivierung bereits überfällig\./g);
  assert.match(migration, /auth_user\.email_confirmed_at is not null/g);
  assert.match(migration, /not exists \([\s\S]*from public\.predictions as prediction[\s\S]*prediction\.user_id = profile\.id/);
  assert.match(migration, /own_match\.player_id = profile\.player_id/);
  assert.match(migration, /not private\.email_notification_enabled\(queue\.recipient_user_id, queue\.notification_type\)/);
  assert.match(migration, /proposal\.status = 'pending'/);
});

test('notification dispatcher uses the reset-mail brand, Resend idempotency, and opt-out footer', () => {
  assert.match(edgeFunction, /https:\/\/api\.resend\.com\/emails/);
  assert.match(edgeFunction, /"Idempotency-Key": job\.idempotency_key/);
  assert.match(edgeFunction, /background:#07080C/);
  assert.match(edgeFunction, /background:#D4F53A/);
  assert.match(edgeFunction, /PADEL<span style="color:#D4F53A;">LIGA<\/span>/);
  assert.match(edgeFunction, /Diese automatische E-Mail kannst du jederzeit in deinem PadelLiga-Konto unter „Einstellungen“ ausschalten\./);
  assert.match(edgeFunction, /authorization !== `Bearer \$\{serviceRoleKey\}`/);
});

test('account settings expose and persist every notification separately', () => {
  pages.forEach(source => {
    assert.match(source, /data-account-settings aria-expanded="false"/);
    assert.match(source, /data-email-notification="resultEntry" checked/);
    assert.match(source, /data-email-notification="resultConfirmation" checked/);
    assert.match(source, /data-email-notification="predictionReminder" checked/);
    assert.match(source, /data-email-notification="calendarInvitation" checked/);
    assert.match(source, /data-account-settings-panel hidden[\s\S]*data-password-change[\s\S]*data-auth-logout/);
  });
  assert.match(accountScript, /state\.notificationPreferences\[key\] = Boolean\(changedInput\.checked\)/);
  assert.match(accountScript, /p_result_entry: state\.notificationPreferences\.resultEntry/);
  assert.match(accountScript, /p_result_confirmation: state\.notificationPreferences\.resultConfirmation/);
  assert.match(accountScript, /p_prediction_reminder: state\.notificationPreferences\.predictionReminder/);
  assert.match(accountScript, /readInitialUrlParam\(initialSearch, 'konto'\) === '1'/);
});

test('calendar invitations follow schedule changes and keep one Outlook appointment per participant', () => {
  assert.match(calendarMigration, /match\.match_at > now\(\)/);
  assert.match(calendarMigration, /match\.cancelled_at is null/);
  assert.match(calendarMigration, /queue\.status in \('processing', 'sent', 'failed'\)/);
  assert.match(calendarMigration, /Durch eine neuere Terminänderung ersetzt\./);
  assert.match(calendarMigration, /coalesce\(max\(queue\.calendar_sequence\), -1\) \+ 1/);
  assert.match(calendarMigration, /elsif not pair\.has_result/);
  assert.match(calendarMigration, /rename to queue_due_reminder_notifications/);
  assert.match(edgeFunction, /METHOD:\$\{cancelled \? "CANCEL" : "REQUEST"\}/);
  assert.match(edgeFunction, /SEQUENCE:\$\{calendar\.calendar_sequence\}/);
  assert.match(edgeFunction, /const calendarSubject = `\$\{job\.match_label\} – PadelLiga \$\{job\.season_label\}`;/);
  assert.match(edgeFunction, /subject: `Abgesagt: \$\{calendarSubject\}`/);
  assert.match(edgeFunction, /const CALENDAR_LOCATION = "Lucky Star Padel";/);
  assert.match(edgeFunction, /"TRIGGER:-PT1H"/);
  assert.match(edgeFunction, /"X-MICROSOFT-CDO-BUSYSTATUS:BUSY"/);
  assert.match(edgeFunction, /content_type: `text\/calendar; charset=utf-8; method=\$\{invitation\.method\}`/);
});

test('calendar invitations skip matches that were already scheduled at activation', () => {
  assert.match(calendarBaselineMigration, /if not exists \(select 1 from private\.calendar_invitation_activation\)/);
  assert.match(calendarBaselineMigration, /insert into private\.calendar_invitation_baseline[\s\S]*where match\.match_at > now\(\)/);
  assert.match(calendarBaselineMigration, /match\.match_at is distinct from baseline\.match_at/);
  assert.match(calendarBaselineMigration, /from private\.calendar_invitation_baseline as baseline\s+where baseline\.match_id = match\.id/);
});

test('prediction reminders for test matches only reach the internal test profiles', () => {
  assert.match(testReminderMigration, /create or replace function private\.queue_due_reminder_notifications\(\)/);
  assert.match(testReminderMigration, /season\.id not in \('2026-test', 'test-2026'\)\s+or profile\.player_id in \('ludi_gmail', 'ludi_gmx', 'ludi_ionos', 'test_net'\)/);
});
