# Tippspiel

Diese Datei ist die kanonische Quelle für Tippabgabe, Fristen, Wertung und die eigenständige Tippseite.

## Seite und Konten

- Das Tippspiel liegt auf einer eigenständigen Seite unter `/tipp/` und verwendet dieselben Konten wie Liga und Cup.
- Die Seite besitzt die Bereiche „Tippen“ und „Tippübersicht“. Die öffentliche Übersicht zeigt Konten mit mindestens einem abgegebenen Tipp.
- Die Liga kann den sichtbaren Einstieg zum Tippspiel saison- oder betriebsabhängig ausblenden, ohne bestehende Direktaufrufe der Tippseite zu entfernen.

## Tippbarkeit und Fristen

- Tipps beziehen sich auf reale angelegte Partien, nicht auf frei erstellte Begegnungen.
- Eine reguläre Ligapartie kann vor ihrer Terminierung tippbar sein, sofern ihr allgemeiner Tippstatus geöffnet ist.
- Sobald ein Termin feststeht, schließt `matches.match_at` die Tippabgabe zum Spielbeginn; ein vergangener Termin schließt sofort. Einen parallelen Sperrzeitpunkt gibt es nicht.
- Turnierpartien werden erst tippbar, wenn echte Teilnehmer und ein vollständiger Termin feststehen.
- Ein Tipp kann bis zum Schließzeitpunkt abgegeben und geändert werden. Die Ergebniseingabe selbst ist nicht der Schließzeitpunkt.

## Wertung

- Vier Punkte werden für das exakte vorhergesagte Ergebnis vergeben, zwei für den richtigen Sieger bei anderem Ergebnis und null für den falschen Sieger.
- Best-of-three-Partien werden über das Satzergebnis getippt. Bei einem einzelnen Final-Four-Satz wird der genaue Satzendstand getippt.
- Nachträglich korrigierte offizielle Ergebnisse werden mit ihrem aktuellen bestätigten Stand ausgewertet.
- Tipps auf eine später aus der Wertung genommene Partie bleiben sichtbar, werden als „Nicht gewertet“ gekennzeichnet und zählen weder als gewerteter Tipp noch für Treffer oder Punkte.
- Ob eine Saison ein Tippspiel anbietet, ist Saisonkonfiguration und kein aus dem Datenbestand abgeleiteter Automatismus.
