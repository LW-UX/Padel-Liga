# Öffentliche Lucky-Star-Verfügbarkeit

`POST` mit `{ "date": "YYYY-MM-DD" }` liefert öffentliche Plätze, deren
Indoor-/Outdoor-Zuordnung, Öffnungszeiten und freie 60-Minuten-Slots.
Start und Ende sind ISO-Zeitpunkte; `time` ist die Berliner Startzeit.
Keine Konto-, Teilnehmer- oder Buchungsdaten werden abgefragt oder gespeichert.
Die Function benötigt keine Secrets und wird ausschließlich für diese öffentliche
Lesefunktion mit `verify_jwt: false` bereitgestellt. Alle anderen Functions behalten
im vorhandenen Starthelfer ihre JWT-Prüfung.

Die Club-Metadaten aus dem öffentlichen Next.js-Stream werden eine Stunde
zwischengespeichert. Verfügbarkeitsanfragen werden nur während identischer laufender
Abrufe zusammengeführt. Fehler oder ein geändertes Anbieterformat ergeben HTTP 502;
ungültige Kalendertage HTTP 400. Es gibt keinen Rückgriff auf alte Slotdaten.

Die öffentliche Playtomic-Abfrage ist keine zugesicherte Integrations-API.
Eine Antwort stellt keine Reservierung dar.
