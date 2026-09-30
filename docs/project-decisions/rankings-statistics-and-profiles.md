# Ranglisten, Statistik und Profile

Diese Datei ist die kanonische Quelle für Elo, Ranglisten, Statistik, öffentliche Spielerprofile und Auszeichnungen.

## Globales Elo

- Elo wird global über alle offiziellen Liga- und Cup-Partien mit `counts_for_elo = true` fortgeschrieben. Trainings, Test-Saisons und ausdrücklich ausgeschlossene Partien verändern Elo nicht.
- Die Reihenfolge richtet sich nach dem offiziellen Matchzeitpunkt und bei Gleichstand stabil nach der Match-ID. Ein Spieler darf nicht zeitgleich in mehreren offiziellen Partien eingesetzt sein.
- Der letzte globale Wert ist der aktuelle Elo-Wert unabhängig von der geöffneten Saison. Historische Prognosen verwenden den vor der jeweiligen Partie gespeicherten Wert.
- Jede gewertete Partie speichert für alle vier Spieler Elo davor, Änderung und Elo danach in `match_elo_changes`.
- Ergebnisbestätigungen serialisieren die Elo-Berechnung über eine transaktionsgebundene Sperre. Korrekturen an Zeit, Ergebnis oder Sieger berechnen die betroffene Partie und alle chronologisch folgenden offiziellen Partien konsistent neu.
- Saisonstart und Saisonende sind eingefrorene Darstellungs- beziehungsweise Abschlusswerte, keine zusätzlichen Elo-Ereignisse.
- Die verwendete Berechnungsversion wird nachvollziehbar gehalten, damit spätere Vergleiche und kontrollierte Neuberechnungen möglich bleiben.

## Ranglisten und Statistik

- Saisonstatistik ist die Standardansicht. Ein nicht persistenter Umschalter öffnet eine All-Time-Ansicht.
- All-Time umfasst abgeschlossene offizielle Liga-, Final-Four- und Cup-Partien sowie Spieler mit mindestens einer solchen Partie. Training, Test-Saisons und offene Partien sind ausgeschlossen.
- Saisonabhängige Auswertungen wie Spieltagsplatzierungen, Qualifikationsprognose und Losglück erscheinen nicht in All-Time.
- Satzdominanz wird als durchschnittliche Spieldifferenz je regulärem Satz berechnet; Tiebreak-Punkte zählen nicht als Games.
- Elo-Verläufe besitzen genau einen globalen Initialpunkt und danach echte Elo-Ereignisse. Saisonverläufe begrenzen die Darstellung zusätzlich durch eingefrorenen Saisonstart und gegebenenfalls Saisonende.
- Diagramme unterscheiden gespielte, spielfreie und noch offene Spieltage verständlich und verwenden konsistente, viewportgebundene Tooltips.
- Elo-Änderungen werden nicht in öffentlichen Ergebnislisten ausgewiesen, bleiben aber intern nachvollziehbar.

## Öffentliche Spielerprofile

- Jedes Spielerprofil ist öffentlich und vom privaten Konto getrennt. Profilverknüpfungen verwenden stabile Spieler-IDs.
- Profile aggregieren bestätigte Daten serverseitig und zeigen Karrierewerte, globalen Elo-Verlauf, Saison- und Finalrunden-Teilnahmen, Training, Auszeichnungen, Beziehungen sowie vergangene Liga- und Trainingspartien.
- Teilnahmen werden chronologisch dargestellt und nach Ligaphase sowie qualifizierter Finalrunde gegliedert. Laufende Saisons werden gekennzeichnet.
- Trainings- und Final-Four-Gewichte folgen den Regeln aus `matches-and-tournaments.md`; Match-Tiebreak-Punkte zählen nicht als Games.
- Vergangene Partien werden chronologisch gruppiert und bei Bedarf vollständig eingeblendet. Liga- und Trainingsergebnisse bleiben visuell unterscheidbar.
- Lieblingspartner, Lieblingsgegner und Angstgegner basieren auf bestätigten Liga- und Trainingspartien. Eine Beziehung benötigt mindestens drei gemeinsame Partien; genau 50 Prozent Siegquote qualifiziert für keine Kategorie.
- Profilbilder liegen im Repository unter `assets/players/<spieler-id>/profile.webp`. Ohne Bild wird der im Spielerstamm hinterlegte Emoji verwendet. Binärbilder werden nicht in Supabase gespeichert.

## Auszeichnungen und Farben

- Auszeichnungen sind explizite Datenbankeinträge und werden nicht aus Mockups oder laufenden Platzierungen erfunden. Ohne Einträge wird der Bereich ausgeblendet.
- Champion-Auszeichnungen stehen vor den gleichwertigen Auszeichnungen „Finale“ und „Final 4“; innerhalb einer Wertigkeitsgruppe steht die neueste zuerst.
- Liga und Cup besitzen getrennte Metallfarbwelten. Saisonfarben für Sommer, Winter, Cup und neutrale Saisons werden zentral nach Saison-Typ bestimmt und nur für saisonbezogene Profilvisualisierungen verwendet.
- Nach einem bestätigten Cup-Finale entstehen Champion-Auszeichnungen für das Gewinnerteam und Finale-Auszeichnungen für das Verliererteam.
- Final-Four-Auszeichnungen entstehen erst bei feststehender Qualifikation. Der Champion wird nach vollständigem Final Four anhand von Siegen, Spiel-Differenz, gewonnenen Spielen und Ausgangsplatzierung bestimmt.
