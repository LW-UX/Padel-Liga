# Empfang von Playtomic-Buchungsmails

Supabase Edge Function für Resends Ereignis `email.received`. Der aktuelle
Bereitstellungs- und Verbindungsstand steht in `docs/PROJECT_STATUS.md`.

## Einrichtung

1. Datenbankgrundlage `20261106190000_court_booking_workflow.sql` prüfen und mit
   ausdrücklicher Nutzerfreigabe anwenden; Übergabe siehe
   `docs/court-booking-mail-interface.md`.
2. Function über `tools/supabase-mcp.mjs deploy-function receive-court-booking`
   bereitstellen. Der Helfer liefert den gemeinsamen Parser mit aus. JWT-Prüfung
   ist ausschließlich für diesen signaturgeprüften Webhook deaktiviert.
3. In Resend einen Webhook mit ausschließlich `email.received` und Ziel
   `https://ufpaeluwcqynzudhmrro.supabase.co/functions/v1/receive-court-booking`
   anlegen. Vorhandene Mails werden dadurch nicht automatisch rückwirkend
   verarbeitet; für den Test neue Mails weiterleiten oder Ereignisse wiederholen.
4. In den Supabase Function-Secrets hinterlegen:
   - `RESEND_RECEIVING_API_KEY`: optionaler Resend-Schlüssel mit Berechtigung zum
     Lesen empfangener Mails. Ohne diesen wird der vorhandene `RESEND_API_KEY`
     verwendet; ist er auf Versand beschränkt, wird ein Leseschlüssel benötigt.
   - `RESEND_BOOKING_WEBHOOK_SECRET`: Signing Secret dieses Webhooks (`whsec_…`).
   - `RESEND_BOOKING_FORWARDERS`: zusätzliche ausdrücklich erlaubte
     Absenderadressen, kommagetrennt. Hier bleibt insbesondere der unveränderte
     Playtomic-Absender `no-reply@playtomic.io` für Umleitungen stehen.
     Aktuelle bestätigte Kontoadressen werden automatisch geprüft und müssen
     hier nicht einzeln ergänzt werden; nicht pauschal Domains erlauben.
   - `RESEND_BOOKING_ORIGINAL_RECIPIENTS`: zusätzliche ausdrücklich erlaubte
     ursprüngliche Mail-Empfänger für Umleitungen. Auch hier gelten aktuelle
     bestätigte Kontoadressen automatisch. Ohne einen passenden ursprünglichen
     `To`-Empfänger wird eine Mail von Playtomic nicht automatisch importiert.
   - `RESEND_BOOKING_RECIPIENT`: optional, Standard
     `buchungen@kiroimyon.resend.app`.
   `SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` stellt Supabase bereit.

Der Projekthelfer kann mit `inspect-booking-mail <IDs,kommagetrennt>` prüfen,
ob der bestehende Schlüssel Zugriff auf die ausdrücklich angegebenen,
weitergeleiteten Mails hat. `configure-booking-mail <erlaubte-Absender>` richtet
anschließend den Webhook ein und speichert dessen Signing Secret direkt in
Supabase, ohne Schlüssel auszugeben. Beide Befehle stellen dafür kurzzeitig
`resend-booking-setup` bereit, erlauben ausschließlich den Projekt-Service-Key
und entfernen den Helfer danach wieder. HTTP 401 bedeutet, dass Resend den
hinterlegten API-Schlüssel nicht akzeptiert; dann muss ein gültiger Schlüssel
als `RESEND_RECEIVING_API_KEY` hinterlegt werden. Für das automatische Einrichten
von Webhooks wird Full access benötigt. Ein solcher Schlüssel wird niemals im
Repository oder Chat hinterlegt.

`list-booking-mail` zeigt ausschließlich die jüngsten Buchungs- und
Stornierungsmails an die konfigurierte Empfangsadresse. Die Ausgabe enthält
nur ID, Absender, Betreff und Eingangszeit; Rohinhalte werden nicht ausgegeben.
`inspect-booking-mail` ergänzt bei ausdrücklich gewählten Mails die ursprüngliche
Datumszeile und die Reservierungsdaten ohne Zahlungsinformationen.

