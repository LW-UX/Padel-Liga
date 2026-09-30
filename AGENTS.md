# Projektgedächtnis

Vor fachlichen oder technischen Änderungen sind nur die für die Aufgabe einschlägigen Entscheidungsdateien zu lesen:

- Saison, Saison-ID, Datenquelle, Navigation oder Seitenphase: `docs/project-decisions/seasons-and-pages.md`
- Partie, Training, Termin, Ergebnis, Bestätigung, Turnier, Liveticker oder Rechner: `docs/project-decisions/matches-and-tournaments.md`
- Anmeldung, Konto, Rolle, Einladung, Berechtigung oder Konto-Dialog: `docs/project-decisions/accounts-and-workflows.md`
- Elo, Rangliste, Statistik, Profil oder Auszeichnung: `docs/project-decisions/rankings-statistics-and-profiles.md`
- Tippseite, Tipp, Tippschluss oder Tippwertung: `docs/project-decisions/tipping.md`
- Arcade: `docs/project-decisions/arcade.md`

Bei fachübergreifenden Aufgaben sind alle betroffenen Dateien zu lesen. Konto-Spielkarten und Ergebniseingaben betreffen insbesondere Konten und Partien; Elo-Korrekturen betreffen Ranglisten und Partien; termin- oder ergebnisabhängige Tipps betreffen Tippspiel und Partien. Bei Supabase-, Migrations-, Veröffentlichungs- oder Live-Statusfragen ist zusätzlich `docs/PROJECT_STATUS.md` zu lesen. Wenn die Zuordnung unklar ist, dient `docs/PROJECT_DECISIONS.md` als Wegweiser; anschließend ist gezielt in `docs/project-decisions/` zu suchen. Das vollständige Projektgedächtnis wird nur bei repositoryweiten Grundsatzänderungen gelesen.

Wenn eine neue Produkt-, Daten- oder Prozessentscheidung getroffen oder geändert wird, muss die kanonische Bereichsdatei im selben Arbeitsschritt aktualisiert werden. Eine Aussage gehört nur dann dorthin, wenn sie nach einer normalen Datenänderung weiterhin gelten soll. Veränderliche Bestandszahlen, konkrete Datensätze und andere Momentaufnahmen gehören in Datenbank, Code oder Tests; nur betriebsrelevanter Gegenwartsstand gehört in `docs/PROJECT_STATUS.md`. Überholte Statusmeldungen werden gelöscht und nicht dokumentarisch archiviert. Frühere Zustände werden bei Bedarf aus Git, Migrationen und Tests rekonstruiert. Technische Implementierungsdetails ohne dauerhafte fachliche Bedeutung werden nicht als Projektentscheidung dokumentiert.

## Zusammenarbeit mit dem Nutzer

Der Nutzer arbeitet ausschließlich über Codex und verwendet kein Terminal. Fordere ihn nicht dazu auf, Shell-, CLI-, Git- oder Datenbankbefehle selbst auszuführen. Führe notwendige und autorisierte Befehle mit den verfügbaren Werkzeugen selbst aus. Bitte den Nutzer nur um unvermeidbare sichtbare Freigaben, Anmeldungen oder fachliche Entscheidungen und erkläre diese ohne technische Vorkenntnisse vorauszusetzen.

Ausnahme: Pushes nach GitHub führt der Nutzer selbst durch. Codex bereitet Änderungen lokal vor und prüft sie, führt aber keine GitHub-Pushes aus. Das gilt auch für gleichwertige Veröffentlichungen von Code über die GitHub-API oder andere Werkzeuge. Aufforderungen zum Veröffentlichen sind entsprechend als lokale Vorbereitung für den anschließenden Push durch den Nutzer zu behandeln.

## Tests

Erstelle nicht automatisch für jede Änderung einen neuen Testfall. Ergänze oder ändere Tests nur, wenn sie einen sinnvollen dauerhaften Schutz bieten, insbesondere bei fachlicher Logik, behobenen Fehlern mit Wiederholungsrisiko, sicherheits- oder datenrelevantem Verhalten sowie komplexen Abläufen. Kleine visuelle Anpassungen, reine Textänderungen und vergleichbar risikoarme Änderungen benötigen ohne ausdrücklichen Wunsch des Nutzers keinen eigenen Testfall. Führe vorhandene passende Tests weiterhin in einem dem Risiko angemessenen Umfang aus.

## Supabase

Für Zugriffe auf die projektbezogene Supabase-Datenbank ist ausschließlich `tools/supabase-mcp.mjs` beziehungsweise der schlüsselbundgestützte Starthelfer `tools/run-supabase-mcp.sh` zu verwenden. Datenbank-Schreibaktionen sind dem Nutzer vor der Ausführung zur Freigabe vorzulegen. Wenn die Verbindung nicht verfügbar ist, darf nicht auf den Supabase-Browser oder einen selbstgebauten Einmal-OAuth-Ablauf ausgewichen werden; stattdessen ist die Verbindungsstörung klar zu melden.
