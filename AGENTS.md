# Projektgedächtnis

Vor fachlichen oder technischen Änderungen ist `docs/PROJECT_DECISIONS.md` zu lesen.

Wenn im Zuge einer Aufgabe eine neue Produkt-, Daten- oder Prozessentscheidung getroffen oder eine bestehende Entscheidung geändert wird, muss `docs/PROJECT_DECISIONS.md` im selben Arbeitsschritt aktualisiert werden. Neuere Entscheidungen ersetzen ältere; überholte Aussagen sind als solche zu kennzeichnen oder aus dem aktuellen Zielbild zu entfernen.

Technische Implementierungsdetails ohne dauerhafte fachliche Bedeutung gehören nicht in die Entscheidungsdatei.

## Zusammenarbeit mit dem Nutzer

Der Nutzer arbeitet ausschließlich über Codex und verwendet kein Terminal. Fordere ihn nicht dazu auf, Shell-, CLI-, Git- oder Datenbankbefehle selbst auszuführen. Führe notwendige und autorisierte Befehle mit den verfügbaren Werkzeugen selbst aus. Bitte den Nutzer nur um unvermeidbare sichtbare Freigaben, Anmeldungen oder fachliche Entscheidungen und erkläre diese ohne technische Vorkenntnisse vorauszusetzen.

## Supabase

Für Zugriffe auf die projektbezogene Supabase-Datenbank ist ausschließlich der MCP-Server `supabase_padel_liga` zu verwenden. Datenbank-Schreibaktionen sind dem Nutzer vor der Ausführung zur Freigabe vorzulegen. Wenn die Verbindung nicht verfügbar ist, darf nicht auf den Supabase-Browser oder einen selbstgebauten Einmal-OAuth-Ablauf ausgewichen werden; stattdessen ist die Verbindungsstörung klar zu melden.
