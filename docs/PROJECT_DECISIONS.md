# Projektentscheidungen Padel-Liga

Stand: 23. Juli 2026

Diese Datei ist das fortlaufende Projektgedächtnis. Sie beschreibt das aktuell beschlossene Zielbild. Bei neuen oder geänderten Entscheidungen wird sie zusammen mit der jeweiligen Umsetzung aktualisiert.

## Zusammenarbeit

- Der Nutzer arbeitet ausschließlich über Codex und verwendet kein Terminal.
- Codex führt erforderliche und autorisierte technische Befehle selbst aus.
- Der Nutzer wird nur um unvermeidbare Freigaben, Anmeldungen oder fachliche Entscheidungen gebeten.
- Anleitungen an den Nutzer werden ohne vorausgesetzte Terminal- oder Datenbankkenntnisse formuliert.

## Aktueller Umsetzungsstand

- Die projektbezogene Supabase-MCP-Verbindung ist auf dem Entwicklungsrechner in Codex eingetragen und per OAuth autorisiert.
- Die Migration `20260717100000_player_results_training_test_season.sql` wurde am 17. Juli 2026 vollständig und erfolgreich auf die Supabase-Produktionsdatenbank angewendet.
- Die Migration `20260723160000_profile_result_tabs_actual_time.sql` wurde am 23. Juli 2026 vollständig und erfolgreich auf die Supabase-Produktionsdatenbank angewendet. Die neue Ergebnisfunktion mit tatsächlichem Datum und tatsächlicher Uhrzeit ist im Supabase-Schema-Cache verfügbar.
- Die Migration `20260723164500_fix_elo_player_id_ambiguity.sql` wurde am 23. Juli 2026 vollständig und erfolgreich auf die Supabase-Produktionsdatenbank angewendet. Sie behebt die zuvor mehrdeutige Spieler-ID in der Elo-Neuberechnung.
- Die Konten für `Ludi Gmail` und `Ludi GMX` sind jeweils mit ihrer Spieler-ID und der Rolle `player` verbunden.
- Das Konto für `Ludwig W.` ist mit seiner Spieler-ID und der Rolle `admin` verbunden.
- Alle drei zugeordneten E-Mail-Adressen sind bestätigt. Die Test-Saison enthält vier Datenbankspiele, und Row Level Security ist für alle neu angelegten öffentlichen Tabellen aktiviert.

## Saison- und Datenstrategie

- Die laufende Saison 2026 bleibt bis zu ihrem Abschluss in der öffentlichen Ligaansicht dateibasiert. Sie erhält während der laufenden Saison keine neue Ergebniseingabe und kein Tippspiel.
- Die neuen Funktionen werden schon vor Saisonende vollständig mit der temporären Test-Saison erprobt.
- Die nächste reguläre Saison wird von Beginn an datenbankbasiert betrieben.
- Nach Abschluss der Saison 2026 wird deren vollständiger Datenbestand kontrolliert in die Datenbank importiert. Dazu gehören Spielerzuordnungen, Partien, Teams, Sätze, Ergebnisse und Elo-Verläufe.
- Die importierte Saison 2026 wird anschließend als abgeschlossen und schreibgeschützt behandelt. Sie dient Spielerprofilen, Statistiken und historischen Auswertungen.
- Vor dem finalen Import werden Datenbank und Quelldaten gesichert. Ein separates Repository enthält bereits ein vollständiges Backup der Saison 2026.
- Während der Umstellung ist eine kurzzeitige doppelte Datenhaltung als Rückfallmöglichkeit erlaubt. Nach erfolgreichem Vergleich wird die aktive Doppelhaltung entfernt.
- Der finale Import muss Anzahl und Inhalt der Spiele, Satzergebnisse, Tabelle sowie Elo-Endstände und Elo-Verlauf gegen die Quelldaten prüfen.

## Saisonauswahl und Seitenaufteilung

- Die Saisonauswahl steht rechts oben auf Höhe der Eyebrow oberhalb des Loginbereichs.
- Das Tippspiel liegt auf einer eigenen Seite unter `/Padel-Liga/tipp/`.
- Auf der Ligaseite steht neben der Saisonauswahl der Link „Zum Tippspiel“, auf der Tippseite „Zur Liga“.
- Die Tippseite trägt die Überschrift „PADELTIPP“ statt „PADELLIGA“.
- Der frühere Tippspiel-Navigationspunkt wird aus der Ligaseite entfernt.
- Die Tippseite besitzt die Bereiche „Tippen“ und „Tippübersicht“.
- Die Tippübersicht zeigt eine öffentliche Rangliste aller Konten, die mindestens einen Tipp abgegeben haben.
- Für die Saison 2026 wird kein Tippspiel mehr angeboten. Die Test-Saison und spätere datenbankbasierte Saisons verwenden die separate Tippseite.

## Konten, Rollen und Spielerzuordnung

