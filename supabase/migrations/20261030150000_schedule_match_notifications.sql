begin;

-- The key stays in the vault, so neither this file nor cron.job contains it.
select cron.schedule(
  'send-match-notifications',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://ufpaeluwcqynzudhmrro.supabase.co/functions/v1/send-match-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'send_match_notifications_service_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'send_match_notifications_service_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);

commit;
