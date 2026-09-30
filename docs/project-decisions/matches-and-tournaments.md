# Partien, Training und Turniere

Diese Datei ist die kanonische Quelle für Terminierung, Ergebnisse, Bestätigung, Trainingsspiele, Turnierfortschritt, Liveticker und Rechner.

## Offizielle Partien und Termine

- Ligapartien werden durch den Spielplan angelegt und nicht von Spielern erstellt.
- Beteiligte Spieler und Admins dürfen offene Partien terminieren, umterminieren oder nach Sicherheitsabfrage wieder ohne Termin führen. Abgeschlossene Partien und Partien mit offenem Ergebnisvorschlag sind davon ausgenommen.
- Ein Ergebnisvorschlag enthält das vollständige Ergebnis und den tatsächlichen Spielzeitpunkt. Dieser darf vom Plan abweichen, aber nicht in der Zukunft liegen.
- Nach Bestätigung wird der vorgeschlagene Zeitpunkt zum einzigen offiziellen Matchzeitpunkt.
- Die öffentliche Partienübersicht gruppiert standardmäßig nach Spieltagen und alternativ chronologisch. Interne Bestätigungszustände bleiben privat.
- Die große Ergebniszahl der öffentlichen Partienübersicht bezeichnet immer den Satzstand; die einzelnen Spielergebnisse stehen darunter. Eine laufende Final-Four-Partie zeigt deshalb bis zum Satzabschluss `0:0` und darunter den aktuellen Spielstand mit Live-Kennzeichnung. Nach Abschluss bleibt die aus den Elo-Werten vor der Partie berechnete Gewinnwahrscheinlichkeit sichtbar.

## Ergebnisregeln und Bestätigung

- Ergebnisse werden strukturiert über Satz-Counter erfasst und serverseitig erneut validiert. Sieger und Satzbilanz werden abgeleitet, nicht separat eingegeben.
- Reguläre Sätze enden mit 6:0 bis 6:4, 7:5 oder 7:6. Ein Satz-Tiebreak ist bei 7:6 beziehungsweise 6:7 verpflichtend. Bei geteilten Sätzen entscheidet im Best-of-three ein Match-Tiebreak; Tiebreaks benötigen ab ihrem Zielwert zwei Punkte Abstand.
- Ein beteiligter Spieler kann für sein Team vorschlagen. Das andere Team bestätigt oder macht einen in mindestens einem fachlichen Wert abweichenden Gegenvorschlag; eine reine Ablehnung gibt es nicht.
- Jeder Gegenvorschlag ersetzt den vorherigen offenen Vorschlag. Unveränderte Alternativen werden im Client und serverseitig abgelehnt.
- Offene Liga-, Cup- und Trainingsvorschläge werden 48 Stunden nach dem letzten Vorschlag automatisch bestätigt. Ein Gegenvorschlag startet die Frist neu. Automatische und manuelle Bestätigung haben dieselben fachlichen Folgen.
- Admin-Ergebnisse werden unmittelbar offiziell. Die bewusst gewählte normale Spieleraktion eines Admins folgt dagegen dem regulären Bestätigungsablauf.
- Bestätigte offizielle Ergebnisse aktualisieren Rangliste, Elo, Tipps, Auszeichnungen und Turnierfortschritt transaktional nach den Regeln des jeweiligen Wettbewerbs.

## Turniermodi und Abschluss

- Reguläre Liga, Viertelfinale, Halbfinale, Final Four und Finale sind getrennte Wettbewerbsphasen. Turnierpartien verändern die abgeschlossene Ligatabelle nicht.
- Der K.-o.-Cup beginnt im Viertelfinale und wird nach jeder Runde kontrolliert neu ausgelost. Seine Partien zählen nicht für Ligapunkte, können aber für Elo zählen.
- Im direkten Top-4-Modus werden nach Abschluss der Liga die vier Qualifizierten automatisch in die drei Final-Four-Paarungen eingesetzt.
- Im Top-8-Modus spielen zunächst die Qualifikationsgruppen gegeneinander; die vier Halbfinalsieger werden nach ihrer ursprünglichen Ligaplatzierung in das Final Four eingesetzt.
- Automatische Turnierfortschreibung ist idempotent und überschreibt keine Folgerunde mit bereits vorhandenen Ergebnissen, Vorschlägen oder Tipps.
- Ein Wettbewerb wird erst abgeschlossen, wenn der gesperrte Spielplan vollständig, alle erforderlichen Partien besetzt und beendet sowie die jeweilige Endrunde vollständig ist. Dann werden Saisonendwerte eingefroren und weitere Ergebniseingaben deaktiviert.

## Final-Four-Liveticker

