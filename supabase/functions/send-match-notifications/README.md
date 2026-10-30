# Automatische Partie- und Tippmails

Neben den drei Erinnerungen versendet die Function Kalendereinladungen zu
Partieterminen. Jeder Lauf vergleicht die aktuellen Termine mit der zuletzt
versandten Einladung je Spieler und verschickt neue Einladungen, Verschiebungen
und Absagen als `.ics`-Anhang (`METHOD:REQUEST` beziehungsweise
`METHOD:CANCEL`). Kennung und fortlaufende Sequenz sorgen dafür, dass Outlook
den bestehenden Termin ersetzt statt einen zweiten anzulegen. Der Absender aus
`NOTIFICATION_FROM` ist zugleich Organisator des Termins. Vor dem Start des
Zeitplans sollte eine Probe-Einladung an ein Outlook-Postfach zeigen, dass
Outlook den Anhang als Einladung erkennt.

Die Function wird ausschließlich serverseitig per `POST` aufgerufen. Der Aufruf
muss den Supabase-Service-Role-Schlüssel als Bearer-Token tragen; normale
Kontositzungen werden abgewiesen.

## Benötigte Function-Secrets

- `RESEND_API_KEY`: API-Schlüssel des Resend-Kontos
- `NOTIFICATION_FROM`: verifizierter Absender, zum Beispiel
  `PadelLiga <noreply@padelliga.envidual.com>`
- `PUBLIC_SITE_URL`: öffentliche Basisadresse der Liga

`SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` stellt Supabase der Edge Function
automatisch bereit. Zugangsdaten gehören nicht in diese Datei oder in Git.

## Zeitsteuerung

Die Function sollte alle fünf Minuten über `pg_net` aufgerufen werden; den
Secret Key des Projekts liest der Aufruf aus dem Vault-Eintrag
`send_match_notifications_service_key` und sendet ihn als `apikey` und Bearer-Token. Jeder Lauf erzeugt die
inzwischen fälligen Aufträge, verwirft fachlich überholte Aufträge und versendet
bis zu 25 Nachrichten. Fehlgeschlagene Aufträge werden mit Abstand erneut
versucht; eindeutige Versandkennungen schützen vor Doppelzustellung.

Vor der Aktivierung müssen die Migrationen
`20261029120000_account_email_notifications.sql`,
`20261029190000_match_calendar_invitations.sql` und
`20261029200000_calendar_invitations_skip_existing.sql`, die Function und der in Resend
verifizierte Absender bereitstehen. Der Zeitplan wird zuletzt aktiviert, damit
keine unvollständig konfigurierte Function aufgerufen wird.
