# Projektentscheidungen Padel-Liga

Stand: 3. September 2026

Diese Datei ist das fortlaufende Projektgedächtnis. Sie beschreibt das aktuell beschlossene Zielbild. Bei neuen oder geänderten Entscheidungen wird sie zusammen mit der jeweiligen Umsetzung aktualisiert.

## Zusammenarbeit

- Der Nutzer arbeitet ausschließlich über Codex und verwendet kein Terminal.
- Codex führt erforderliche und autorisierte technische Befehle selbst aus.
- Der Nutzer wird nur um unvermeidbare Freigaben, Anmeldungen oder fachliche Entscheidungen gebeten.
- Anleitungen an den Nutzer werden ohne vorausgesetzte Terminal- oder Datenbankkenntnisse formuliert.
- Supabase-Datenbankzugriffe erfolgen über eine projektgebundene MCP-Verbindung. Der dafür notwendige persönliche Zugriffsschlüssel liegt ausschließlich in der lokalen, nur für den Benutzer lesbaren Datei `.codex-secrets/supabase-access-token`. Das Verzeichnis ist durch `.gitignore` von der Versionierung ausgeschlossen; der Schlüssel wird weder im Repository noch in Codex-Aufgaben hinterlegt.
- Schreibende Supabase-Aktionen bleiben einzeln freigabepflichtig. Einmalige OAuth-Helfer und der Supabase-Browser sind kein Ersatz für die projektgebundene Verbindung.

## Aktueller Umsetzungsstand

- Die Migration `20260903120000_weighted_training_profile_matches.sql` wurde am 3. September 2026 vollständig und erfolgreich auf die Supabase-Produktionsdatenbank angewendet. Ein-Satz-Trainings werden in öffentlichen Profilen mit `0,5`, Trainings ab zwei regulären Sätzen und sämtliche offiziellen Liga-/Turnierpartien mit `1` gewichtet; Tiebreaks erhöhen die Gewichtung nicht.
- Die Migration `20260903110000_schedule_matches.sql` wurde am 3. September 2026 vollständig und erfolgreich auf die Supabase-Produktionsdatenbank angewendet. Beteiligte Spieler und Admins können noch nicht terminierte Partien nun unmittelbar mit Datum und Uhrzeit terminieren; anonyme Konten besitzen keinen Zugriff auf diese Funktion.
- Die Migration `20260903100000_unset_test_match_schedule.sql` wurde am 3. September 2026 vollständig und erfolgreich auf die Supabase-Produktionsdatenbank angewendet. Die Partien 7, 9 und 10 der Test-Saison bleiben mit ihren Mannschaften und Spieltagen bestehen, besitzen aber kein Datum, keine Uhrzeit und keinen daraus abgeleiteten Sperrzeitpunkt mehr.
- Die Migration `20260902120000_season_tournament_automation.sql` wurde am 2. September 2026 vollständig und erfolgreich auf die Supabase-Produktionsdatenbank angewendet. „Sommer 2026“ ist wieder die aktive Standardsaison und für Ergebniseingaben freigeschaltet; „Winter 2026“ bleibt auswählbar. Die saisonabhängige Turnierfortschreibung, Formatprüfung, Elo-Erweiterung, Tippspielwertung und automatische Auszeichnungsvergabe sind live.
- Die Migration `20260902100000_winter_2026_season.sql` wurde am 2. September 2026 vollständig und erfolgreich auf die Supabase-Produktionsdatenbank angewendet. Die zehn bestätigten Winter-Teilnehmer werden mit ihren übernommenen Sommer-End-Elo-Werten öffentlich ausgeliefert. Die zunächst durch diese Migration gesetzte Winter-Standardsaison wurde mit `20260902120000_season_tournament_automation.sql` planmäßig wieder durch Sommer 2026 ersetzt.
- Die Migration `20260902110000_add_test_result_matches.sql` wurde am 2. September 2026 vollständig und erfolgreich auf die Supabase-Produktionsdatenbank angewendet. Die Test-Saison enthält seitdem zehn Partien. Die ursprünglich für die Partien 7, 9 und 10 eingetragenen Termine wurden am 3. September wieder entfernt; Ludi GMX und Ludi Gmail stehen sich in allen sechs ergänzten Partien jeweils als Gegner gegenüber.
- Die projektbezogene Supabase-MCP-Verbindung ist im Repository vorbereitet. Sie verwendet wegen der derzeit fehlerhaften OAuth-Erkennung der installierten Codex-Version einen lokal geschützten persönlichen Zugriffsschlüssel.
- Die Migration `20260717100000_player_results_training_test_season.sql` wurde am 17. Juli 2026 vollständig und erfolgreich auf die Supabase-Produktionsdatenbank angewendet.
- Die Migration `20260723160000_profile_result_tabs_actual_time.sql` wurde am 23. Juli 2026 vollständig und erfolgreich auf die Supabase-Produktionsdatenbank angewendet. Die neue Ergebnisfunktion mit tatsächlichem Datum und tatsächlicher Uhrzeit ist im Supabase-Schema-Cache verfügbar.
- Die Migration `20260723164500_fix_elo_player_id_ambiguity.sql` wurde am 23. Juli 2026 vollständig und erfolgreich auf die Supabase-Produktionsdatenbank angewendet. Sie behebt die zuvor mehrdeutige Spieler-ID in der Elo-Neuberechnung.
- Die Migration `20260723173000_account_games_email_names.sql` wurde am 23. Juli 2026 vollständig und erfolgreich auf die Supabase-Produktionsdatenbank angewendet. Die E-Mail-abgeleiteten Kontonamen, ligaübergreifenden Aufgaben, automatisch geprüften Satzbilanzen und Trainingsnummern sind aktiv.
- Die Migration `20260901130000_public_player_profiles.sql` wurde am 1. September 2026 vollständig und erfolgreich auf die Supabase-Produktionsdatenbank angewendet. Öffentliche Profildaten, Saisonfunktionen, Auszeichnungen und die anonym lesbaren RPCs sind aktiv.
- Die Migration `20260901131000_import_2026_profile_history.sql` wurde am 1. September 2026 vollständig und erfolgreich auf die Supabase-Produktionsdatenbank angewendet. Der geprüfte Bestand von „Sommer 2026“ umfasst 18 Teilnehmer, 30 Partien, 22 Ergebnisse, 108 Spielerzuordnungen und 88 Elo-Änderungen.
- Die Migration `20260901132000_sommer_2026_final_four_achievements.sql` wurde am 1. September 2026 angewendet. Ihre verfrühten Final-Four-Auszeichnungen für Luca W. und Marco M. wurden am 2. September 2026 durch `20260902120000_season_tournament_automation.sql` entfernt; künftig entstehen sie erst automatisch nach feststehender Qualifikation.
- Die Migration `20260901133000_sommer_2026_marcel_winner_achievement.sql` wurde am 1. September 2026 angewendet. Die verfrühte Gewinner-Auszeichnung für Marcel M. wurde am 2. September 2026 durch `20260902120000_season_tournament_automation.sql` entfernt; künftig entsteht die Gewinner-Auszeichnung erst automatisch nach allen drei Final-Four-Sätzen.
- Die Migration `20260901140000_incomplete_training_rounds.sql` wurde am 1. September 2026 vollständig und erfolgreich auf die Supabase-Produktionsdatenbank angewendet. Abgebrochene Trainingsrunden und bis zu drei Ergebnisabschnitte je Runde sind aktiv; abgebrochene Runden bleiben aus den Profilstatistiken ausgeschlossen.
- Die Migration `20260901141000_import_historical_training_sessions.sql` wurde am 1. September 2026 vollständig und erfolgreich auf die Supabase-Produktionsdatenbank angewendet. Fünf historische Trainingseinheiten mit sieben Runden wurden geprüft importiert; das abgebrochene 3:1 vom 13. August 2026 ist sichtbar, aber ohne Wertung.
- Die Konten für `Ludi Gmail` und `Ludi GMX` sind jeweils mit ihrer Spieler-ID und der Rolle `player` verbunden.
- Das Konto für `Ludwig W.` ist mit seiner Spieler-ID und der Rolle `admin` verbunden.
- Alle drei zugeordneten E-Mail-Adressen sind bestätigt. Die Test-Saison enthält zehn Datenbankspiele, und Row Level Security ist für alle neu angelegten öffentlichen Tabellen aktiviert.

