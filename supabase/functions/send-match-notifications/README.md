# Automatische Partie- und Tippmails

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

Die Function sollte alle fünf Minuten aufgerufen werden. Jeder Lauf erzeugt die
inzwischen fälligen Aufträge, verwirft fachlich überholte Aufträge und versendet
bis zu 25 Nachrichten. Fehlgeschlagene Aufträge werden mit Abstand erneut
versucht; eindeutige Versandkennungen schützen vor Doppelzustellung.

Vor der Aktivierung müssen die Migration
`20261029120000_account_email_notifications.sql`, die Function und der in Resend
verifizierte Absender bereitstehen. Der Zeitplan wird zuletzt aktiviert, damit
keine unvollständig konfigurierte Function aufgerufen wird.
