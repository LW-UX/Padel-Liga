# Ligaspielplan-Auslosung

Diese Datei ist die kanonische Quelle für den Modus, nach dem der reguläre Ligaspielplan einer Saison mit 20 Teilnehmern erstellt wird. Saisonbezogene Besonderheiten wie Zeitfenster oder Endrunde stehen in [Saisons und Seiten](seasons-and-pages.md) beziehungsweise [Partien, Training und Turniere](matches-and-tournaments.md).

## Grundsatz

- Der vollständige Ligaspielplan wird einmalig rechnergestützt und seedbasiert ausgelost und anschließend unverändert veröffentlicht. Es wird genau eine Lösung erzeugt; Alternativen werden weder erzeugt noch verglichen.
- Es gibt keine manuellen Änderungen und keine Wiederholung der Auslosung, sobald die erste gültige Lösung der höchstmöglichen Gegnerstufe feststeht.
- Der Modus gilt für künftige Saisons. Der bereits gesperrte Spielplan von „Winter 2026“ wurde noch mit einer Grenze von 150 Punkten Team-Elo-Differenz ausgelost und bleibt unverändert.
- Der Spielplan wird nur veröffentlicht, wenn sämtliche Regeln bestanden sind. Wird keine gültige Lösung mit mindestens elf verschiedenen Gegnern gefunden, wird keine Regel selbstständig gelockert; stattdessen wird gemeldet, dass mit den vorgegebenen Bedingungen kein gültiger Spielplan erstellt werden konnte.

## Teilnehmer und Planungs-Elo

- Es nehmen genau 20 Spieler teil.
- Für die Auslosung werden ausschließlich vorab festgelegte Planungs-Elo-Werte verwendet. Sie werden nach der Erstellung des Spielplans nicht mehr verändert.
- Weder das offizielle Elo noch spätere Ergebnisse oder Elo-Veränderungen fließen in die Auslosung ein.

## Feste Spielplanregeln

1. Es gibt genau sechs Spieltage.
2. An jedem Spieltag finden genau fünf Partien statt.
3. Jede Partie besteht aus zwei Teams mit jeweils zwei Spielern.
4. Jeder Spieler spielt an jedem Spieltag genau einmal und insgesamt genau sechsmal.
5. Jede konkrete Partnerschaft darf höchstens einmal vorkommen.
6. Jeder Spieler soll im besten Fall zwölf verschiedene Gegner haben, mindestens jedoch elf.
7. Dasselbe Gegnerpaar darf höchstens zweimal vorkommen. Eine dritte Begegnung als Gegner ist ausgeschlossen.
8. Eine Person darf einmal Partner und an einem anderen Spieltag Gegner derselben Person sein.
9. Die beiden Team-Elo-Werte einer Partie dürfen sich um höchstens 120 Punkte unterscheiden.
10. Das Team-Elo wird folgendermaßen berechnet: `Team-Elo = 0,7 × Elo des schwächeren Spielers + 0,3 × Elo des stärkeren Spielers`.
11. Ein Spieler mit hohem Elo darf mit einem Spieler mit niedrigem Elo zusammenspielen. Eine große Differenz innerhalb eines Teams ist kein Ausschlussgrund, solange die Differenz zwischen den beiden Team-Elo-Werten höchstens 120 Punkte beträgt.
12. Die 20 Spieler werden nach Planungs-Elo in eine obere und eine untere Hälfte mit jeweils zehn Spielern sortiert. Diese Einteilung dient ausschließlich den folgenden Kontrollregeln und bildet keine Lostöpfe. Bei identischen Planungs-Elo-Werten entscheidet ausschließlich der feste Seed über die Reihenfolge.
13. Jeder Spieler muss unter seinen unterschiedlichen Gegnern mindestens vier Spieler aus der oberen und mindestens vier Spieler aus der unteren Hälfte haben.
14. Abgesehen von diesen festen Regeln werden Partien und Teams ausgelost.
15. Es findet keine weitere Optimierung nach Gewinnwahrscheinlichkeit, möglichst geringer Team-Elo-Differenz, Elo-Summe, durchschnittlicher Matchstärke oder persönlicher Saisonwahrscheinlichkeit statt.
16. Eine Team-Elo-Differenz von 0 ist nicht besser als eine andere zulässige Differenz bis einschließlich 120.
17. Leichtere und schwerere Partien sind ausdrücklich zulässig und Bestandteil der Auslosung.

## Stufen der Gegneranforderung

1. Zunächst wird eine gültige Lösung mit zwölf verschiedenen Gegnern pro Spieler gesucht.
2. Existiert unter allen festen Regeln keine solche Lösung, wird eine gültige Lösung mit mindestens elf verschiedenen Gegnern pro Spieler gesucht.
3. Weniger als elf verschiedene Gegner sind unzulässig.
4. Dasselbe Gegnerpaar darf in jeder Stufe höchstens zweimal vorkommen.

Sobald in der höchstmöglichen Stufe anhand des festen Seeds die erste vollständig gültige Lösung gefunden wurde, ist diese der endgültige Spielplan.

## Losverfahren

- Das Losverfahren ist rechnergestützt und seedbasiert. Der Seed bestimmt die Reihenfolge, in der zulässige Spieler, Teams und Partien ausprobiert werden.
- Die Regeln sind ausschließlich Bedingungen für eine gültige Auslosung. Sie werden nicht als Bewertungswerte verwendet, um unter mehreren gültigen Spielplänen nachträglich den vermeintlich schönsten auszuwählen.

## Verbindliche Ausgabe und Kontrolle

Zur Auslosung gehören folgende Angaben:

1. sechs Spieltage mit jeweils fünf Partien,
2. die beiden Teams jeder Partie,
3. das berechnete Team-Elo beider Teams,
4. die Team-Elo-Differenz jeder Partie,
5. für jeden Spieler seine sechs unterschiedlichen Partner,
6. für jeden Spieler alle unterschiedlichen Gegner,
7. für jeden Spieler die Zahl seiner unterschiedlichen Gegner,
8. für jeden Spieler die Anzahl unterschiedlicher Gegner aus der oberen und unteren Hälfte,
9. sämtliche Gegnerpaare, die zweimal vorkommen,
10. eine Bestätigung, dass kein Gegnerpaar dreimal vorkommt,
11. eine Bestätigung, dass jede Partnerschaft höchstens einmal vorkommt,
12. eine Prüfung jeder festen Spielplanregel mit „BESTANDEN“ oder „NICHT BESTANDEN“,
13. die erreichte Gegnerstufe: zwölf oder elf unterschiedliche Gegner,
14. den verwendeten Seed und die unveränderten Planungs-Elo-Werte,
15. die addierte Team-Elo-Differenz pro Spieler,
16. die durchschnittliche Siegwahrscheinlichkeit pro Spieler.

Die Angaben 15 und 16 dienen ausschließlich der Transparenz und haben keinen Einfluss auf die Auslosung.