## Saison- und Datenstrategie

- Die reguläre Nachfolgesaison von „Sommer 2026“ heißt „Winter 2026“, verwendet die stabile Saison-ID `winter-2026` und beginnt technisch am gemeinsamen Saisonübergang 1. Oktober 2026.
- „Sommer 2026“ bleibt bis zum Abschluss ihrer fünf offenen Ligapartien und des Final Four die aktive Standardsaison. „Winter 2026“ ist bereits auswählbar und vorbereitet, wird aber erst nach dem Sommerabschluss zur Standardsaison.
- Für „Winter 2026“ stehen zunächst Marcel M., Chris M., Luca W., Marco M., Ludwig W., Greta P., Agnes K., Niklas K., Andreas L. und Jonas L. fest. Weitere Teilnehmer und der Spielplan folgen.
- Die Start-Elo-Werte dieser Teilnehmer entsprechen ihren letzten offiziellen Elo-Werten aus „Sommer 2026“. Bis zum ersten Winter-Ligaspiel werden sie mit null Partien und null Punkten in der Winter-Rangliste angezeigt.
- Die stabile technische Saison-ID von „Sommer 2026“ bleibt `2026`. Ihr Spielplan ist vollständig; die Partien 10, 19, 22, 23 und 27 sowie das Final Four sind noch offen.
- Die Datenbank ist die aktive Quelle für strukturierte Spieler-, Saison-, Match-, Ergebnis- und Elo-Daten. Die Sommer-Saisondatei bleibt als kontrollierter Fallback sowie für die weiterhin repositorybasierten redaktionellen Inhalte erhalten.
- Editoriale Saisonartikel bleiben Inhalte des Git-Repositorys und werden nicht in die Sportdatenbank verschoben.
- Der vollständige Sommer-Datenbestand aus Spielerzuordnungen, Partien, Teams, Sätzen, Ergebnissen und Elo-Verläufen wurde gegen die Quelldaten geprüft importiert. Ein separates Repository enthält weiterhin das vollständige Saison-Backup.

## Saisonauswahl und Seitenaufteilung