`normalize-booking-mail <IDs,kommagetrennt>` liest ausdrücklich ausgewählte
bereits weitergeleitete Bestätigungen für eine manuell freigegebene Übernahme.
Es verlangt den authentifizierten bisherigen Buchenden als Absender, den
korrekten Resend-Empfänger, einen vollständigen Outlook-Kopf und genau einen
mit dem Text übereinstimmenden Kalenderanhang. Der Befehl liefert ausschließlich
normalisierte Buchungswerte und schreibt nichts in die Datenbank. Die permanente
Umleitungsfreigabe wird dafür nicht verändert. Übernahme und Partiezuordnung
erfolgen erst nach konkreter Nutzerfreigabe über den Supabase-Projekthelfer.

Die Migration `20261107010000_registered_booking_email_forwarders.sql`
ergänzt mit ausdrücklicher Datenbankfreigabe die ausschließlich für
`service_role` ausführbare Prüfung `has_registered_court_booking_email`.
Sie liefert nur einen Wahrheitswert, keine E-Mail-Adressen oder Kontodaten.
Der Empfangsadapter prüft darüber bei jedem Eingang die aktuellen bestätigten
Adressen aller Konten mit Liga-Profil, unabhängig von der Rolle. Es wird keine
Adressliste kopiert oder zwischengespeichert. Ein Datenbankfehler führt zu
HTTP 503 für eine Wiederholung und erteilt keine Freigabe.

Für die zusätzlichen festen Ausnahmen lautet der Einrichtungsaufruf weiterhin
`configure-booking-mail no-reply@playtomic.io,<Weiterleitungsabsender> <ursprüngliche-Empfänger>`.
In Outlook können die bisherigen Absender-, Betreff- und Clubfilter erhalten
bleiben. Eine tatsächliche Umleitung muss im Resend-Eingang samt DMARC und
Originalempfänger geprüft werden; bei einer normalen Weiterleitung werden
stattdessen die Freigabe des äußeren Kontos, dessen DMARC-Prüfung und der
vollständige Outlook-Originalkopf verlangt. Neu registrierte bestätigte Konten
sind automatisch dabei; unregistrierte Sonderadressen benötigen weiterhin
eine ausdrückliche Einzel-Freigabe.

`replay-booking-mail <IDs,kommagetrennt>` verarbeitet ausdrücklich ausgewählte
bereits empfangene Mails über denselben signaturgeprüften Empfangsendpunkt.
Der Projekthelfer signiert dafür lokal mit dem zum bestehenden Webhook gehörenden
Schlüssel; es wird keine neue E-Mail versendet. Die Ausgabe enthält nur
HTTP-Status, Importstatus und Buchungs-ID. Der Befehl schreibt die fachlichen
Buchungsereignisse und erfordert dieselbe Freigabe wie ein Datenbankimport.
Er prüft den Empfänger und den erlaubten authentifizierten Absender erneut im
Empfangsadapter und entfernt seinen temporären Einrichtungshelfer anschließend.

Ohne vollständige Konfiguration antwortet die Function mit HTTP 503 und schreibt
nichts. Resend signiert den unveränderten Request-Body; Svix prüft Signatur und
Zeitfenster. Erst danach werden Mail und Originaldatei aus Resend gelesen.
Der Empfänger muss passen und der erlaubte Absender muss laut Resends eigener
Empfangsprüfung DMARC bestehen. Fehlende/fehlgeschlagene Prüfung ergibt
`needs_review`; der Schutz wird nicht anhand kopierter Mailheader gelockert.

## Unterstützte Nachrichten und Grenzen

- Originalmails, als `.eml` angehängte Originalmails und einfache
  Weiterleitungen mit Kalenderanhang. MIME wird mit PostalMime dekodiert.
