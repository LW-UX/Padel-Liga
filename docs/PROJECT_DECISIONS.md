# Projektentscheidungen Padel-Liga

Dieses Dokument ist der Wegweiser zum fachlichen Projektgedächtnis. Die verbindlichen Entscheidungen stehen thematisch getrennt unter `docs/project-decisions/`.

## Themen

- [Saisons und Seiten](project-decisions/seasons-and-pages.md): Saisonidentitäten, Datenstrategie, Navigation, Seitenphasen, Cup und Test-Saison.
- [Partien, Training und Turniere](project-decisions/matches-and-tournaments.md): Termine, Ergebnisse, Bestätigung, Turnierfortschritt, Liveticker, Training und Rechner.
- [Ligaspielplan-Auslosung](project-decisions/league-schedule.md): Modus, Regeln und Kontrollausgabe für die seedbasierte Auslosung eines Ligaspielplans mit 20 Teilnehmern.
- [Konten und Arbeitsabläufe](project-decisions/accounts-and-workflows.md): Rollen, Registrierung, Einladungen, Berechtigungen und Konto-Dialog.
- [Ranglisten, Statistik und Profile](project-decisions/rankings-statistics-and-profiles.md): Elo, Ranglisten, All-Time-Statistik, Profile und Auszeichnungen.
- [Tippspiel](project-decisions/tipping.md): Tippbarkeit, Fristen, Wertung und Tippseite.
- [Ligaartikel](project-decisions/articles.md): Aufbau, Datenformat, Stil und Begriffe der Saisonartikel.

PadelPong wird in seinem eigenen Repository dokumentiert. Dieses Projekt hält nur noch die externe Navigation dorthin fest.

Der [aktuelle Projektstatus](PROJECT_STATUS.md) enthält ausschließlich betriebsrelevanten Gegenwartsstand. Frühere Zustände werden nicht zusätzlich dokumentiert; dafür dienen Git, Migrationen und Tests.

## Was als Entscheidung dokumentiert wird

Eine Information gehört nur dann in die fachlichen Entscheidungsdateien, wenn sie nach einer normalen Datenänderung weiterhin gelten soll.

- Dauerhafte Produkt-, Daten- oder Prozessregeln werden dokumentiert.
- Aktuelle Anzahlen, konkrete Datensätze, offene Partien, Teilnehmerlisten und angewendete Migrationen gehören nicht in das Zielbild.
- Werte bleiben präzise, wenn sie selbst Teil der Regel sind, etwa Fristen, Wertung, Rollen oder stabile IDs.
- Aus Code, Datenbank oder Tests zuverlässig ableitbare Implementierungsdetails werden dort gepflegt und nicht zusätzlich beschrieben.
- Noch nicht beschlossene Punkte stehen ausdrücklich unter „Offene Entscheidungen“ und gelten nicht als Zielbild.

## Pflege

- Jede Entscheidung besitzt genau eine kanonische Bereichsdatei. Andere Dateien verweisen bei Bedarf kurz darauf.
- Neue Entscheidungen ersetzen überholte Aussagen im aktuellen Zielbild; überholte Statusmeldungen werden gelöscht statt archiviert.
- Technische Details ohne dauerhafte fachliche Bedeutung werden nicht aufgenommen.
- Bei bereichsübergreifenden Änderungen werden alle betroffenen Dateien gemeinsam aktualisiert.