- Der Hinweis „Jetzt auch als App!“ auf der Startseite kann über ein X im Kasten für den aktuellen Browser-Tab geschlossen werden. Er bleibt bei Reloads innerhalb dieses Tabs ausgeblendet und erscheint nach dem Schließen des Tabs beim nächsten Besuch wieder.
- Gibt es für den aktuellen Zeitraum noch keinen veröffentlichten Artikel, zeigt die Startseite weiterhin den zeitlich jüngsten bereits veröffentlichten Artikel. Unveröffentlichte Artikelplatzhalter werden dabei nicht angezeigt.
- Die Saisonauswahl steht rechts oben auf Höhe der Eyebrow oberhalb des Loginbereichs.
- Saison- und Spielerauswahl verwenden die zentrale Gestaltung für sekundäre Buttons. Ein gemeinsamer Dropdown-Modifier ergänzt ausschließlich Chevron, den geöffneten Zustand und den dafür notwendigen Innenabstand; nur die responsive Breite richtet sich nach dem jeweiligen Inhalt und Platzbedarf.
- Das Tippspiel liegt auf einer eigenen Seite unter `/Padel-Liga/tipp/`.
- Auf der Ligaseite steht neben der Saisonauswahl der Link „Zum Tippspiel“, auf der Tippseite „Zur Liga“.
- Die Tippseite trägt die Überschrift „PADELTIPP“ statt „PADELLIGA“.
- Der frühere Tippspiel-Navigationspunkt wird aus der Ligaseite entfernt.
- Die Tippseite besitzt die Bereiche „Tippen“ und „Tippübersicht“.
- Die Tippübersicht zeigt eine öffentliche Rangliste aller Konten, die mindestens einen Tipp abgegeben haben.
- Für die Saison „Sommer 2026“ wird kein Tippspiel mehr angeboten. Die Test-Saison und spätere datenbankbasierte Saisons verwenden die separate Tippseite.

## Konten, Rollen und Spielerzuordnung

- Es gibt die Rollen `tipper`, `player` und `admin`.
- Neue, nicht vorab zugeordnete Konten erhalten automatisch die Rolle `tipper`.
- Spieler-E-Mail-Adressen werden vorab privat hinterlegt. Meldet sich ein Konto mit einer bestätigten hinterlegten Adresse an, wird es mit der eindeutigen Spieler-ID verbunden und erhält die vorgesehene Spieler- oder Adminrolle.
- E-Mail-Adressen beziehungsweise deren Zuordnung werden nicht öffentlich ausgeliefert. Die Allowlist wird in der Datenbank über E-Mail-Hashes geführt.
- Der im Konto und im Tippspiel verwendete Kontoname wird ausschließlich aus dem lokalen Teil der E-Mail-Adresse gebildet. Für Adressen nach dem Muster `vorname.nachname@…` lautet er `Vorname N`; er kann vom Konto nicht geändert werden. Die zentralen Spielernamen bleiben unabhängig davon für Mannschaften und Spielerstatistiken bestehen.
- Ein zunächst als Tipper angelegtes Konto kann später administrativ einem Spieler zugeordnet und zur Spielerrolle geändert werden.
- Künftig werden Registrierungen auf erlaubte E-Mail-Domains begrenzt. Die konkrete Domainliste wird später festgelegt. Vorab freigegebene Spieleradressen bleiben als gezielte Ausnahmen möglich.
- Nach dem Login wird die verbundene Spieler-ID automatisch als aktiver Spieler in der Spielerauswahl der Liga gesetzt, sofern der Spieler an der ausgewählten Saison teilnimmt. Die Auswahl bleibt danach frei bedienbar, damit auch andere Spieler hervorgehoben und betrachtet werden können.
- Ein Admin mit eigenem Spielerprofil wird ebenfalls automatisch als dieser Spieler ausgewählt. Adminfunktionen bleiben davon getrennt.
- Die Datenbank prüft Berechtigungen immer anhand des angemeldeten Kontos und seiner Spieler-ID; die sichtbare Auswahl allein ist keine Sicherheitsgrenze.

## Ligaergebnisse und Bestätigung

