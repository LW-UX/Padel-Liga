# Projektentscheidungen Padel-Liga

Stand: 1. September 2026

Diese Datei ist das fortlaufende Projektgedächtnis. Sie beschreibt das aktuell beschlossene Zielbild. Bei neuen oder geänderten Entscheidungen wird sie zusammen mit der jeweiligen Umsetzung aktualisiert.

## Zusammenarbeit

- Der Nutzer arbeitet ausschließlich über Codex und verwendet kein Terminal.
- Codex führt erforderliche und autorisierte technische Befehle selbst aus.
- Der Nutzer wird nur um unvermeidbare Freigaben, Anmeldungen oder fachliche Entscheidungen gebeten.
- Anleitungen an den Nutzer werden ohne vorausgesetzte Terminal- oder Datenbankkenntnisse formuliert.
- Supabase-Datenbankzugriffe erfolgen über eine projektgebundene MCP-Verbindung. Der dafür notwendige persönliche Zugriffsschlüssel liegt ausschließlich in der lokalen, nur für den Benutzer lesbaren Datei `.codex-secrets/supabase-access-token`. Das Verzeichnis ist durch `.gitignore` von der Versionierung ausgeschlossen; der Schlüssel wird weder im Repository noch in Codex-Aufgaben hinterlegt.
- Schreibende Supabase-Aktionen bleiben einzeln freigabepflichtig. Einmalige OAuth-Helfer und der Supabase-Browser sind kein Ersatz für die projektgebundene Verbindung.

## Aktueller Umsetzungsstand

- Die projektbezogene Supabase-MCP-Verbindung ist im Repository vorbereitet. Sie verwendet wegen der derzeit fehlerhaften OAuth-Erkennung der installierten Codex-Version einen lokal geschützten persönlichen Zugriffsschlüssel.
- Die Migration `20260717100000_player_results_training_test_season.sql` wurde am 17. Juli 2026 vollständig und erfolgreich auf die Supabase-Produktionsdatenbank angewendet.
- Die Migration `20260723160000_profile_result_tabs_actual_time.sql` wurde am 23. Juli 2026 vollständig und erfolgreich auf die Supabase-Produktionsdatenbank angewendet. Die neue Ergebnisfunktion mit tatsächlichem Datum und tatsächlicher Uhrzeit ist im Supabase-Schema-Cache verfügbar.
- Die Migration `20260723164500_fix_elo_player_id_ambiguity.sql` wurde am 23. Juli 2026 vollständig und erfolgreich auf die Supabase-Produktionsdatenbank angewendet. Sie behebt die zuvor mehrdeutige Spieler-ID in der Elo-Neuberechnung.
- Die Migration `20260723173000_account_games_email_names.sql` wurde am 23. Juli 2026 vollständig und erfolgreich auf die Supabase-Produktionsdatenbank angewendet. Die E-Mail-abgeleiteten Kontonamen, ligaübergreifenden Aufgaben, automatisch geprüften Satzbilanzen und Trainingsnummern sind aktiv.
- Die Migration `20260901130000_public_player_profiles.sql` wurde am 1. September 2026 vollständig und erfolgreich auf die Supabase-Produktionsdatenbank angewendet. Öffentliche Profildaten, Saisonfunktionen, Auszeichnungen und die anonym lesbaren RPCs sind aktiv.
- Die Migration `20260901131000_import_2026_profile_history.sql` wurde am 1. September 2026 vollständig und erfolgreich auf die Supabase-Produktionsdatenbank angewendet. Der geprüfte Bestand von „Sommer 2026“ umfasst 18 Teilnehmer, 30 Partien, 22 Ergebnisse, 108 Spielerzuordnungen und 88 Elo-Änderungen.
- Die Migration `20260901132000_sommer_2026_final_four_achievements.sql` wurde am 1. September 2026 vollständig und erfolgreich auf die Supabase-Produktionsdatenbank angewendet. Saison und Liga tragen live die Bezeichnung „Sommer 2026“; Luca W. und Marco M. besitzen jeweils die freigegebene Final-4-Auszeichnung.
- Die Migration `20260901133000_sommer_2026_marcel_winner_achievement.sql` wurde am 1. September 2026 vollständig und erfolgreich auf die Supabase-Produktionsdatenbank angewendet. Marcel M. besitzt live die goldene Gewinner-Auszeichnung für „Sommer 2026“.
- Die Migration `20260901140000_incomplete_training_rounds.sql` wurde am 1. September 2026 vollständig und erfolgreich auf die Supabase-Produktionsdatenbank angewendet. Abgebrochene Trainingsrunden und bis zu drei Ergebnisabschnitte je Runde sind aktiv; abgebrochene Runden bleiben aus den Profilstatistiken ausgeschlossen.
- Die Migration `20260901141000_import_historical_training_sessions.sql` wurde am 1. September 2026 vollständig und erfolgreich auf die Supabase-Produktionsdatenbank angewendet. Fünf historische Trainingseinheiten mit sieben Runden wurden geprüft importiert; das abgebrochene 3:1 vom 13. August 2026 ist sichtbar, aber ohne Wertung.
- Die Konten für `Ludi Gmail` und `Ludi GMX` sind jeweils mit ihrer Spieler-ID und der Rolle `player` verbunden.
- Das Konto für `Ludwig W.` ist mit seiner Spieler-ID und der Rolle `admin` verbunden.
- Alle drei zugeordneten E-Mail-Adressen sind bestätigt. Die Test-Saison enthält vier Datenbankspiele, und Row Level Security ist für alle neu angelegten öffentlichen Tabellen aktiviert.

