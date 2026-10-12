# Ligaartikel

Redaktionelle Richtlinien für Saisonartikel. Wo Artikel gespeichert werden und wann sie sichtbar sind, regelt [Saisons und Seiten](seasons-and-pages.md).

## Grundsätze

- Jeder Spieltag erhält einen Spieltagsartikel. Er blickt kurz auf die Ereignisse seit dem letzten Artikel zurück und stellt anschließend alle Partien des neuen Spieltags vor.
- Daneben gibt es freie Artikel, etwa Final-Four-Berichte, Saisonrückblicke, Porträts oder Sonderthemen. Sie sind an den festen Aufbau nicht gebunden und wählen eine zum Thema passende Gliederung. Grundsätze, Datenformat sowie Sprache und Stil gelten für alle Artikel.
- Fakten wie Ergebnisse, Tabellenplätze, Punkte, Differenzen, Elo-Werte und Gewinnwahrscheinlichkeiten stammen aus der Datenbank, und zwar mit dem Stand zum Zeitpunkt des Schreibens.
- Zitate, Szenen, Wetter, Verletzungen, Urlaube und Hintergründe stammen ausschließlich von der Redaktion, also vom Nutzer. Nichts davon wird erfunden. Fehlt ein Zitat, wird die Partie ohne Zitat vorgestellt.
- Zitate werden wörtlich übernommen, auch umgangssprachliche Formulierungen. Höchstens offensichtliche Tippfehler werden korrigiert.

## Aufbau von Spieltagsartikeln

1. **Meta-Zeile:** `SPIELTAG n  ·  T. MONAT - T. MONAT JJJJ`, in Großbuchstaben. Angegeben wird das Spielfenster von Montag bis Freitag der zweiten Woche. `startDate` und `endDate` des Artikels reichen dagegen von Montag bis Sonntag.
2. **Titel:** kurz und pointiert, oft mit einer Wendung am Ende, zum Beispiel „Absolute Firmendominanz - noch“ oder „Neuer König, alte Kämpfer“. Der Titel greift die wichtigste Entwicklung seit dem letzten Spieltag auf.
3. **Einstieg (1–3 Absätze):** Was ist seit dem letzten Artikel passiert? Nachgeholte Partien, Überraschungen, neue Tabellenführung, erste Siege und Firmenduelle.
4. **Optional, Ankündigung:** eine eigene Zwischenüberschrift für Ligaleitungs-Neuigkeiten, etwa neue Funktionen der Webseite oder den Modus des Final Four.
5. **Ein Abschnitt pro Partie:**
   - Zwischenüberschrift `Partie N - Untertitel`. Die Partien sind über die ganze Saison durchnummeriert. Der Untertitel benennt die Geschichte der Partie: „Das Rematch“, „Presseboykott trifft Kampfansage“.
   - Ein Spielblock mit den Paarungen.
   - 1–3 Absätze mit Einordnung: Form, Tabellenplatz, Elo, Vorgeschichte und Verbindungen zwischen den Spielern.
   - 0–2 Zitate, jeweils durch einen Absatz mit Doppelpunkt eingeleitet und von einem kurzen, pointierten Absatz kommentiert.
   - Bereits gespielte Partien heißen `Partie N - Bereits gespielt: …`, haben das Ergebnis im Spielblock und werden als kurzer Spielbericht erzählt statt als Vorschau.
6. **Abschluss:** eine Zwischenüberschrift wie „Blick auf die Tabelle“ oder „Spieltag N - auf einen Blick“, dazu 1–2 Absätze zur Tabellenlage und zum Saisonziel. Am Ende steht eine kurze, rhythmische Schlusszeile, gern als Rückgriff auf ein Zitat: „Erstmal spielen. Dann rätseln.“

Richtwert für die Länge: 600–900 Wörter.

## Datenformat

- Blocktypen: `p` (Absatz), `h` (Zwischenüberschrift), `match` (Spielblock), `quote` (Zitat mit `author`).
- Spielblock: `text` enthält `Vorname I. & Vorname I. vs. Vorname I. & Vorname I.` mit Team 1 zuerst. `result` und `resultLabel` stehen getrennt:
  - Vorschau: `"result": "61 : 39 %"`, `"resultLabel": "Gewinnwahrscheinlichkeit"`
  - Gespielt: `"result": "6:3, 6:3"`, `"resultLabel": "Ergebnis"`. Ein Match-Tie-Break wird als `Match-Tie-Break 10:6` angegeben.
- Im Spielblock werden Ergebnisse aus Sicht von Team 1 angegeben, im Fließtext aus Sicht der Sieger.

## Sprache und Stil

- **Ton:** Sportjournalismus mit Augenzwinkern. Leicht ironisch und dramatisierend, aber immer wohlwollend. Niederlagen und Schwächephasen werden mit Sympathie erzählt, niemand wird bloßgestellt.
- **Stilmittel:** rhetorische Fragen, kurze Satzfragmente für Rhythmus („Noch.“, „Mehr braucht es nicht.“), Gegensatzpaare (Technik gegen Spirit, Statistik gegen Kampfgeist), Sportmetaphern und gelegentlich „diese Redaktion“.
- **Wiederkehrende Erzählstränge:** Spitznamen, Running Gags und frühere Zitate werden über die Saison weitergeführt und wieder aufgegriffen, zum Beispiel der Spirit-König, ein Presseboykott oder notorisch pessimistische Selbsteinschätzungen. Prognosen der Spieler werden später mit dem tatsächlichen Ergebnis abgeglichen.
- **Firmenduell:** Die Bilanz der beteiligten Unternehmen ist ein fester Erzählstrang.
- **Namen:** Vorname mit Nachnamensinitial und Punkt („Marco M.“). Nach der ersten Nennung im Abschnitt ist auch der Vorname allein möglich. In Zwischenüberschriften und Spielblöcken werden Namen in dieser Form automatisch mit dem Spielerprofil verlinkt, im Fließtext und in Zitaten nicht.
- **Zahlen:** im Fließtext eingebettet, nicht als Liste: Platz, Punkte, Bilanz („drei Siege aus drei Spielen“), Differenz („+22“), Gewinnwahrscheinlichkeit („54:46“ oder „14 Prozent“) und Elo.
- **Elo:** „der Elo“ oder „der Elo-Score“, immer mit männlichem Artikel, zum Beispiel „sein Elo von 1149 ist der höchste der Liga“. Nicht „das Elo“ und nicht „Elo-Rating“.
- **Zeichen:** Als Gedankenstrich dient ` - ` mit Leerzeichen. Anführungszeichen im Fließtext sind deutsche Anführungszeichen „…“.
- **Ansprache:** Spieler werden sachlich-locker in der dritten Person beschrieben. Leser werden nicht direkt geduzt.