- Die öffentliche Partienübersicht ist standardmäßig nach Spieltagen gruppiert und kann alternativ chronologisch nach Datum gruppiert werden. Partien ohne vollständiges Datum und Uhrzeit gelten dort als offen und stehen in der Datumsansicht gesammelt am Ende.
- Spieler können keine Ligaspiele erstellen. Ligaspiele werden vorab im Spielplan angelegt.
- Eine noch nicht terminierte Partie kann von jedem beteiligten Spieler oder einem Admin ohne Gegenbestätigung mit Datum und Uhrzeit terminiert werden. Dabei sind auch vergangene Termine zulässig. Datum, Uhrzeit und Sperrzeitpunkt werden gemeinsam gespeichert; bereits terminierte oder abgeschlossene Partien sowie Partien mit offenem Ergebnisvorschlag können auf diesem Weg nicht verändert werden.
- Ein beteiligter Spieler kann zu einem Ligaspiel ein Ergebnis samt tatsächlich gespieltem Datum und tatsächlicher Uhrzeit vorschlagen. Der tatsächliche Termin darf nicht in der Zukunft liegen und darf vom ursprünglich geplanten Termin abweichen.
- Datum und Uhrzeit der Ergebniseingabe sind mit den vorhandenen Spieldaten vorausgefüllt.
- Die genauen Ergebnisse werden über gleich große Satz-Counter eingegeben. Reguläre Sätze enden ausschließlich mit 6:0 bis 6:4, 7:5 oder 7:6. Bei 7:6 beziehungsweise 6:7 ist der zugehörige Satz-Tiebreak verpflichtend und wird als Klammerwert gespeichert; bei 1:1 entscheidet ein Match-Tiebreak. Satz- und Match-Tiebreaks werden bis sieben beziehungsweise zehn und danach mit exakt zwei Punkten Abstand gespielt. Satzbilanz und Sieger werden automatisch berechnet und von der Datenbank nochmals geprüft; eine getrennte manuelle Satzbilanz gibt es nicht.
- Nach der Bestätigung werden das vorgeschlagene Datum und die vorgeschlagene Uhrzeit zusammen mit dem Ergebnis zum offiziellen, öffentlich angezeigten Spieltermin.
- Zukünftig geplante Partien zählen nicht als offene Spiele. Sie bleiben unter „Alle Spiele“ sichtbar und können dort erfasst werden, falls sie abweichend vom Plan bereits gespielt wurden.
- Ein einziger beteiligter Spieler eines Teams reicht zum Eintragen beziehungsweise Bearbeiten eines Vorschlags aus.
- Ein Spieler des anderen Teams kann den Vorschlag bestätigen oder einen Gegenvorschlag machen. Eine reine Ablehnung gibt es nicht.
- Ein Gegenvorschlag umfasst Ergebnis, tatsächliches Datum und tatsächliche Uhrzeit und geht an das jeweils andere Team zurück. Der Austausch kann fortgesetzt werden, bis ein Team den letzten Vorschlag des anderen Teams bestätigt.
- Ein vom Admin eingetragenes Ergebnis ist sofort gültig und benötigt keine Bestätigung.
- Hat ein Admin lediglich als normal beteiligter Spieler eingetragen, gelten die bewusst gewählten administrativen beziehungsweise normalen Aktionen getrennt.
- Unbestätigte Vorschläge und ihr Status erscheinen nicht öffentlich an der Partie. Offene Aufgaben stehen im Konto-Dialog.
- Nach einer Bestätigung wird das offizielle Ergebnis gespeichert, die Rangliste aktualisiert und die Elo-Berechnung ausgeführt.
- Der Spielmodus ist saisonabhängig. Reguläre Ligapartien, Halbfinals und Final Four werden als getrennte Partienphasen gespeichert; Turnierpartien verändern die abgeschlossene Liga-Rangliste nicht.
- Sommer 2026 verwendet den direkten Top-4-Einzug. Nach der letzten bestätigten Ligapartie setzt die Datenbank die endgültigen Top 4 automatisch in die drei bestehenden Final-Four-Paarungen ein.
- Winter 2026 verwendet den Top-8-Modus. Nach vollständigem Spielplan und letzter bestätigter Ligapartie werden Platz 1 und 2 gegen 7 und 8 sowie Platz 3 und 4 gegen 5 und 6 gesetzt. Nach beiden Halbfinals werden die vier Sieger nach ursprünglicher Ligaplatzierung geordnet und in die drei wechselnden Final-Four-Paarungen übernommen.
- Die automatische Turnierfortschreibung ist idempotent und überschreibt keine Folgerunde mit vorhandenen Ergebnissen, Vorschlägen oder Tipps. Notfallkorrekturen erfolgen kontrolliert über Codex statt über eine eigene Adminoberfläche.

## Elo

- Elo wird für bestätigte reguläre Liga-, Halbfinal- und Final-Four-Partien berechnet, auch wenn das Ergebnis über den Seitenlogin eingetragen wurde. Nur reguläre Ligapartien verändern die Ligapunkte.
- Trainingsspiele verändern kein Elo.
- Die Y-Achse der Elo-Verlaufsgrafik beginnt bei 500; die Grafik ist 620 Pixel hoch.
- Die Punkte der Elo-Verlaufsgrafik haben für den aktiven Spieler 4 Pixel Radius und für die übrigen Spieler 3 Pixel Radius; beim Hover verwenden sie 5 Pixel Radius.
- Die Elo-Verlaufsgrafik der Saison „Sommer 2026“ ergänzt am 1. Oktober 2026 einen gemeinsamen Punkt „Final“ ausschließlich für Spieler mit mindestens sechs gewerteten Spielen. Dieser Punkt wiederholt den Elo-Wert nach dem jeweils letzten Spiel, damit die Linien dieser Spieler bis zum gemeinsamen Saisonendpunkt reichen; der Endpunkt selbst verändert das Elo nicht. Die Verbindung vom letzten Spiel zum Final-Punkt verläuft gerade, während die Verbindungen zwischen den tatsächlichen Spielwerten geglättet bleiben. Bei Spielern mit weniger als sechs Spielen endet die Linie weiterhin beim letzten tatsächlich gespielten Match.
- In der Grafik „Platzierungen nach Spieltag“ kennzeichnet ein ausgefüllter Kreis eine gespielte Partie, ein hohler Kreis mit transparenter Fläche in der jeweiligen Spielerfarbe einen spielfreien Spieler und ein fehlendes Symbol eine angesetzte, aber noch nicht gespielte Partie. Die Linie bleibt an spielfreien Spieltagen grau. Der aktive Spieler verwendet für gespielte Partien 4 Pixel Punkt-Radius, die übrigen Spieler 3 Pixel; beide wachsen beim Hover auf 5 Pixel. Der spielfreie Kreis hat 3 Pixel Radius und keinen Hover-Effekt.
- Elo-Veränderungen werden nicht in der Ergebnisübersicht angezeigt. Sie bleiben intern nachvollziehbar gespeichert und fließen weiterhin in Rangliste und Saisonverlauf ein.
- Für jeden Spieler und jedes gewertete Spiel sollen Elo vor dem Spiel, Veränderung und Elo nach dem Spiel nachvollziehbar gespeichert werden.
- Zusätzlich soll die verwendete Version der Elo-Berechnung festgehalten werden, damit spätere Neuberechnungen und Vergleiche möglich bleiben.
- Die Elo-Historie von „Sommer 2026“ wird mit sämtlichen Vorher-/Nachher-Werten 1:1 aus `data/data2026.js` übernommen. Eine Neuberechnung darf ausschließlich als Vergleich dienen und die importierten Referenzwerte nicht überschreiben. Nach dem Import wurde die Übereinstimmung aller 88 Elo-Änderungen ohne Abweichung geprüft.