## Saison- und Datenstrategie

- Die separat weiterbetriebene öffentliche Saison „Sommer 2026“ bleibt bis zu ihrem Abschluss dateibasiert. Ihre Datenquelle und ihr laufender Betrieb werden durch die vorbereitete Nachfolgeversion nicht verändert; die stabile technische Saison-ID bleibt `2026`.
- Die vorbereitete Nachfolgeversion verwendet dieselbe künftige Produktivdatenbank bereits vor der nächsten regulären Saison. Die echten Daten aus `data2026.js` werden dort kontrolliert unter der regulären Saison-ID `2026` ergänzt, damit öffentliche Spielerprofile und saisonübergreifende Auswertungen mit realen Daten entwickelt werden können.
- Bis zum Abschluss der parallel laufenden dateibasierten Saison werden neue reale Ergebnisse zusätzlich kontrolliert in der Datenbank nachgetragen. Danach ist die Datenbank die einzige aktive Quelle für strukturierte Spieler-, Saison-, Match-, Ergebnis- und Elo-Daten der Nachfolgeversion.
- Editoriale Saisonartikel bleiben Inhalte des Git-Repositorys und werden nicht in die Sportdatenbank verschoben.
- Die nächste reguläre Saison wird von Beginn an datenbankbasiert betrieben.
- Der vollständige Datenbestand der Saison „Sommer 2026“ wird kontrolliert in die Datenbank importiert. Dazu gehören Spielerzuordnungen, Partien, Teams, Sätze, Ergebnisse und reproduzierbar berechnete Elo-Verläufe.
- Die importierte Saison „Sommer 2026“ wird anschließend als abgeschlossen und schreibgeschützt behandelt. Sie dient Spielerprofilen, Statistiken und historischen Auswertungen.
- Vor dem finalen Import werden Datenbank und Quelldaten gesichert. Ein separates Repository enthält bereits ein vollständiges Backup der Saison „Sommer 2026“.
- Während der Umstellung ist eine kurzzeitige doppelte Datenhaltung als Rückfallmöglichkeit erlaubt. Nach erfolgreichem Vergleich wird die aktive Doppelhaltung entfernt.
- Der finale Import muss Anzahl und Inhalt der Spiele, Satzergebnisse, Tabelle sowie Elo-Endstände und Elo-Verlauf gegen die Quelldaten prüfen.

## Saisonauswahl und Seitenaufteilung

- Der Hinweis „Jetzt auch als App!“ auf der Startseite kann über ein X im Kasten für den aktuellen Browser-Tab geschlossen werden. Er bleibt bei Reloads innerhalb dieses Tabs ausgeblendet und erscheint nach dem Schließen des Tabs beim nächsten Besuch wieder.
- Gibt es für den aktuellen Zeitraum noch keinen veröffentlichten Artikel, zeigt die Startseite weiterhin den zeitlich jüngsten bereits veröffentlichten Artikel. Unveröffentlichte Artikelplatzhalter werden dabei nicht angezeigt.
- Die Saisonauswahl steht rechts oben auf Höhe der Eyebrow oberhalb des Loginbereichs.
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

