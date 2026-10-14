# Saisons und Seiten

Diese Datei ist die kanonische Quelle für Saisonidentitäten, Datenquellen, Saisonphasen, Navigation und saisonabhängige Seitenbereiche.

## Saison- und Datenmodell

- Saisons besitzen sprechende, stabile technische IDs im Schema `Jahr-Typ`, damit sie sich automatisch chronologisch gruppieren. „Sommer 2026“ verwendet `2026-sommer`, „Winter 2026“ `2026-winter` und der eigenständige Cup `2027-cup`. Frühere Saison-Links werden beim Aufruf auf die aktuellen IDs normalisiert.
- Die Datenbank ist die fachliche Quelle für strukturierte Spieler-, Teilnahme-, Saison-, Match-, Ergebnis- und Elo-Daten. Repositorybasierte Saisoninhalte bleiben auf redaktionelle Texte und kontrollierte Konfiguration begrenzt.
- Der noch vorhandene statische Ergebnis- und Elo-Bestand von „Sommer 2026“ ist ein zu entfernender Legacy-Fallback und nicht die maßgebliche Datenquelle. Bis zu seiner späteren Bereinigung bleibt dieser Unterschied im Projektstatus sichtbar.
- Editoriale Saisonartikel und zeitlich begrenzte Startseitenankündigungen bleiben im Git-Repository. Kurzankündigungen sind keine Saisonartikel und erscheinen nicht im Artikelarchiv. Sie können einen festen Ablaufzeitpunkt besitzen und werden ab diesem automatisch ausgeblendet, auch wenn die Startseite bereits geöffnet ist.
- `matches.match_at` ist der einzige verbindliche Zeitpunkt einer offiziellen Partie. Parallele Matchzeitfelder werden nicht geführt.
- Eine reguläre Nachfolgesaison übernimmt für bestätigte Teilnehmer den letzten offiziellen globalen Elo-Wert als Saisonstartwert. Teilnehmer werden erst nach fachlicher Bestätigung der tatsächlichen Besetzung angelegt.
- `players.initial_elo` ist der einmalige globale Ausgangswert eines offiziellen Spielers. `season_players.start_elo` friert den Saisonstart ein; `season_players.end_elo` entsteht erst beim offiziellen Saisonabschluss.

## Saisonwechsel und Seitenphasen

- Eine aktive Standardsaison bleibt bis zu ihrem offiziellen Abschluss die Voreinstellung. Eine vorbereitete Nachfolgesaison kann bereits auswählbar sein, ohne automatisch Standard zu werden.
- Der globale LIVE-Einstieg wechselt vor dem Öffnen des bildschirmfüllenden Livetickers in die Saison der laufenden Partie. Unter der Detailansicht liegt die Partienübersicht dieser Saison; Schließen führt dorthin, ein weiterer Browser-Zurück-Schritt führt in den zuvor betrachteten Saisonkontext.
- Rangliste, Partien und Rechner folgen der erreichten Wettbewerbsphase. Frühere abgeschlossene Phasen bleiben unterhalb der jeweils aktuellen Phase sichtbar.
- Sobald das Final Four die aktuelle Phase ist, steht sein gesamter Partienbereich oberhalb der Überschrift „Partien“ samt Sortierung und Filtern. Diese Anordnung bleibt nach Saisonabschluss erhalten; Sortierung und Filter gelten weiterhin auch für die Final-Four-Partien.
- Nach Abschluss der Ligaphase verschwindet der Ligarechner. Nach dem offiziellen Saisonabschluss verschwindet der gesamte Rechnerbereich.
- Cup-Saisons verwenden eine reduzierte Seitennavigation mit Turnierbaum und Informationen statt Liga-Rangliste, Rechner und Statistik.
- Die mobile Liga-Rangliste startet kompakt und bietet eine erweiterte, horizontal scrollbare Ansicht. Desktop behält die vollständige Rangliste.
- Die mobile Final-Four-Tabelle bleibt ohne Ansichtsumschalter kompakt und ohne horizontalen Bildlauf. Neben Platz und Spieler zeigt sie ausschließlich Siege, Spielverhältnis (`G:V`) und Spieldifferenz.
- Saisonauswahl und Kontoaktion bilden eine gemeinsame responsive Aktionszeile. Gemeinsame Dropdown- und Sekundärbutton-Komponenten werden wiederverwendet.
- Direkt verlinkte öffentliche Detailansichten wie Partievorschau, Liveticker und Spielerprofil öffnen nach dem Aufbau der Seite vor der Konto-Initialisierung. Login und private Kontodaten dürfen das sichtbare Öffnen des angeforderten Ziels nicht verzögern.
- PadelPong ist eine eigenständige Website unter `https://lw-ux.github.io/PadelPong/`. Der Liga-Button öffnet ausschließlich diese feste Adresse in einem neuen Tab und überträgt keinen Saisonkontext.
- Veröffentlichte Artikel bleiben sichtbar, bis ein neuer veröffentlichter Artikel ihren Platz einnimmt; unveröffentlichte Platzhalter werden nicht angezeigt.