## Tippspiel

- Tipps beziehen sich auf das Satzergebnis einer realen Ligapartie, nicht auf selbst eingetragene Spielergebnisse.
- Noch nicht terminierte reguläre Ligapartien bleiben tippbar, sofern ihr allgemeiner Tippstatus geöffnet ist. Sobald sie terminiert werden, schließt der daraus abgeleitete Sperrzeitpunkt die Tippabgabe zum angesetzten Spielbeginn beziehungsweise bei einem vergangenen Termin sofort.
- Ein Tipp kann bis zur tatsächlich hinterlegten Startzeit der Partie abgegeben oder geändert werden. Das Eintragen eines Ergebnisses ist nicht der Schließzeitpunkt.
- Wertung: 4 Punkte für das exakte Satzergebnis, 2 Punkte für den richtigen Sieger bei anderem Satzergebnis, 0 Punkte für den falschen Sieger.
- Die Tippübersicht bleibt öffentlich sichtbar.
- Eine Partie mit nachträglich geändertem offiziellen Ergebnis muss für die Tippspielauswertung den bestätigten offiziellen Stand verwenden.
- Winter-Halbfinals werden wie reguläre Partien auf das Satzergebnis getippt. Für einen Final-Four-Satz wird der genaue Satzspielstand getippt; vier Punkte gibt es exakt, zwei für den richtigen Sieger und null für den falschen Sieger.
- Ein Turnierspiel wird erst tippbar, wenn echte Teilnehmer sowie ein vollständiger Termin feststehen. Sommer 2026 bleibt ohne Tippspiel.

## Trainingsspiele

- Trainingsspiele sind saisonunabhängig und erscheinen nicht im regulären Saisonspielplan.
- Jeder angemeldete Spieler darf ein Training anlegen, wenn er selbst zu den vier Beteiligten gehört. Ein Admin darf dies im administrativen Rahmen ebenfalls.
- Ein Training enthält genau vier Spieler. Werden andere Spieler eingesetzt, ist es ein neues Training.
- Innerhalb einer Trainingskarte dürfen mehrere Spielabschnitte mit unterschiedlichen Paarungen derselben vier Spieler stehen.
- Jeder Spielabschnitt enthält einen bis drei tatsächlich gespielte Ergebnisabschnitte. Dazu gehören einzelne Sätze, vollständige Zwei- oder Drei-Satz-Partien sowie genau zwei Sätze mit anschließendem Match-Tiebreak. Drei reguläre Sätze und zwei Sätze mit Match-Tiebreak sind getrennte Ergebnisformate; ein dritter Ergebnisabschnitt ist nur beim Satzstand 1:1 möglich. Auch ein Zwischenstand von 1:1 ist als tatsächliches Trainingsergebnis zulässig. Ein wegen Zeitmangels oder aus einem anderen Grund nicht beendeter Satz wird als „abgebrochen“ erfasst und bleibt ohne Wertung.
- Datum, tatsächliche Uhrzeit und Ergebnisse werden beim Anlegen erfasst.
- Ein anderer beteiligter Spieler muss das Training bestätigen. Der Ersteller kann nicht selbst bestätigen.
- Trainingsspiele werden über den Konto-Dialog hinzugefügt und verwaltet.
- Trainings werden nach ihrem Erstellungszeitpunkt fortlaufend als „Training X“ nummeriert. Im Konto erscheinen nur offene Trainings; bestätigte Trainings werden dort nicht mehr angezeigt.
- Jede bestätigte und vollständig beendete Trainingsrunde mit genau einem regulären Satz zählt in öffentlichen Spielerprofilen als `0,5` Partie; ab zwei regulären Sätzen zählt sie als eine ganze Partie. Match-Tiebreaks und Satz-Tiebreak-Punkte werden für diese Gewichtung nicht als zusätzlicher Satz berücksichtigt. Die Gewichtung gilt konsistent für All-Time-Partien, Siege/Niederlagen sowie Mitspieler-/Gegnerauswertungen. Reguläre Liga-, Halbfinal- und Final-Four-Partien zählen unabhängig von ihrem Format immer als eine ganze Partie. Abgebrochene Runden bleiben im Partienverlauf sichtbar, zählen aber weder für Partien, Siege/Niederlagen, Spiele, Spieldifferenz noch für Mitspieler-/Gegnerauswertungen.
- Eine bestätigte Trainingsrunde mit ausgeglichener Satzbilanz zählt weder als Sieg noch als Niederlage. Deshalb dürfen Siege plus Niederlagen kleiner als die All-Time-Partienzahl sein.
- Trainings bleiben trotz ihrer Profilwertung ohne Einfluss auf Saisonrangliste und Elo.
- Mehrere Runden desselben Trainings werden im Spielerprofil als kompakte Gruppe dargestellt. Das Datum erscheint nur an der ersten Runde, die Kennzeichnung „Training“ nur an der letzten; jede Runde behält ihren eigenen Ergebniskreis und Spielstand. Abgebrochene Spielstände erscheinen kursiv und abgedimmt mit einem neutralen, gestrichelten Ergebniskreis.

