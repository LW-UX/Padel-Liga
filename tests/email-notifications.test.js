const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

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
const trainingCalendarMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261030120000_training_calendar_invitations.sql'),
  'utf8'
);
const calendarUpdateMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261030130000_calendar_mail_is_update.sql'),
  'utf8'
);
const previewLinkMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261030145000_calendar_mail_preview_link.sql'),
  'utf8'
);
const calendarDelayMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261029220000_calendar_invitation_delay.sql'),
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
  assert.match(edgeFunction, /return \[job\.match_label, getEventLineup\(job\)\]\.filter\(Boolean\)\.join\(": "\);/);
  assert.match(edgeFunction, /SUMMARY:\$\{escapeIcsText\(getCalendarTitle\(job\)\)\}/);
  assert.match(edgeFunction, /const calendarSubject = training \? "Training – PadelLiga" : `\$\{getCalendarTitle\(job\)\} – PadelLiga \$\{job\.season_label\}`;/);
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

test('scheduled trainings get calendar mail, also after their row was deleted', () => {
  assert.match(trainingCalendarMigration, /alter column match_id drop not null/);
  assert.match(trainingCalendarMigration, /session\.status = 'scheduled'/);
  assert.match(trainingCalendarMigration, /insert into private\.training_calendar_baseline/);
  assert.match(trainingCalendarMigration, /full join known/);
  assert.match(trainingCalendarMigration, /when needed_session_at <= now\(\) \+ interval '2 hours' then now\(\)\s+else now\(\) \+ interval '15 minutes'/);
  assert.match(trainingCalendarMigration, /left join public\.matches as match on match\.id = claimed\.match_id/);
  assert.match(trainingCalendarMigration, /concat\('training-', queue\.training_session_id\)/);
  assert.match(edgeFunction, /subject: `Abgesagt: \$\{calendarSubject\}`/);
  assert.match(edgeFunction, /job\.training_participants \?\? ""/);
});

test('calendar mail only announces a move when an invitation was really sent', () => {
  assert.match(calendarUpdateMigration, /earlier\.notification_type = 'calendar_invitation'/);
  assert.match(calendarUpdateMigration, /earlier\.status = 'sent'/);
  assert.match(edgeFunction, /const moved = calendar\?\.is_update \?\? false;/);
});