## Cup

- Der Cup ist ein eigener Wettbewerb mit 16 Teilnehmerplätzen ab dem Viertelfinale. Partner und Gegner werden vor jeder Runde unter den verbliebenen Spielern neu ausgelost; Wiederholungen sind zulässig.
- Die beiden Spieler des siegreichen Finalteams gewinnen gemeinsam.
- Der Turnierbaum zeigt die Runden ohne feste Siegerpfade, weil zwischen den Runden neu ausgelost wird. Auf breiten Ansichten ist er vertikal, mobil horizontal nach Runden scrollbar und einrastend.

## Nicht öffentliche Test-Saison

- Eine technisch nutzbare Test-Saison bleibt in den öffentlichen Saisonauswahlen von Liga und Tippseite verborgen und ist für kontrollierte Tests direkt erreichbar.
- Die Test-Saison des Jahres 2026 verwendet entsprechend dem allgemeinen ID-Schema die technische ID `2026-test`.
- Laufende Partien einer verborgenen Test-Saison lösen den globalen LIVE-Einstieg nicht aus. Innerhalb der Test-Saison bleiben Liveticker und laufende Spielstände direkt nutzbar.
- Sie enthält dedizierte Testprofile und Szenarien für Konten, Einladungen, Ergebnisse, Gegenvorschläge, Tipps, Training und Liveticker. Der konkrete Datenbestand ist kein Teil des Projektgedächtnisses.
- Test-Saisons und reine Testpartien sind von öffentlichen Profilen, Karrierewerten, Auszeichnungen, offiziellen Ranglisten und globalem Elo ausgeschlossen.
- Die Test-Saison darf die vollständige Partievorschau und Partieanalyse mit einer ausschließlich aus ihren Saisonstartwerten und Testpartien berechneten Test-Elo-Historie zeigen. Testpartien, Test-Elo, Serien, Beziehungen und Vorgeschichten bleiben dabei strikt vom offiziellen Datenbestand getrennt.
- Testdaten werden nur gezielt zurückgesetzt. Persistente Testszenarien bleiben erhalten, wenn ihre Wiederverwendung fachlich gewollt ist.

## Winter 2026

- In der Ligaphase von „Winter 2026“ hat jeder Teilnehmer 6 Partien. Partner und Gegner werden für jede Partie neu gelost; statt fester Termine gibt es Zeitfenster, in denen sich die Spieler selbst abstimmen.
- „Winter 2026“ verwendet den Top-8-Modus mit Halbfinale (siehe [Partien, Training und Turniere](matches-and-tournaments.md)).
- „Winter 2026“ bietet kein Tippspiel an.

## Offene Entscheidungen

- Saisonstart, Teilnehmer, konkreter Spielplan und Zeitplan von „Winter 2026“ sind noch nicht abschließend festgelegt.