## Konto-Dialog und Aufgaben

- Nach dem Login zeigt der sekundär gestaltete Button für die Spieleübersicht im Seitenkopf ein User-Icon statt des Anzeigenamens. Der Name bleibt im Konto-Dialog sichtbar; offene Aufgaben werden weiterhin als gelber Badge mit schwarzer Zahl am Icon angezeigt.
- Der Konto-Dialog besitzt keine Tabnavigation mehr. Unter der gemeinsamen Überschrift „Spieleübersicht“ stehen immer die vier Bereiche „Zu bestätigen“, „Ergebnis eintragen“, „Terminierte Spiele“ und „Geplante Spiele“; jeder leere Bereich zeigt „Derzeit keine Partie.“. Der Logout steht im Kopf des Dialogs auf Höhe des Kontonamens.
- Nach dem Senden oder Bestätigen eines Ergebnisses bleibt der Konto-Dialog geöffnet und aktualisiert seine Aufgaben direkt.
- In der Spieleübersicht erscheinen Ligaaufgaben und offene Trainings liga- und saisonübergreifend. Für normale Spieler werden Liga- und Trainingsspiele ausschließlich berücksichtigt, wenn die Spieler-ID des aktiven Kontos selbst beteiligt ist. Admins sehen dagegen weiterhin sämtliche noch nicht abgeschlossenen Ligaspiele und offenen Trainingsspiele im administrativen Umfang. Reine Tippkonten behalten ihren kurzen Hinweis und sehen die vier Aufgabenbereiche nicht.
- „Zu bestätigen“ enthält fremde Liga-Ergebnisvorschläge, offene Trainingsbestätigungen sowie eigene noch wartende Liga- und Trainingsvorschläge. Fremde Vorschläge sind aktiv; eigene Vorschläge erscheinen abgedimmt mit „Auf Bestätigung warten“. Eigene wartende Trainings bleiben bis zur Bestätigung bearbeitbar und löschbar. Danach folgen bereits fällige Ligapartien unter „Ergebnis eintragen“, zukünftige terminierte Partien unter „Terminierte Spiele“ und Partien ohne vollständigen Termin unter „Geplante Spiele“. Innerhalb jeder Gruppe stehen die Partien chronologisch beziehungsweise geplante Partien nach Spieltag und Partienummer.
- Geplante Partien zeigen Datum und Uhrzeit sowie die sekundäre Aktion „Terminieren“. Zukünftig terminierte Partien zeigen die sekundäre Aktion „Ergebnis eintragen“, über die das zunächst geschlossene Ergebnisformular geöffnet wird. Ein vergangener neu gesetzter Termin ordnet die Partie unmittelbar unter „Ergebnis eintragen“ ein.
- In Liga-Karten unter „Zu bestätigen“ und „Ergebnis eintragen“ entfällt die zusätzliche Terminzeile oberhalb der Mannschaften. Dort steht der Termin bereits im Vorschlagskasten beziehungsweise in den vorausgefüllten Eingabefeldern. Unter „Terminierte Spiele“ bleibt die Terminzeile sichtbar, solange das Ergebnisformular geschlossen ist.
- Karten mit persönlicher Beteiligung des eingeloggten Spielers erhalten analog zur öffentlichen Partienübersicht einen Rahmen in `accent2`; bei Admins bleiben nicht eigene Spiele am neutralen Rahmen erkennbar. Akute Karten unter „Zu bestätigen“ und „Ergebnis eintragen“ besitzen unabhängig davon den dominanten gelben Akzent-Rahmen und eine primäre Aktion. Aktive Status-Chips wie „Offen“ und „Zu bestätigen“ verwenden einheitlich eine gelbe Fläche mit schwarzer Schrift. Eigene wartende Karten sind abgedimmt. Alle vier Bereiche werden durch Trennlinien und vertikalen Abstand sichtbar voneinander getrennt.
- Jede Ligaspielkarte zeigt die zugehörige Liga innerhalb ihrer Kopfzeile unmittelbar vor „Partie X“ sowie Termin und Mannschaften in derselben visuellen Struktur wie die Tippspielkarten. Zwei Spieler eines Teams werden in diesen Darstellungen mit `&` verbunden; zwischen den Mannschaften steht kompakt „vs.“. Der Name des mit dem Konto verbundenen Spielers wird innerhalb der Mannschaften in `accent2` hervorgehoben.
- Beim Bestätigen eines Vorschlags stehen „Ergebnis bestätigen“ und „Alternative eingeben“ nebeneinander. Die eigentliche Aktion zum Senden einer Eingabe steht in einer eigenen Zeile unter den Satz-Countern innerhalb der Karte.
- Admins sehen Ergebnisvorschläge, fällige Partien und zukünftige terminierte Partien vollständig in den nach Aufgabenart sortierten Gruppen. Bestätigte beziehungsweise abgeschlossene Ligapartien erscheinen nicht im Konto-Dialog, da sie bereits öffentlich unter „Partien“ sichtbar sind.
- Ein vom Admin neu eingegebenes oder alternativ eingetragenes Ergebnis wird unmittelbar als offizielles Ergebnis übernommen, aktualisiert Tabelle und Elo und erzeugt keinen Bestätigungsvorschlag.
- „Training hinzufügen“ steht neben der Überschrift „Spieleübersicht“ und blendet dort das Trainingsformular ein. Einen separaten Bereich „Trainingsspiele“ gibt es nicht mehr; alle offenen Trainings stehen unter „Zu bestätigen“.
- Der bisherige „Zurücksetzen“-Button des Turnierrechners definiert künftig die zentrale Gestaltung für sekundäre Buttons: pillenförmig, dunkler Flächenhintergrund, heller Text, dieselbe Schriftfamilie wie primäre Buttons und Akzentfarbe bei Hover beziehungsweise Fokus. „Zurücksetzen“, „Ausloggen“ und „Training hinzufügen“ sowie weitere sekundäre Aktionen verwenden einheitlich diese Gestaltung. Sichtbare Spielanzahlen entfallen in den Bereichs- und Gruppenüberschriften. Die Kombination aus Liga und „Partie X“ innerhalb einer Spielkarte verwendet ebenfalls die allgemeine Widget-Label-Gestaltung.
- Der öffentliche Spielplan zeigt keinen internen Bestätigungsstatus.
- Spielerprofil und Konto-/Ergebnisdialog verwenden denselben runden Schließen-Button. Er bleibt beim Scrollen des jeweiligen Modalinhalts fest rechts oben stehen. Solange ein Modal geöffnet ist, bleibt die Seite dahinter vollständig scrollgesperrt; Scrollbewegungen am Anfang oder Ende des Modalinhalts werden nicht an den Hintergrund weitergereicht.
- Der Konto-/Ergebnisdialog für Spieler und Admins verwendet wie das öffentliche Spielerprofil den schwarzen Seitenhintergrund, ist auf `min(calc(100vw - 28px), 640px)` begrenzt und bleibt auf die Spieleingabe zugeschnitten. Die Spieleübersicht steht frei auf der Dialogfläche, beginnt mit einer Trennlinie und verwendet dieselbe 2-rem-Überschriftklasse wie die öffentlichen Hauptbereiche. Die vier Zwischenüberschriften verwenden dieselbe `spieltag-label`-Gestaltung wie die Spieltagsgruppen der Partienübersicht. Ausschließlich die einzelnen Spielkarten erhalten wie in der Partienansicht einen hervorgehobenen Hintergrund. Ergebnisdialog und Rechner verwenden dieselbe zentrale Score-Logik sowie dieselben Counter-, Button- und Aktivzustandsklassen. Leere Counter zeigen keine vorgefüllte Null, initialisieren beim ersten Plus-Klick oder einer direkten Zahleneingabe aber das noch leere Gegenfeld mit null. In der Mitte der Counter wird ausschließlich die vollständige, bis zu zweistellige Zahl dargestellt; die nativen Browser-Schalter der Zahlenfelder bleiben ausgeblendet. Die sichtbaren Überschriften „Satz 1“, „Satz 2“ und „Match-Tiebreak“ entfallen; nur der bei 7:6 beziehungsweise 6:7 zusätzlich eingeblendete Satz-Tiebreak wird benannt. Die Entscheidungscounter sind bis zu einem gültigen Satzstand von 1:1 deaktiviert. Spielerpaare verwenden wie die Partienübersicht einen abgesetzten grauen `&`-Separator. Der automatische Ergebnishinweis steht links auf derselben Höhe wie die primäre Aktion und zeigt wie der Rechner unmittelbar konkrete Hinweise für unvollständige oder regelwidrige Eingaben; eine Trennlinie vor dieser Aktionszeile gibt es nicht.