- Spieler können keine Ligaspiele erstellen. Ligaspiele werden vorab im Spielplan angelegt.
- Ein beteiligter Spieler kann zu einem Ligaspiel ein Ergebnis samt tatsächlich gespieltem Datum und tatsächlicher Uhrzeit vorschlagen. Der tatsächliche Termin darf nicht in der Zukunft liegen und darf vom ursprünglich geplanten Termin abweichen.
- Datum und Uhrzeit der Ergebniseingabe sind mit den vorhandenen Spieldaten vorausgefüllt.
- Die genauen Ergebnisse werden über gleich große Satz-Counter eingegeben. Satzbilanz und Sieger werden daraus automatisch berechnet und von der Datenbank nochmals geprüft; eine getrennte manuelle Satzbilanz gibt es nicht.
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
- Ein Tipp kann bis zur tatsächlich hinterlegten Startzeit der Partie abgegeben oder geändert werden. Das Eintragen eines Ergebnisses ist nicht der Schließzeitpunkt.
- Wertung: 4 Punkte für das exakte Satzergebnis, 2 Punkte für den richtigen Sieger bei anderem Satzergebnis, 0 Punkte für den falschen Sieger.
- Die Tippübersicht bleibt öffentlich sichtbar.
- Eine Partie mit nachträglich geändertem offiziellen Ergebnis muss für die Tippspielauswertung den bestätigten offiziellen Stand verwenden.

## Trainingsspiele

- Trainingsspiele sind saisonunabhängig und erscheinen nicht im regulären Saisonspielplan.
- Jeder angemeldete Spieler darf ein Training anlegen, wenn er selbst zu den vier Beteiligten gehört. Ein Admin darf dies im administrativen Rahmen ebenfalls.
- Ein Training enthält genau vier Spieler. Werden andere Spieler eingesetzt, ist es ein neues Training.
- Innerhalb einer Trainingskarte dürfen mehrere Spielabschnitte mit unterschiedlichen Paarungen derselben vier Spieler stehen.
- Jeder Spielabschnitt enthält einen bis drei tatsächlich gespielte Ergebnisabschnitte. Dazu gehören einzelne Sätze, vollständige Zwei- oder Drei-Satz-Partien sowie zwei Sätze mit anschließendem Match-Tiebreak. Auch ein Zwischenstand von 1:1 ist als tatsächliches Trainingsergebnis zulässig. Ein wegen Zeitmangels oder aus einem anderen Grund nicht beendeter Satz wird als „abgebrochen“ erfasst und bleibt ohne Wertung.
- Datum, tatsächliche Uhrzeit und Ergebnisse werden beim Anlegen erfasst.
- Ein anderer beteiligter Spieler muss das Training bestätigen. Der Ersteller kann nicht selbst bestätigen.
- Trainingsspiele werden über den Konto-Dialog hinzugefügt und verwaltet.
- Trainings werden nach ihrem Erstellungszeitpunkt fortlaufend als „Training X“ nummeriert. Im Konto erscheinen nur offene Trainings; bestätigte Trainings werden dort nicht mehr angezeigt.
- Jede bestätigte und vollständig beendete Trainingsrunde zählt in öffentlichen Spielerprofilen als eine All-Time-Partie und fließt in Spiele-G:V sowie Spieldifferenz ein. Abgebrochene Runden bleiben im Partienverlauf sichtbar, zählen aber weder für Partien, Siege/Niederlagen, Spiele, Spieldifferenz noch für Mitspieler-/Gegnerauswertungen.
- Eine bestätigte Trainingsrunde mit ausgeglichener Satzbilanz zählt weder als Sieg noch als Niederlage. Deshalb dürfen Siege plus Niederlagen kleiner als die All-Time-Partienzahl sein.
- Trainings bleiben trotz ihrer Profilwertung ohne Einfluss auf Saisonrangliste und Elo.
- Mehrere Runden desselben Trainings werden im Spielerprofil als kompakte Gruppe dargestellt. Das Datum erscheint nur an der ersten Runde, die Kennzeichnung „Training“ nur an der letzten; jede Runde behält ihren eigenen Ergebniskreis und Spielstand. Abgebrochene Spielstände erscheinen kursiv und abgedimmt mit einem neutralen, gestrichelten Ergebniskreis.

