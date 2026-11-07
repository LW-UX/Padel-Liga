# Schnittstelle für Playtomic-Buchungsmails

Die Mailverarbeitung ist von der Konto- und Terminierungslogik getrennt. Sie
übergibt ausschließlich normalisierte Buchungsereignisse und eine gegebenenfalls
erkannte äußere Zuordnungsanweisung an die service-role-RPC
`record_court_booking_with_match`. Diese verwendet für den eigentlichen Import
weiterhin `record_court_booking`.

## Eingabe

- `p_provider_booking_id`: unveränderte Playtomic-Buchungsnummer aus dem
  Kalenderanhang, sofern vorhanden; andernfalls `null`.
- `p_court_resource_id`: Playtomic-Ressourcen-ID, sofern aus Mail oder Mapping
  bekannt; andernfalls `null`.
- `p_court_name`: Platzname aus der Bestätigung.
- `p_organizer`: der in Bestätigung und Stornierung genannte Buchende. Er wird
  ausschließlich privat für die eindeutige Zuordnung einer Stornierung genutzt.
- `p_starts_at` und `p_ends_at`: absolute Zeitpunkte mit Zeitzone. Das Fenster
  muss genau 60 oder 90 Minuten umfassen. Die tatsächliche Dauer wird für
  Anzeige und Stornierungszuordnung unverändert beibehalten.
- `p_cancelled`: `false` für eine aktive Bestätigung, `true` für die
  Stornierung derselben Buchungsnummer.
- `p_source_occurred_at`: ursprünglicher Zeitpunkt der Playtomic-Mail, nicht
  der Zeitpunkt einer späteren Weiterleitung. Ältere oder identische Ereignisse
  werden idempotent ignoriert.
- `p_source_precision_seconds`: `1` für Originalheader/Kalenderzeitpunkt,
  `60` für die minutengenaue deutsche Outlook-Datumszeile; Standard ist `1`.
  Zeitlich überlappende, widersprüchliche Ereignisse benötigen eine Prüfung.
- `p_forwarder_email`: authentifizierter äußerer Absender einer normalen
  Weiterleitung; bei einer Playtomic-Umleitung `null`.
- `p_match_number` und `p_season_hint`: ausschließlich aus der äußeren
  Anweisung `Partie <Nummer> | <Saison>` gelesen. Ohne Anweisung sind beide
  Werte `null`; die Saison darf fehlen und wird dann serverseitig nur bei einem
  einzigen berechtigten Treffer akzeptiert.

Der Aufruf benötigt die Supabase `service_role`. Vollständiger Mailtext,
Absender, Empfänger und Anhänge werden nicht in der Liga-Datenbank gespeichert.

## Fachliche Folgen

- Eine aktive Buchung erscheint angemeldeten Spielern als zuordenbarer Slot.
- Beim Terminieren wird sie atomar genau einer Partie zugeordnet.
- Eine erneut weitergeleitete Bestätigung mit eindeutiger Zuordnungsanweisung
  darf Import, Verknüpfung und Terminierung in derselben Transaktion erledigen.
  Die Datenbank ermittelt das bestätigte Konto erneut und erlaubt dies nur
  beteiligten Spielern oder Admins. Erwartete Konflikte lassen den Import
  bestehen und die Buchung unverknüpft.
- Eine Stornierung entfernt den Slot sofort aus allen sichtbaren Auswahlen.
- Enthält die Stornierung keine Playtomic-ID, wird sie nur bei genau einer
  aktiven Buchung desselben Platzes, Buchenden und absoluten Zeitfensters
  übernommen. Ein
  mehrdeutiger Treffer liefert `needs_review` und verändert keine Buchung.
  Eine Stornierung ohne vorherige Bestätigung legt ausschließlich einen
  unsichtbaren Stornierungsnachweis an, damit eine später eintreffende ältere
  Bestätigung keinen aktiven Slot erzeugt.
- War die Buchung mit einer weiterhin gleich terminierten Partie verknüpft,
  erhalten deren vier Spieler eine gemeinsame offene Aufgabe. Die erste
  Bestätigung hebt den Termin für alle auf; eine Ersatzbuchung löst dieselbe
  Aufgabe ebenfalls für alle.
- Stornierungen werden intern als unsichtbare Tombstones behalten, damit
  doppelte und verspätete Mails keine Buchung wiederherstellen.