## Temporäre Test-Saison

- Es gibt eine öffentlich sichtbare Test-Saison mit zehn Testspielen.
- Die Partien 7, 9 und 10 sind geplant und ihren jeweiligen Spieltagen zugeordnet, aber ohne Datum und Uhrzeit noch nicht terminiert.
- Die Testprofile `Ludi GMX` und `Ludi Gmail` sind über vorab hinterlegte Konten zugeordnet; `Ludwig W.` besitzt ein Spielerprofil mit Adminrolle.
- In allen zehn Testspielen stehen `Ludi GMX` und `Ludi Gmail` in gegnerischen Teams; ihre jeweiligen Partner wechseln.
- Die übrigen Plätze werden mit Spielern aus der normalen Spielerliste besetzt.
- Testdaten dürfen zurückgesetzt und nach erfolgreichen Tests vollständig gelöscht werden.
- Die Test-Saison dient insbesondere den Rollen-, Ergebnis-, Gegenvorschlags-, Bestätigungs-, Elo-, Tipp- und Trainingsabläufen.
- `test-2026` ist vollständig von öffentlichen Spielerprofilen, Karrierewerten, Teilnahmen und saisonübergreifenden Elo-Verläufen ausgeschlossen.

## Öffentliche Spielerprofile

- Für jeden Spieler gibt es ein eigenständiges öffentliches Profil-Modal, getrennt vom privaten Konto- und Ergebnisdialog.
- Das Profil-Modal verwendet den schwarzen Seitenhintergrund. Profilbild und Name laufen ohne Widget bis an den Dialogrand; das Firmenlabel steht unter dem Namen und verwendet dieselbe Badge-Gestaltung wie in der Rangliste. Ein Coverbild gibt es nicht. Die gesamte All-Time-Statistik steht in einem gemeinsamen vollbreiten Widget; Elo-Verlauf, Teilnahmen, Mitspieler/Gegner und vergangene Partien bilden vier weitere Widgets.
- Das Profil öffnet sich über Spielernamen in Ranglisten, Partienübersichten und Rechner. Verknüpfungen verwenden ausschließlich stabile Spieler-IDs.
- Das Profil zeigt All-Time-Partien, Siege und Niederlagen, Spiele-G:V, Spieldifferenz, offiziellen saisonübergreifenden Elo-Verlauf, Saison-Teilnahmen, explizit hinterlegte Erfolge und vergangene Liga- beziehungsweise Trainingspartien.
- Die X-Achse des Elo-Verlaufs im Spielerprofil zeigt das jeweilige Spieldatum statt der Partienummer. Der saisonübergreifende Verlauf bildet eine durchgehende Linie: Der letzte Punkt einer Saison wird mit dem ersten Punkt der Folgesaison verbunden, wobei die Linienfarbe zwischen beiden Saisonfarben ineinander übergeht.
- Das Widget „Vergangene Partien“ zeigt Liga- und Trainingspartien gemeinsam als ungefilterte, chronologische Liste. Standardmäßig sind die zehn neuesten Partien sichtbar. Ab elf Partien erscheint darunter ein sekundärer Button, der die vollständige Historie einblendet.
- Links neben den auf zwei Drittel Breite angezeigten vergangenen Partien steht ein ein Drittel breites Widget mit Lieblingspartner, Lieblingsgegner und Angstgegner. Grundlage ist die All-Time-Siegquote der bestätigten Liga- und Trainingspartien. Eine Person erscheint erst ab drei gemeinsamen beziehungsweise gegeneinander gespielten Partien; Lieblingspartner und Lieblingsgegner benötigen zusätzlich eine Siegquote über 50 Prozent, der Angstgegner eine Siegquote unter 50 Prozent. Bei genau 50 Prozent wird keine Kategorie angezeigt.
- Öffentliche Profilwerte werden serverseitig aus bestätigten Daten aggregiert. Match-Tiebreak-Punkte zählen nicht als Spiele; Trainings verändern kein Elo.
- Erfolge werden ausdrücklich in einer eigenen Datenbanktabelle gepflegt und nicht aus einem Mockup oder einer laufenden Platzierung erfunden. Ohne Einträge wird der Erfolgsbereich ausgeblendet.
- Gold (`#FFD000`), Silber (`#ADC8D8`) und Bronze (`#C97B2E`) sind zentrale Gestaltungsfarben. Sie werden sowohl für Auszeichnungen als auch für die Plätze 1 bis 3 in sämtlichen Ranglisten verwendet.
- Auszeichnungen werden von den bereitgestellten linken und rechten Lorbeerzweigen eingerahmt. Gewinner erscheinen mit der Überschrift „GEWINNER“ in Gold, Final-4-Teilnehmer mit „FINAL 4“ in Silber; der Saisonname steht jeweils zentriert darunter.
- Final-Four-Auszeichnungen werden erst bei feststehender Qualifikation automatisch für alle vier Teilnehmer erzeugt. Die Gewinnerauszeichnung entsteht automatisch nach allen drei bestätigten Final-Four-Sätzen anhand von Siegen, Spiel-Differenz, direktem Vergleich und Ausgangsplatzierung. Verfrühte Sommer-Auszeichnungen werden entfernt.
- Profilbilder liegen im Git-Repository unter `assets/players/<spieler-id>/profile.webp`. Fehlende Bilder verwenden auf dunklem Hintergrund den in den Spieler-Stammdaten festgelegten Platzhalter `👨` beziehungsweise `👩`; vorhandene Profilbilder haben immer Vorrang. Luca W. und Ludwig W. besitzen jeweils ein eigenes Profilbild. Bilddateien und Binärdaten werden nicht in Supabase gespeichert.
- Das Profil startet mit dem tatsächlich vorhandenen Bestand ab der Saison „Sommer 2026“. Es werden keine älteren Mock-Saisons erzeugt.

## Rechner-Interaktion

- Ein Klick auf einen Spielernamen im Rechner öffnet ausschließlich das öffentliche Spielerprofil und verändert keine simulierten Ergebnisse.
- Die bisherige 6:2-/6:2-Schnellwahl liegt auf den beiden Wahrscheinlichkeitswerten. Die linke beziehungsweise rechte Wahrscheinlichkeit setzt das zugehörige Team als Sieger und darf vorhandene Eingaben überschreiben; ein vorhandener Match-Tiebreak wird dabei entfernt.
- Der Rechner erfasst bei 7:6 beziehungsweise 6:7 weiterhin keine Punkte des Satz-Tiebreaks. Match-Tiebreak-Endstände sind bis 10 und bei einer Verlängerung ausschließlich mit exakt zwei Punkten Abstand gültig.

## Noch nicht abschließend festgelegt

- Die erlaubten E-Mail-Domains.
- Der genaue Umfang zukünftiger Adminfunktionen über die bereits beschlossene direkte Ergebniseingabe hinaus.
- Der vollständige reguläre Spielplan der Saison „Winter 2026“.
