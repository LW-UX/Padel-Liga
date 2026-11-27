# Outlook-Abgleich für die Platzsuche

Die Function prüft die Supabase-Anmeldung und die Beteiligung an der ausgewählten Partie. Microsoft-Adressen und unverarbeitete Kalenderdaten bleiben serverseitig. Der Browser erhält nur gemeinsame Outlook-Spalten, Padel-Sperrzeiten und das Ergebnis der Vorschlagssuche.

## Verbindung einrichten

Eine Entra-App im Firmenmandanten braucht die delegierte Microsoft-Graph-Berechtigung `Calendars.ReadBasic` und die Freigabe des Benutzerkontos. Für den lokalen Einrichtungshelfer muss der Gerätecodefluss für öffentliche Clients zugelassen sein. Die bestehenden Outlook-Freigaben der Spieler bleiben bestehen. Der Abruf setzt voraus, dass Microsoft Graph mit dem verbundenen Konto und dieser App-Berechtigung für jeden Teilnehmer die ausgewählten Felder der Kalenderansicht lesen kann. Die Adresse aus `COURT_OUTLOOK_ACCOUNT` ist der Anmeldename des verbundenen Firmenkontos und wird mit der bestätigten Ligakonto-Adresse verglichen.

`tools/court-outlook-setup.mjs` startet die Anmeldung bei Microsoft und legt nach erfolgreicher Freigabe eine private temporäre Datei mit `COURT_OUTLOOK_TENANT_ID`, `COURT_OUTLOOK_CLIENT_ID`, `COURT_OUTLOOK_ACCOUNT` und `COURT_OUTLOOK_REFRESH_TOKEN` ab. Bei einem vertraulichen Client wird zusätzlich `COURT_OUTLOOK_CLIENT_SECRET` benötigt. Die Werte als Edge-Function-Secrets hinterlegen. Nach der Einrichtung die temporäre Datei entfernen. Der Datenbankzugriff und die Bereitstellung erfolgen über den Projekt-MCP nach Freigabe.

## Prüfung und Wiederverbindung

Vor Aktivierung je einen Kalender mit reiner Frei-/Gebucht-Freigabe und einen Kalender mit sichtbarem Titel und Ort testen. Bei allen Anfragen beschränkt `calendarView` die Antwortfelder auf Start, Ende, Verfügbarkeitsstatus und Absagestatus. Der Outlook-Abgleich bleibt ausgeblendet, wenn Microsoft den Zugriff auf einen Kalender verweigert oder zusätzliche Terminfelder liefert. Der Endpunkt verwendet keinen Rückgriff auf `getSchedule`. Falls die vorhandene App-Berechtigung für die freigegebenen Kalender nicht ausreicht, muss eine Änderung der App-Berechtigung separat geklärt werden.

Im Projekt-MCP kann der aktuelle Zustand über `select status, checked_at from private.court_outlook_health` geprüft werden. `reconnect` verlangt eine neue Anmeldung bei Microsoft und das Ersetzen des Starttokens im Edge-Function-Secret. Die Function protokolliert keine Kalenderantworten oder Zugangsdaten. Für die normale Platzsuche und die Überschneidungsprüfung von Padelspielen bleibt die Outlook-Verbindung optional.

## Betriebswarnung

`20261127161000_court_outlook_alerts.sql` ergänzt die Admin-Warnung im Platzbuchungsmodal und den Versand über `send-match-notifications`. Die Meldung und Mail nennen nur die Fehlerkategorie. Ein aktiver Vorfall erhält höchstens eine Mail pro bestätigtem Admin. Allgemeine Verbindungsfehler enden mit einer erfolgreichen Wiederherstellung. Ein kalenderbezogener Fehler bleibt offen, solange er eine offene Partie betrifft und deren Kalenderprüfung weiterhin fehlgeschlagen ist. Eine absichtlich noch nicht eingerichtete Verbindung löst keine Mail aus.