test('match and training mails share the invitation tone without mentioning attachments', () => {
  assert.match(edgeFunction, /"Pack deine Sportsachen! Das nächste Padel-Match steht an\."/);
  assert.match(edgeFunction, /"Pack deine Sportsachen! Das nächste Padel-Training steht an\."/);
  assert.match(edgeFunction, /`Die \$\{matchTitle\} ist terminiert\. Hier sind die Details:`/);
  assert.match(edgeFunction, /"Euer Training ist terminiert\. Hier sind die Details:"/);
  assert.match(edgeFunction, /const calendarUpdateNotice = "Wird der Termin über die Webseite verschoben oder abgesagt/);
  assert.match(edgeFunction, /body: "Der bisherige Termin in deinem Kalender wurde aktualisiert\."/);
  assert.match(edgeFunction, /\? "Du kannst den Termin aus deinem Kalender entfernen\."/);
  assert.doesNotMatch(edgeFunction, /Kalendereinladung im Anhang|Absage im Anhang/);
  assert.match(edgeFunction, /getTeamMembers\(label\)\.join\(" & "\)/);
  assert.match(edgeFunction, /const calendarSubject = training \? "Training – PadelLiga" : `\$\{getCalendarTitle\(job\)\}/);
  assert.match(edgeFunction, /<span style=\"color:#7E828B;font-weight:normal;\">&amp;<\/span>/);
  assert.doesNotMatch(edgeFunction, /<br><span style=\"color:#7E828B;font-weight:normal;\">&amp;<\/span><br>/);
  assert.match(edgeFunction, /align=\"left\" valign=\"middle\" width=\"44%\"/);
  assert.match(edgeFunction, /align=\"right\" valign=\"middle\" width=\"44%\"/);
  assert.match(edgeFunction, /\$\{escapeHtml\(content\.action\)\}<\/a>\s*\$\{content\.afterDetails \? `<p style=\"margin:16px 0 0;color:#A8ADB7;font-size:12px;/);
});

test('calendar invitations link to the match preview only when it is available', () => {
  assert.match(previewLinkMigration, /private\.match_forecast_mode\(match\.id\) = 'preview'/);
  assert.match(edgeFunction, /job\.notification_type === "calendar_invitation" && job\.match_has_preview/);
  assert.match(edgeFunction, /url\.searchParams\.set\("partie", job\.match_id \?\? ""\)/);
});

test('calendar mail waits 15 minutes unless the match starts within two hours', () => {
  assert.match(calendarDelayMigration, /when needed_match_at <= now\(\) \+ interval '2 hours' then now\(\)\s+else now\(\) \+ interval '15 minutes'/);
  assert.match(calendarDelayMigration, /from private\.calendar_invitation_baseline as baseline/);
  assert.match(accountScript, /Kalendereinladungen werden in etwa 15 Minuten verschickt\./);
  assert.match(accountScript, /startsIn <= 2 \* 60 \* 60 \* 1000/);
});

test('short-notice prediction mail names the match and uses the urgent introduction in HTML and text', () => {
  const context = vm.createContext({ URL, Intl, Date });
  const source = edgeFunction.replace(/^import .*;\n/gm, '').split('Deno.serve(')[0];
  vm.runInContext(stripTypeScriptTypes(source), context);
  const job = {
    notification_type: 'prediction_reminder', recipient_name: 'Alex',
    match_id: 'winter-12', match_label: 'Partie 12', season_label: 'Winter 2026',
    team_one_label: 'A & B', team_two_label: 'C & D',
    match_at: '2026-11-12T17:00:00Z', short_notice: true,
  };
  const mail = context.renderMail(job, 'https://example.invalid/tipp/');
  assert.equal(mail.subject, 'PadelLiga: Tipp für Partie 12 nicht vergessen');
  assert.equal(mail.intro, 'jetzt schnell noch tippen!');
  assert.equal(mail.body, 'Die Partie 12 wurde kurzfristig terminiert und dein Tipp fehlt noch. Bis zum Spielbeginn kannst du ihn eintragen oder ändern.');
  assert.match(mail.html, /font-weight:bold;">jetzt schnell noch tippen!<\/p>/);
  assert.match(mail.text, /Hallo Alex,\n\njetzt schnell noch tippen!/);
  assert.doesNotMatch(mail.html + mail.text, /in rund 24 Stunden/);
  assert.match(mail.html, /Jetzt tippen/);
  assert.match(mail.html, /12\.11\.2026/);

  assert.match(context.getMailContent({ ...job, short_notice: false }).body, /in rund 24 Stunden/);
  for (const short_notice of [null, undefined]) {
    const fallback = context.getMailContent({ ...job, short_notice });
    assert.doesNotMatch(fallback.body, /24 Stunden|kurzfristig/);
    assert.match(fallback.body, /Bis zum Spielbeginn/);
  }
});

test('short-notice classification uses the actual schedule change and only exposes claimed mail context to the service', () => {
  const timing = fs.readFileSync(path.join(root, 'supabase/migrations/20261111130000_prediction_reminder_schedule_timing.sql'), 'utf8');
  assert.match(timing, /after insert or update of match_at on public\.matches/);
  assert.match(timing, /new\.match_at is not distinct from old\.match_at then return new/);
  assert.match(timing, /delete from private\.match_schedule_timing where match_id = new\.id/);
  assert.match(timing, /set match_at = excluded\.match_at, scheduled_at = excluded\.scheduled_at/);
  assert.match(timing, /timing\.scheduled_at > queue\.source_match_at - interval '24 hours'/);
  assert.match(timing, /timing\.match_at = queue\.source_match_at/);
  assert.match(timing, /queue\.claim_token = p_claim_token and queue\.status = 'processing'/);
  assert.match(timing, /<> 'service_role'/);
  assert.match(timing, /revoke all on function public\.get_claimed_prediction_reminder_context\(uuid\) from public, anon, authenticated/);
  assert.match(timing, /grant execute on function public\.get_claimed_prediction_reminder_context\(uuid\) to service_role/);
  assert.match(edgeFunction, /job\.short_notice = reminderContext\.get\(job\.job_id\) \?\? null/);
});