## Konto-Dialog und Aufgaben

- Nach dem Login zeigt der Konto-Button im Seitenkopf ein User-Icon statt des Anzeigenamens. Der Name bleibt im Konto-Dialog sichtbar; offene Aufgaben werden weiterhin als Badge am Icon angezeigt.
- Der Konto-Dialog besitzt keine Tabnavigation mehr und zeigt ausschließlich den Bereich „Spiele“. Der Logout steht im Kopf des Dialogs auf Höhe des Kontonamens.
- Nach dem Senden oder Bestätigen eines Ergebnisses bleibt der Konto-Dialog geöffnet und aktualisiert seine Aufgaben direkt.
- Im Bereich „Spiele“ erscheinen offene Ligaergebnisse, zu bestätigende oder zu beantwortende Vorschläge und offene Trainingsbestätigungen liga- und saisonübergreifend. Die aktuell ausgewählte Liga oder Saison filtert diese persönlichen Aufgaben nicht.
- Jede Ligaspielkarte nennt oberhalb der Karte die zugehörige Liga und zeigt „Partie X“, Termin und Mannschaften in derselben visuellen Struktur wie die Tippspielkarten.
- Beim Bestätigen eines Vorschlags stehen „Ergebnis bestätigen“ und „Alternative eingeben“ nebeneinander. Die eigentliche Aktion zum Senden einer Eingabe steht in einer eigenen Zeile unter den Satz-Countern innerhalb der Karte.
- Für Admins stehen die gespielten Partien zuerst, danach die offenen Ergebnisse. Unter den offenen Ergebnissen folgt ein standardmäßig geschlossener Bereich „Alle Ligaspiele“; dessen Karten werden erst beim Aufklappen angezeigt. Der frühere Filter „Offen/Alle Spiele“ entfällt.
- Trainingsspiele werden ebenfalls im Bereich „Spiele“ angelegt.
- Der öffentliche Spielplan zeigt keinen internen Bestätigungsstatus.
- Spielerprofil und Konto-/Ergebnisdialog verwenden denselben runden Schließen-Button. Er bleibt beim Scrollen des jeweiligen Modalinhalts fest rechts oben stehen.

## Temporäre Test-Saison

- Es gibt eine öffentlich sichtbare Test-Saison mit vier Testspielen.
- Die Testprofile `Ludi GMX` und `Ludi Gmail` sind über vorab hinterlegte Konten zugeordnet; `Ludwig W.` besitzt ein Spielerprofil mit Adminrolle.
- In jedem der vier Testspiele steht mindestens eines der beiden speziellen Testprofile einem der anderen Testprofile beziehungsweise dem Adminprofil im gegnerischen Team gegenüber.
- Die übrigen Plätze werden mit Spielern aus der normalen Spielerliste besetzt.
- Testdaten dürfen zurückgesetzt und nach erfolgreichen Tests vollständig gelöscht werden.
- Die Test-Saison dient insbesondere den Rollen-, Ergebnis-, Gegenvorschlags-, Bestätigungs-, Elo-, Tipp- und Trainingsabläufen.
- `test-2026` ist vollständig von öffentlichen Spielerprofilen, Karrierewerten, Teilnahmen und saisonübergreifenden Elo-Verläufen ausgeschlossen.

## Öffentliche Spielerprofile

