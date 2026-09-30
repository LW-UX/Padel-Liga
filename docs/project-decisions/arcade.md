# PadelArcade

Diese Datei ist die kanonische Quelle für das saisonunabhängige Arcade-Spiel, seine Modi, Regeln, Audio- und Bestenlistenlogik.

## Produkt und Darstellung

- PadelArcade ist ein öffentliches, saisonunabhängiges Retro-Minispiel unter `/arcade/` und wird innerhalb desselben Tabs aus der Liga geöffnet.
- Der Pixel-Look gilt dem Spielfeld; die umgebende Oberfläche übernimmt Typografie, dunkle Flächen, Akzente und Bedienelemente der Liga.
- Das Spielfeld zeigt eine 2D-Draufsicht mit berechneter Ballhöhe, Bodenschatten, nächstem Aufprall und Warnung vor ungültigem direktem Begrenzungskontakt.
- Ein Team besteht aus zwei fest gekoppelten Balken ohne aktiven Spielerwechsel. Tastatur sowie direktes Ziehen mit Maus oder Finger werden unterstützt.
- Auf Touch-Geräten verhindert die Spieloberfläche unbeabsichtigte Textauswahl und native Ziehgesten; echte Texteingaben bleiben normal bedienbar.

## Bewegung, Schläge und Regeln

- Bewegung besitzt begrenzte Beschleunigung, Geschwindigkeit, Bremsen und Richtungswechsel. Mensch und Computer unterliegen denselben räumlichen Grenzen.
- Schläge erfolgen automatisch in zulässiger Höhe. Trefferstelle, Courtposition und tatsächliche Bewegungsrichtung bestimmen Richtung, Flugkurve und Tempo; Eingabesprünge erzeugen keine zusätzliche Kraft.
- Der erste Bodenaufprall muss im gegnerischen Feld erfolgen. Danach sind Glas- und Zaunabpraller erlaubt; der zweite Bodenaufprall beendet den Punkt.
- Eigene Glasberührung vor dem ersten Aufprall ist erlaubt, eigener Zaun und gegnerische Begrenzung davor sind Fehler. Glas und Zaun dämpfen nur den senkrechten Geschwindigkeitsanteil unterschiedlich stark.
- Netzkontakt beendet den Punkt. Ein direkter Netzschlag verliert den Punkt; springt der Ball nach gültigem gegnerischem Bodenaufprall ohne weiteren Schlag ins Netz zurück, gewinnt das zuletzt schlagende Team.
- Pro Team ist nur ein Schlag bis zur gegnerischen Berührung zulässig. Eine anhaltende Überlappung desselben Kontakts zählt nicht doppelt.
- Ein vereinfachtes automatisches diagonales Anspiel ersetzt den echten Aufschlag. Es gibt keine Court-Ausflüge, keinen gesonderten Lob und keine zusätzliche Anti-Netzstehen-Regel.
- Gespielt wird bis sieben ohne Abstand. Countdown, Pause, Fokusverlust, Neustart und Revanche halten in allen Modi dieselben Grundregeln ein.

## Computer und Schwierigkeit

- Der Computer verwendet dieselben Bewegungsgrenzen, besitzt aber begrenzte Reaktion und Vorhersage.
- „Leicht“ ist die Voreinstellung und reagiert langsamer, bewegt sich langsamer und macht unter Druck natürliche kontaktabhängige Fehler. „Schwer“ bleibt schneller und präziser.
- Die Schwierigkeit bleibt während einer Partie fest, wird für Revanchen übernommen und nach Möglichkeit im Browser gespeichert.
- Weitere interne CPU-Profile dürfen für spätere Modi erhalten bleiben, ohne automatisch öffentlich auswählbar zu werden.

## Audio und Bedienung

- Musik und Effekte besitzen getrennte gespeicherte Schalter. Musik läuft nur während aktivem Spiel; Menüs, Pause, Countdown und Ergebnisansicht bleiben musikfrei.
- Audio wird über einen langlebigen Mixer vorgeladen und mit der ersten Nutzerinteraktion aktiviert. Mobile und Desktop-Wiedergabe dürfen getrennt abgestimmt sein, ohne die Kanäle voneinander abhängig zu machen.
- Kontakt-, Punkt- und Partieende-Ereignisse verwenden semantisch passende Sounds. Ein punktentscheidender Kontakt erzeugt keinen doppelten Aufprall- und Punktsound.
- Mobil bündelt ein Menü Pause, Neustart, Bestenliste, Audio, Bildrate und Anleitung. Das Öffnen pausiert; Fortsetzen erfolgt ausdrücklich.

## Computer-Bestenliste

- Nur freiwillig eingetragene Siege gegen den Computer werden in Supabase gespeichert. Online- und Laptop-Duelle sowie Niederlagen erscheinen nicht.
- Schwierigkeit und Regelversion werden beim Partiestart festgelegt und unveränderlich mit dem Sieg gespeichert. Änderungen an Physik oder Schwierigkeit können getrennte Listen erzeugen; frühere Regelversionen bleiben archiviert.
- Rangfolge: besseres Ergebnis vor schlechterem, danach kürzere Spielzeit. Exakt gleiche Leistungen teilen einen Rang; der längste Ballwechsel ist reine Zusatzinformation.
- Je Schwierigkeit und Regelversion werden die besten acht Einträge sowie gegebenenfalls der eigene zuletzt gespeicherte Sieg angezeigt.
- Namen sind frei gewählt, nicht identitätsgeprüft und werden im Browser sowie serverseitig gegen Format und Sperrliste geprüft. Gleiche Namen sind zulässig.
- Die Bestenliste ist eine Freizeitwertung ohne serverseitige Verifikation des Spielverlaufs. Derselbe Sieg darf höchstens einmal gespeichert werden.

## 1v1 Laptop

- Zwei Personen spielen an derselben Tastatur mit getrennten Tastengruppen. Maus- und Touch-Steuerung sind in diesem Modus ausgeschaltet.
- Der Modus benötigt weder Raumcode, Anmeldung noch Netzwerk. Auf Touch-Geräten bleibt er sichtbar, aber deaktiviert.
- Pause, Fokusverlust, Revanche und Rückkehr zur Modusauswahl gelten gemeinsam für beide Personen.

## 1v1 Online

- Zwei Personen spielen auf eigenen Geräten ohne Anmeldung über einen kurzlebigen Raumcode. Ein Raum besitzt genau zwei Plätze und keine öffentliche Raumliste.
- Beide sehen das eigene Team unten. Der Host berechnet verbindlich Physik, Treffer, Zeit und Punkte; der Gast überträgt Eingaben und gleicht seine Darstellung ab.
- Der Modus ist eine Freizeitpartie ohne verifizierte Identität, serverseitigen Manipulationsschutz, persistente Ergebnisse oder Einfluss auf die Computer-Bestenliste.
- Raum- und Spielzustände werden vorübergehend über Supabase Realtime ausgetauscht. Verlassen, Neuladen oder ausbleibende Gegenstelle beendet nach einer begrenzten Wiederverbindungsphase den Raum; eine Host-Übernahme gibt es nicht.
- Beide Personen müssen für Start, Fortsetzen und Revanche bereit sein. Pause, mobiles Menü und Fokusverlust halten die gemeinsame Partie an.