- Terminierte Ein-Satz-Partien des Final Four können Punkt für Punkt erfasst werden. Der Ereignisverlauf ist die fachliche Quelle; der aktuelle Stand ist ein daraus erzeugter Snapshot.
- Während einer laufenden Sitzung ersetzt der Liveticker die normale Ergebniseingabe. Der Abschluss erzeugt ohne weitere Bestätigung das offizielle Ergebnis.
- Eine laufende Partie wird saisonübergreifend als „LIVE“ verlinkt. Archivierte Verläufe sind über dauerhafte Partie-URLs aus Spielplan und Spielerprofil erreichbar; ohne Verlauf gibt es keinen Archivlink.
- Liveticker-Übersicht, einzelne Partien und die daraus berechnete Final-Four-Tabelle erscheinen als bildschirmfüllende Detailansicht oberhalb des Liga-Kontexts. Globaler Header und Hauptnavigation bleiben dabei verdeckt; die lokalen Reiter für Übersicht und Partien bleiben sichtbar. Schließen beziehungsweise Browser-Zurück stellt den passenden vorherigen Kontext und dessen Scrollposition wieder her.
- Sobald alle drei Paarungen mit denselben vier Final-Four-Teilnehmern besetzt sind, ist die Detailansicht bereits vor dem ersten Spiel über den Final-Four-Block im Spielplan erreichbar. Der globale LIVE-Einstieg bleibt laufenden Partien vorbehalten.
- Beteiligte Spieler und Admins können ein bestätigtes Konto als Schreiber vorschlagen. Fremde Zuweisungen benötigen Zustimmung; eine Selbstzuweisung gilt unmittelbar. Je Partie existiert höchstens eine offene oder angenommene Zuweisung, die mit dem Start gesperrt wird.
- Punktaktionen sind idempotent und versionsgeschützt. Der letzte Punkt kann während der Partie zurückgenommen werden; Aufschlagkorrekturen und zurückgenommene Ereignisse bleiben intern nachvollziehbar.
- Die Aufschlagreihenfolge wird aus den gewählten ersten Aufschlägern automatisch geführt. Es gilt Golden Point bei Einstand sowie die reguläre Aufschlagfolge im Satz-Tiebreak. Da der Aufschlag dort innerhalb des Tiebreaks wechselt, weist der öffentliche Verlauf dem gesamten Tiebreak keinen einzelnen Aufschläger zu.
- Realtime-Aktualisierung und manuelles Aktualisieren bestehen parallel. Ist eine verlässliche Rekonstruktion nicht möglich, wird die Livesitzung verworfen und das Ergebnis über den normalen Ablauf erfasst.
- Nachträgliche Änderungen sind nur als begründete Adminrevision möglich. Frühere Stände bleiben intern erhalten; öffentlich erscheint ausschließlich der korrigierte Stand mit Kennzeichnung.

## Trainingsspiele

- Trainings sind saisonunabhängig und erscheinen nicht im regulären Spielplan. Sie beeinflussen weder Saisonrangliste noch Elo.
- Ein Training umfasst genau vier Spieler und kann mehrere Abschnitte mit wechselnden Paarungen dieser vier Spieler enthalten.
- Beteiligte Spieler dürfen Trainings anlegen; Admins dürfen dies im administrativen Umfang. Ein anderer Beteiligter bestätigt, macht eine Alternative oder lässt die automatische Bestätigung greifen.
- Unterstützte Formate sind ein Satz, zwei Sätze, zwei Sätze mit Match-Tiebreak und drei Sätze. Teilstände sind zulässig; Lücken zwischen ausgefüllten Abschnitten nicht.
- Vollständigkeit, Ergebnistext und Sieger werden aus strukturierten Counterwerten abgeleitet.
- Jeder vollständig beendete reguläre Satz zählt in Profilen als halbe Partie mit halbem Sieg und halber Niederlage. Unvollständige Sätze bleiben sichtbar, werden aber nicht gewertet.
- Ein vollständig entschiedenes Format mit Match-Tiebreak wird insgesamt als volle Partie mit eindeutigem Sieger gewertet. Match-Tiebreak-Punkte zählen nicht als Games.
- Mehrere Abschnitte eines Trainings und die Sätze eines Final Four werden in Profilen als gemeinsame Gruppe dargestellt. Final-Four-Sätze bleiben offizielle Partien und zählen jeweils als halbe Partie.

## Rechner

- Liga- und Final-Four-Rechner simulieren ausschließlich lokal und verändern keine offiziellen Daten. Beim Saisonwechsel werden Simulationen verworfen; Zurücksetzen stellt bestätigte Ergebnisse wieder her.
- Der Final-Four-Rechner verwendet dieselbe Wertung wie die offizielle Gewinnerermittlung: Siege, Spiel-Differenz, gewonnene Spiele und Ausgangsplatzierung. Einen direkten Vergleich gibt es wegen der wechselnden Teams nicht.
- Ein Gesamtsieger wird erst nach vollständigen gültigen Sätzen ausgewiesen. Bei genau einem offenen Satz können alle regulären Endstände und ihre Auswirkungen angezeigt und übernommen werden.
- Rechner, Ergebnisdialog und Liveticker verwenden gemeinsame Score-Validierung und konsistente Interaktionsmuster.