- Es gibt die Rollen `tipper`, `player` und `admin`.
- Neue, nicht vorab zugeordnete Konten erhalten automatisch die Rolle `tipper`.
- Spieler-E-Mail-Adressen werden vorab privat hinterlegt. Meldet sich ein Konto mit einer bestätigten hinterlegten Adresse an, wird es mit der eindeutigen Spieler-ID verbunden und erhält die vorgesehene Spieler- oder Adminrolle.
- E-Mail-Adressen beziehungsweise deren Zuordnung werden nicht öffentlich ausgeliefert. Die Allowlist wird in der Datenbank über E-Mail-Hashes geführt.
- Der Name eines verbundenen Spielerprofils kommt aus dem zentralen Spielerdatensatz und kann vom Konto nicht geändert werden.
- Ein zunächst als Tipper angelegtes Konto kann später administrativ einem Spieler zugeordnet und zur Spielerrolle geändert werden.
- Künftig werden Registrierungen auf erlaubte E-Mail-Domains begrenzt. Die konkrete Domainliste wird später festgelegt. Vorab freigegebene Spieleradressen bleiben als gezielte Ausnahmen möglich.
- Nach dem Login wird die verbundene Spieler-ID automatisch als aktiver Spieler in der Spielerauswahl der Liga gesetzt, sofern der Spieler an der ausgewählten Saison teilnimmt. Die Auswahl bleibt danach frei bedienbar, damit auch andere Spieler hervorgehoben und betrachtet werden können.
- Ein Admin mit eigenem Spielerprofil wird ebenfalls automatisch als dieser Spieler ausgewählt. Adminfunktionen bleiben davon getrennt.
- Die Datenbank prüft Berechtigungen immer anhand des angemeldeten Kontos und seiner Spieler-ID; die sichtbare Auswahl allein ist keine Sicherheitsgrenze.

## Ligaergebnisse und Bestätigung

- Spieler können keine Ligaspiele erstellen. Ligaspiele werden vorab im Spielplan angelegt.
- Ein beteiligter Spieler kann zu einem Ligaspiel ein Ergebnis samt tatsächlich gespieltem Datum und tatsächlicher Uhrzeit vorschlagen. Der tatsächliche Termin darf nicht in der Zukunft liegen und darf vom ursprünglich geplanten Termin abweichen.
- Nach der Bestätigung werden das vorgeschlagene Datum und die vorgeschlagene Uhrzeit zusammen mit dem Ergebnis zum offiziellen, öffentlich angezeigten Spieltermin.
- Zukünftig geplante Partien zählen nicht als offene Spiele. Sie bleiben unter „Alle Spiele“ sichtbar und können dort erfasst werden, falls sie abweichend vom Plan bereits gespielt wurden.
- Ein einziger beteiligter Spieler eines Teams reicht zum Eintragen beziehungsweise Bearbeiten eines Vorschlags aus.
- Ein Spieler des anderen Teams kann den Vorschlag bestätigen oder einen Gegenvorschlag machen. Eine reine Ablehnung gibt es nicht.
- Ein Gegenvorschlag umfasst Ergebnis, tatsächliches Datum und tatsächliche Uhrzeit und geht an das jeweils andere Team zurück. Der Austausch kann fortgesetzt werden, bis ein Team den letzten Vorschlag des anderen Teams bestätigt.
- Ein vom Admin eingetragenes Ergebnis ist sofort gültig und benötigt keine Bestätigung.
- Hat ein Admin lediglich als normal beteiligter Spieler eingetragen, gelten die bewusst gewählten administrativen beziehungsweise normalen Aktionen getrennt.
- Unbestätigte Vorschläge und ihr Status erscheinen nicht öffentlich an der Partie. Offene Aufgaben stehen im Konto-Dialog.
- Nach einer Bestätigung wird das offizielle Ergebnis gespeichert, die Rangliste aktualisiert und die Elo-Berechnung ausgeführt.

## Elo

- Elo wird nur für bestätigte Ligaspiele berechnet, auch wenn das Ergebnis über den Seitenlogin eingetragen wurde.
- Trainingsspiele verändern kein Elo.
- Unter einem bestätigten Ligaergebnis werden die berechneten Elo-Veränderungen schreibgeschützt angezeigt.
- Für jeden Spieler und jedes gewertete Spiel sollen Elo vor dem Spiel, Veränderung und Elo nach dem Spiel nachvollziehbar gespeichert werden.
- Zusätzlich soll die verwendete Version der Elo-Berechnung festgehalten werden, damit spätere Neuberechnungen und Vergleiche möglich bleiben.
- Beim späteren Import von 2026 werden die vorhandenen Werte zunächst unverändert übernommen und anschließend durch eine Neuberechnung kontrolliert.

## Tippspiel

