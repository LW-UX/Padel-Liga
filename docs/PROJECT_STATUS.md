# Aktueller Projektstatus

Diese Datei enthält nur betriebsrelevanten Gegenwartsstand. Dauerhafte Regeln stehen unter `docs/project-decisions/`. Überholte Statusmeldungen werden gelöscht; frühere Zustände bleiben über Git, Migrationen und Tests nachvollziehbar.

## Produktion

- Supabase enthält den aktiven strukturierten Bestand für Spieler, Saisons, Partien, Ergebnisse, Elo, Konten, Tipps, Training, Profile, Liveticker und Bestenliste.
- Final-Four-Liveticker mit punktweiser oder spielweiser Erfassung, revisionssichere Korrekturen und die automatische Bestätigung offener Ergebnisvorschläge nach 48 Stunden sind datenbankseitig produktiv aktiviert.
- Öffentliche All-Time-Statistik, Spielerprofile, globale Elo-Fortschreibung, Spielereinladungen und saisonabhängige Turnierfortschreibung sind produktiv verfügbar.
- Eine nicht öffentliche Test-Saison steht für kontrollierte Konto-, Ergebnis-, Tipp-, Trainings- und Livetickerabläufe bereit.

## Noch ausstehend

- `data/data2026.js` enthält weiterhin veraltete Ergebnis- und Elo-Duplikate. Die Anwendung bevorzugt die Datenbank, besitzt aber noch einen statischen Legacy-Fallback. Dessen Entfernung und die Beschränkung der Saisondatei auf redaktionelle Inhalte erfolgen in einer späteren eigenen Änderung.
- Die Supabase-Objekte für PadelPong sind produktiv und verlustfrei auf `pong_*` umbenannt. Temporäre Kompatibilitäts-RPCs halten die bisherige Liga-Seite bis zur Veröffentlichung beider Repositories funktionsfähig; deren spätere Entfernung ist vorbereitet. Der feste externe Liga-Link und das eigenständige PadelPong-Repository sind lokal fertiggestellt, aber noch nicht veröffentlicht.
- Die Umschaltoberfläche für den punkt- oder spielweisen Final-Four-Liveticker ist lokal implementiert; ihre Veröffentlichung erfolgt erst mit einem vom Nutzer ausgeführten GitHub-Push.
- Die Datenbankgrundlage und Adminfunktion für endgültig nicht gewertete Ligapartien sind produktiv aktiviert, einschließlich des Entfernens des Matchzeitpunkts und der unsichtbaren Profilsortierung über den Spieltagsbeginn. Die Veröffentlichung der Oberflächenänderungen und die Markierung der zwei offenen Sommer-Partien stehen noch aus.
- Der reguläre Winter-Spielplan und weitere zukünftige Adminfunktionen benötigen noch fachliche Entscheidungen.
