# Saisons und Seiten

Diese Datei ist die kanonische Quelle für Saisonidentitäten, Datenquellen, Saisonphasen, Navigation und saisonabhängige Seitenbereiche.

## Saison- und Datenmodell

- Saisons besitzen stabile technische IDs. „Sommer 2026“ verwendet `2026`, „Winter 2026“ `winter-2026` und der eigenständige Cup `cup-2027`.
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
- Nach Abschluss der Ligaphase verschwindet der Ligarechner. Nach dem offiziellen Saisonabschluss verschwindet der gesamte Rechnerbereich.
- Cup-Saisons verwenden eine reduzierte Seitennavigation mit Turnierbaum und Informationen statt Liga-Rangliste, Rechner und Statistik.
- Die mobile Liga-Rangliste startet kompakt und bietet eine erweiterte, horizontal scrollbare Ansicht. Desktop behält die vollständige Rangliste.
- Saisonauswahl und Kontoaktion bilden eine gemeinsame responsive Aktionszeile. Gemeinsame Dropdown- und Sekundärbutton-Komponenten werden wiederverwendet.
- Veröffentlichte Artikel bleiben sichtbar, bis ein neuer veröffentlichter Artikel ihren Platz einnimmt; unveröffentlichte Platzhalter werden nicht angezeigt.

## Cup

- Der Cup ist ein eigener Wettbewerb mit 16 Teilnehmerplätzen ab dem Viertelfinale. Partner und Gegner werden vor jeder Runde unter den verbliebenen Spielern neu ausgelost; Wiederholungen sind zulässig.
- Die beiden Spieler des siegreichen Finalteams gewinnen gemeinsam.
- Der Turnierbaum zeigt die Runden ohne feste Siegerpfade, weil zwischen den Runden neu ausgelost wird. Auf breiten Ansichten ist er vertikal, mobil horizontal nach Runden scrollbar und einrastend.

## Nicht öffentliche Test-Saison

- Eine technisch nutzbare Test-Saison bleibt in den öffentlichen Saisonauswahlen von Liga und Tippseite verborgen und ist für kontrollierte Tests direkt erreichbar.
- Laufende Partien einer verborgenen Test-Saison lösen den globalen LIVE-Einstieg nicht aus. Innerhalb der Test-Saison bleiben Liveticker und laufende Spielstände direkt nutzbar.
- Sie enthält dedizierte Testprofile und Szenarien für Konten, Einladungen, Ergebnisse, Gegenvorschläge, Tipps, Training und Liveticker. Der konkrete Datenbestand ist kein Teil des Projektgedächtnisses.
- Test-Saisons und reine Testpartien sind von öffentlichen Profilen, Karrierewerten, Auszeichnungen, offiziellen Ranglisten und globalem Elo ausgeschlossen.
- Testdaten werden nur gezielt zurückgesetzt. Persistente Testszenarien bleiben erhalten, wenn ihre Wiederverwendung fachlich gewollt ist.

## Offene Entscheidungen

- Der reguläre Spielplan von „Winter 2026“ ist noch nicht abschließend festgelegt.