- Tipps beziehen sich auf das Satzergebnis einer realen Ligapartie, nicht auf selbst eingetragene Spielergebnisse.
- Ein Tipp kann bis zur tatsächlich hinterlegten Startzeit der Partie abgegeben oder geändert werden. Das Eintragen eines Ergebnisses ist nicht der Schließzeitpunkt.
- Wertung: 4 Punkte für das exakte Satzergebnis, 2 Punkte für den richtigen Sieger bei anderem Satzergebnis, 0 Punkte für den falschen Sieger.
- Die Tippübersicht bleibt öffentlich sichtbar.
- Eine Partie mit nachträglich geändertem offiziellen Ergebnis muss für die Tippspielauswertung den bestätigten offiziellen Stand verwenden.

## Trainingsspiele

- Trainingsspiele sind saisonunabhängig und erscheinen nicht im regulären Saisonspielplan.
- Jeder angemeldete Spieler darf ein Training anlegen, wenn er selbst zu den vier Beteiligten gehört. Ein Admin darf dies im administrativen Rahmen ebenfalls.
- Ein Training enthält genau vier Spieler. Werden andere Spieler eingesetzt, ist es ein neues Training.
- Innerhalb einer Trainingskarte dürfen mehrere Spielabschnitte mit unterschiedlichen Paarungen derselben vier Spieler stehen.
- Jeder Spielabschnitt enthält einen oder zwei tatsächlich gespielte Sätze. Auch ein Zwischenstand von 1:1 ist als tatsächliches Trainingsergebnis zulässig.
- Datum, tatsächliche Uhrzeit und Ergebnisse werden beim Anlegen erfasst.
- Ein anderer beteiligter Spieler muss das Training bestätigen. Der Ersteller kann nicht selbst bestätigen.
- Trainingsspiele werden über den Konto-Dialog hinzugefügt und verwaltet.

## Konto-Dialog und Aufgaben

- Nach dem Login zeigt der Konto-Button im Seitenkopf ein User-Icon statt des Anzeigenamens. Der Name bleibt im Konto-Dialog sichtbar; offene Aufgaben werden weiterhin als Badge am Icon angezeigt.
- Der Konto-Dialog besitzt die Tabs „Spiele“ und „Einstellungen“.
- Nach dem Senden oder Bestätigen eines Ergebnisses bleibt der Konto-Dialog geöffnet und aktualisiert seine Aufgaben direkt.
- Im Tab „Spiele“ erscheinen offene Ligaergebnisse, zu bestätigende oder zu beantwortende Vorschläge und offene Trainingsbestätigungen.
- Die Ligaergebnisse lassen sich zwischen „Offen“ und „Alle Spiele“ umschalten. „Offen“ enthält keine rein zukünftig geplanten Partien; „Alle Spiele“ enthält auch geplante und bereits bestätigte Partien der ausgewählten Saison.
- Trainingsspiele werden ebenfalls im Tab „Spiele“ angelegt.
- Der Tab „Einstellungen“ enthält den Logout. Nur reine Tipper können dort ihren Anzeigenamen ändern; Namen verbundener Spielerprofile bleiben zentral gepflegt.
- Der öffentliche Spielplan zeigt keinen internen Bestätigungsstatus.

## Temporäre Test-Saison

- Es gibt eine öffentlich sichtbare Test-Saison mit vier Testspielen.
- Die Testprofile `Ludi GMX` und `Ludi Gmail` sind über vorab hinterlegte Konten zugeordnet; `Ludwig W.` besitzt ein Spielerprofil mit Adminrolle.
- In jedem der vier Testspiele steht mindestens eines der beiden speziellen Testprofile einem der anderen Testprofile beziehungsweise dem Adminprofil im gegnerischen Team gegenüber.
- Die übrigen Plätze werden mit Spielern aus der normalen Spielerliste besetzt.
- Testdaten dürfen zurückgesetzt und nach erfolgreichen Tests vollständig gelöscht werden.
- Die Test-Saison dient insbesondere den Rollen-, Ergebnis-, Gegenvorschlags-, Bestätigungs-, Elo-, Tipp- und Trainingsabläufen.

## Zukünftige Spielerprofile

- Für jeden einzelnen Spieler soll ein Profil mit allen vergangenen Spielen entstehen.
- Historische Spiele müssen über stabile Spieler-IDs statt nur über Anzeigenamen mit dem Profil verbunden sein.
- Vorgesehene Auswertungen sind unter anderem Spiele, Partner, Gegner, Siege, Niederlagen, Satzbilanz, Elo-Verlauf, häufigste Partner und direkte Vergleiche.
- Die historischen Daten der Saison 2026 werden deshalb nach Saisonende in die Datenbank übernommen und nicht dauerhaft nur in statischen Dateien belassen.

## Noch nicht abschließend festgelegt

- Die erlaubten E-Mail-Domains.
- Der genaue Umfang zukünftiger Adminfunktionen über die bereits beschlossene direkte Ergebniseingabe hinaus.
- Der endgültige Spielmodus und Spielplan der nächsten regulären Saison.