- Für jeden Spieler gibt es ein eigenständiges öffentliches Profil-Modal, getrennt vom privaten Konto- und Ergebnisdialog.
- Das Profil-Modal verwendet den schwarzen Seitenhintergrund. Profilbild und Name laufen ohne Widget bis an den Dialogrand; das Firmenlabel steht unter dem Namen und verwendet dieselbe Badge-Gestaltung wie in der Rangliste. Ein Coverbild gibt es nicht. Die gesamte All-Time-Statistik steht in einem gemeinsamen vollbreiten Widget; Elo-Verlauf, Teilnahmen, Mitspieler/Gegner und vergangene Partien bilden vier weitere Widgets.
- Das Profil öffnet sich über Spielernamen in Ranglisten, Partienübersichten und Rechner. Verknüpfungen verwenden ausschließlich stabile Spieler-IDs.
- Das Profil zeigt All-Time-Partien, Siege und Niederlagen, Spiele-G:V, Spieldifferenz, offiziellen saisonübergreifenden Elo-Verlauf, Saison-Teilnahmen, explizit hinterlegte Erfolge und vergangene Liga- beziehungsweise Trainingspartien.
- Die X-Achse des Elo-Verlaufs im Spielerprofil zeigt das jeweilige Spieldatum statt der Partienummer.
- Der Filter „Alle / Liga / Training“ im Widget „Vergangene Partien“ verwendet dieselbe Auswahlkomponente wie die Partienübersicht; der aktive Eintrag erscheint in der Akzentfarbe.
- Links neben den auf zwei Drittel Breite angezeigten vergangenen Partien steht ein ein Drittel breites Widget mit Lieblingspartner, Lieblingsgegner und Angstgegner. Grundlage ist die All-Time-Siegquote der bestätigten Liga- und Trainingspartien. Eine Person erscheint erst ab drei gemeinsamen beziehungsweise gegeneinander gespielten Partien; Lieblingspartner und Lieblingsgegner benötigen zusätzlich eine Siegquote über 50 Prozent, der Angstgegner eine Siegquote unter 50 Prozent. Bei genau 50 Prozent wird keine Kategorie angezeigt.
- Öffentliche Profilwerte werden serverseitig aus bestätigten Daten aggregiert. Match-Tiebreak-Punkte zählen nicht als Spiele; Trainings verändern kein Elo.
- Erfolge werden ausdrücklich in einer eigenen Datenbanktabelle gepflegt und nicht aus einem Mockup oder einer laufenden Platzierung erfunden. Ohne Einträge wird der Erfolgsbereich ausgeblendet.
- Gold (`#FFD000`), Silber (`#ADC8D8`) und Bronze (`#C97B2E`) sind zentrale Gestaltungsfarben. Sie werden sowohl für Auszeichnungen als auch für die Plätze 1 bis 3 in sämtlichen Ranglisten verwendet.
- Auszeichnungen werden von den bereitgestellten linken und rechten Lorbeerzweigen eingerahmt. Gewinner erscheinen mit der Überschrift „GEWINNER“ in Gold, Final-4-Teilnehmer mit „FINAL 4“ in Silber; der Saisonname steht jeweils zentriert darunter.
- Luca W. und Marco M. erhalten für die Saison „Sommer 2026“ jeweils die Auszeichnung „Final 4 Teilnehmer“ mit dem Untertitel „Padel-Liga Sommer 2026“.
- Marcel M. erhält für die Saison „Sommer 2026“ die goldene Auszeichnung „Gewinner“ mit dem Untertitel „Padel-Liga Sommer 2026“.
- Profilbilder liegen im Git-Repository unter `assets/players/<spieler-id>/profile.webp`. Fehlende Bilder verwenden auf dunklem Hintergrund den in den Spieler-Stammdaten festgelegten Platzhalter `👨` beziehungsweise `👩`; vorhandene Profilbilder haben immer Vorrang. Luca W. und Ludwig W. besitzen jeweils ein eigenes Profilbild. Bilddateien und Binärdaten werden nicht in Supabase gespeichert.
- Das Profil startet mit dem tatsächlich vorhandenen Bestand ab der Saison „Sommer 2026“. Es werden keine älteren Mock-Saisons erzeugt.

## Rechner-Interaktion

- Ein Klick auf einen Spielernamen im Rechner öffnet ausschließlich das öffentliche Spielerprofil und verändert keine simulierten Ergebnisse.
- Die bisherige 6:2-/6:2-Schnellwahl liegt auf den beiden Wahrscheinlichkeitswerten. Die linke beziehungsweise rechte Wahrscheinlichkeit setzt das zugehörige Team als Sieger und darf vorhandene Eingaben überschreiben; ein vorhandener Match-Tiebreak wird dabei entfernt.

## Noch nicht abschließend festgelegt

- Die erlaubten E-Mail-Domains.
- Der genaue Umfang zukünftiger Adminfunktionen über die bereits beschlossene direkte Ergebniseingabe hinaus.
- Der endgültige Spielmodus und Spielplan der nächsten regulären Saison.