- Der Originalzeitpunkt stammt aus dem Original-`Date`-Header oder bei einer
  weitergeleiteten Bestätigung aus `DTSTAMP` im validierten Kalenderanhang.
  Der deutsche Outlook-Kopf aus den bereitgestellten Resend-Vorschauen wird
  ebenfalls unterstützt: Originalabsender, Datum, Empfänger und Betreff müssen
  in genau einem vollständigen Block stehen. Das dortige Datum wird als Berliner
  Zeit mit 60 Sekunden Genauigkeit übergeben; überlappende widersprüchliche
  Ereignisse werden in der RPC zur Prüfung zurückgestellt. Empfangszeitpunkt
  und Datum der Weiterleitung ersetzen nie den ursprünglichen Zeitpunkt.
- Nur die aktuellen deutschen Textformate und Lucky Star werden gelesen.
  HTML-only wird mit `html-to-text` ohne Ausführen von Mailcode dekodiert.
  Mehrere Original-/Kalenderanhänge, unbekannte Formate, uneindeutige
  Zeitumstellungsstunden und widersprüchliche Angaben ändern nichts.
- Eine normale erneute Weiterleitung kann im äußeren Betreff oder als eigene
  Zeile oberhalb des Outlook-Kopfs `Partie <Nummer> | <Saison>` enthalten. Nur
  dieser äußere Bereich wird als Anweisung gelesen; zitierter Originalinhalt
  nie. Nach der transaktionalen Zuordnung ruft der Empfänger `racket-booking`
  intern mit der Service-Rolle und dem bereits autorisierten Konto auf. Ein
  vorübergehender Fehler fordert eine idempotente Resend-Wiederholung an.
- Import und RPC akzeptieren genau 60 oder 90 Minuten. Andere Dauern liefern
  `unsupported_duration` zur Prüfung; sie werden nicht gekürzt.
- Originalmails werden auf 2 MiB, Webhook-Anfragen auf 128 KiB begrenzt.
- `needs_review` ist im Webhook-Ergebnis von Resend sichtbar, aber noch kein
  persistierter Admin-Prüfeingang in der Liga. Vor dem produktiven Betrieb
  muss feststehen, wie solche Fälle bearbeitet werden.
- Temporäre API-/Datenbankfehler liefern HTTP 503 für Resends Wiederholung.
  Die Datenbank-RPC übernimmt Ereignisreihenfolge und Dublettenschutz und hält
  auch vor einer Bestätigung eintreffende Stornierungen unsichtbar fest.

Keine Rohmails, Zahlungsangaben, API-Schlüssel oder signierten Downloadlinks
werden in der Liga-Datenbank oder in Logs ausgegeben.

## Prüfung

`tests/receive-court-booking.test.js` prüft den Handler mit nachgebildeten
Resend-/MIME-Antworten. Zusätzlich müssen ein echter Signaturdurchlauf, die
echten Outlook-Weiterleitungen und ein vollständig zurückgerollter SQL-Ablauf
geprüft werden, bevor produktive Mails Daten verändern. PostalMime 4.2.0 wurde
zusätzlich mit dem bereitgestellten Original-Mailpaar geprüft. Svix 2.9.1 wurde
mit echter Signatur, verändertem Body und abgelaufenem Zeitstempel geprüft;
`verify` dieser Version liefert keinen Payload zurück, daher wird JSON erst
nach erfolgreicher Signaturprüfung separat dekodiert.

Die PostgreSQL-Prüfung `tests/court-booking-db.test.js` läuft mit PGlite lokal
und isoliert (`PADEL_PGLITE_MODULE` zeigt auf dessen `dist/index.js`). Sie lädt
eine minimale Teststruktur und die echte Migration und prüft Ereignisreihenfolge,
Wiederbuchung, Zeitgenauigkeit, 60/90 Minuten, Rechte, Zuordnung und die gemeinsame
Stornierungsreaktion. Der HTML-Test nutzt einen installierten `html-to-text`-
Modulpfad über `PADEL_HTML_TO_TEXT_MODULE`; seine nachgebildete Outlook-Struktur
enthält keine persönlichen Daten oder Trackinglinks.
