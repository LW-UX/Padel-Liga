# Öffentliche Lucky-Star-Verfügbarkeit

`POST` mit `{ "date": "YYYY-MM-DD" }` liefert öffentliche Plätze, deren
Indoor-/Outdoor-Zuordnung, Öffnungszeiten und freie 60-Minuten-Slots.
Start und Ende sind ISO-Zeitpunkte; `time` ist die Berliner Startzeit.
Keine Konto-, Teilnehmer- oder Buchungsdaten werden abgefragt oder gespeichert.
Die Function benötigt keine Secrets und wird ausschließlich für diese öffentliche
Lesefunktion mit `verify_jwt: false` bereitgestellt. Alle anderen Functions behalten
im vorhandenen Starthelfer ihre JWT-Prüfung.

Die Club-Metadaten aus dem öffentlichen Next.js-Stream werden eine Stunde
zwischengespeichert. Ist diese HTML-Seite nach drei Sekunden nicht lesbar, wird
auf die in `club-metadata.ts` hinterlegten, geprüften öffentlichen Platzdaten
zurückgegriffen und dieser Metadatenstand ebenfalls eine Stunde verwendet.
Der Rückgriff enthält keine Verfügbarkeit; unbekannte Ressourcen aus der
JSON-Antwort bleiben ausgeschlossen. Verfügbarkeitsanfragen werden nur während identischer laufender
Abrufe zusammengeführt. Fehler oder ein geändertes Anbieterformat ergeben HTTP 502;
ungültige Kalendertage HTTP 400. Es gibt keinen Rückgriff auf alte Slotdaten.

Die öffentliche Playtomic-Abfrage ist keine zugesicherte Integrations-API.
Eine Antwort stellt keine Reservierung dar.

Fehlerantworten enthalten zusätzlich `source` (`playtomic` oder `unknown`) und
einen festen `reason`: `playtomic_timeout`, `playtomic_unavailable`,
`playtomic_access_denied`, `playtomic_rate_limited` oder
`playtomic_invalid_response`; interne Fehler verwenden `availability_unavailable`.
Es werden keine Anbieterantworten, Zugangsdaten oder internen Fehlermeldungen
weitergegeben oder protokolliert. Ein 403 beweist keine abgelaufene Sitzung.
Der Statusmapper unterscheidet `playtomic_login_required` ausschließlich bei
HTTP 401 eines tatsächlich authentifizierten Abrufs. Die aktuelle öffentliche
Function verwendet keine Sitzung und kann diesen Grund daher nicht liefern.
Netzwerkfehler zwischen Browser und Function bleiben in der Oberfläche ohne
zugesicherte Anbieterursache. Es gibt keine zusätzlichen Störungsprüfungen.

## Öffentlicher Abruf ohne Cookie

Die öffentliche JSON-Route akzeptiert das Browser-Anfrageprofil aus
`request-headers.ts` (User-Agent und Fetch-Metadaten). Derselbe Abruf ohne diese
Header wurde mit 403 abgewiesen. Die produktive Function verwendet daher dieses
Profil und sendet weder Cookies noch Authorization-Header. Der Live-Test auf
Supabase bestätigt die JSON-Antwort ohne Anmeldung. Die HTML-Clubseite kann davon
unabhängig langsam sein; ihr Ausfall blockiert dank Metadaten-Rückgriff keine
aktuellen Slots.

`tools/supabase-mcp.mjs probe-public-court-availability YYYY-MM-DD` prüft die
öffentlichen Leseendpunkte vom Server aus, ohne Sitzung oder Datenbankzugriff,
und gibt ausschließlich HTTP-Status, Inhaltstyp und Dauer zurück.

## Separaten Browser-Cookie prüfen (bei Bedarf)

`tools/supabase-mcp.mjs setup-playtomic-availability-session YYYY-MM-DD` startet
für 30 Minuten eine ausschließlich an `127.0.0.1` gebundene Eingabeseite mit
zufälligem Pfad. Nur eine dortige Einreichung vom selben Origin löst den Test aus.
Der temporäre `court-availability-probe` verlangt einen pro Lauf zufälligen
Zugriffsschlüssel. Er übernimmt den Cookie und den Browser-User-Agent nur im
Arbeitsspeicher und ruft ausschließlich die festgelegten Playtomic-Leseendpunkte
für Verfügbarkeit und Club-Metadaten auf, ohne Weiterleitungen.

Ein erfolgreicher HTTP-Status allein genügt nicht: Das Datenformat muss die
reguläre Platz-/Slotvalidierung bestehen. Erst dann wird die separate Sitzung
als `PLAYTOMIC_AVAILABILITY_SESSION` (JSON mit `cookie` und `userAgent`) gespeichert.
Ein leeres, gültiges Slotangebot ist zulässig. Erneuerungstoken und bekannte
Analyse-/Zahlungscookies werden nicht übernommen. Der Hallencode-Speicher bleibt
unverändert; dieser Test erneuert keine Sitzung und schreibt keine Datenbankdaten.
Fehlerantworten und Protokolle enthalten ausschließlich feste Kategorien und
Anzahlen. Der temporäre Prüfer wird nach Abschluss, Ablauf oder regulärem Abbruch
entfernt. Vorzeitiger Prozessverlust kann eine manuelle Entfernung erfordern.

Die produktive öffentliche Function verwendet diesen separaten Cookie bisher
noch nicht. Ihre Umstellung erfolgt erst nach einem nachweislich erfolgreichen
Test. Bei gescheitertem Test wird kein Cookie hinterlegt.
