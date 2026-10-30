# Branding

Regeln dafür, welche Gestaltungswerte zu einem Branding gehören und wie ein Branding gewechselt wird.

## Grundsätze

- Das aktuelle Design heißt `OG-Design`. Seine Werte stehen in `branding/og-design.css`.
- Zu einem Branding gehören Schriften samt `@font-face`, die Überschriftengröße `--text-heading`, Laufweite und Stärke der Titel (`--heading-letter-spacing`, `--heading-font-weight`), alle Farben, die Eckenradien von Buttons, Dropdowns und Menüpunkten (`--button-radius`, `--dropdown-radius`, `--menu-radius`), der Eckenradius der Inhaltscontainer (`--container-radius`), der Abstand zwischen Inhaltsbereichen (`--section-gap`) und das Aussehen der Inhaltsbereiche (`--widget-bg`, `--widget-border`, `--widget-padding`). Außerdem gehören die Bilddateien für Favicon, App-Symbole und Safari-Tab-Symbol dazu; sie liegen an ihren festen Pfaden.
- Alle Größen in der Überschriftenschrift, also Überschriften, Wortmarken und große Zahlen, sind Vielfache von `--text-heading`. Die übrigen Schriftgrößen (`--text-xs`, `--text-sm`, `--text-base`), die Form `--radius-full` für Kreise und Pillen und alle übrigen Abstände gelten für jedes Branding gleich und bleiben in `style.css`.
- Inhaltscontainer leiten ihren Eckenradius je Verschachtelungsebene aus `--container-radius` ab: Ebene 1 ist der Wert selbst (Dialoge, Panels, `.widget`), Ebene 2 das 0,6-Fache (Karten), Ebene 3 das 0,4-Fache (Felder und Hinweise in Karten), Ebene 4 das 0,3-Fache (kleinste Elemente). Die Faktoren stehen in `style.css` und gelten für jedes Branding gleich. Eigene feste Werte für Inhaltscontainer werden nicht vergeben.
- Fest bleiben nur Elemente, die keine Inhaltscontainer sind: App-Symbole, Fokusrahmen, Kontrollkästchen und die Webseiten-Skizzen der Design-Vorschau.
- Überschriften bekommen ihr Aussehen vom Element: `h2` für Abschnitts- und Widget-Titel, `h3` für Labels und Spieltagslabel, `h4` für Zwischenüberschriften im Text. Eine Dachzeile direkt über einem Titel ist `.eyebrow` und sieht aus wie `h3`. Bereichsregeln setzen nur noch echte Abweichungen wie Größe oder Abstand.
- Eine Klasse beschreibt, was ein Element ist, und dasselbe Ding heißt überall gleich, etwa `.widget` oder `.match-group` für jede Gruppe von Partien samt Spieltagslabel. Klassen, die nur wiederholen, wo etwas steht, entfallen. IDs gibt es nur für einmalige Bereiche. Zustände wie `.active`, `.is-ready` oder `:hover` bleiben immer erhalten.
- Vereinheitlichungen dürfen Layout und Ausrichtung nicht verändern. Lässt sich eine Abweichung nicht entfernen, ohne dass sich etwas verschiebt, bleibt dort eine kleine Bereichsregel.
- Die gemeinsamen Stylesheets enthalten keine Farbwerte und keine Schriftdateien, sondern verwenden ausschließlich die Variablen des Brandings. Ausnahme sind die fest mit `orange` gemischten Tiebreak-Farben.
- Die Spielerfarben der Diagramme (`--player-1` bis `--player-18`) gehören zum Branding. Ein Spieler behält in jedem Branding dieselbe Position und denselben Farbton; die Helligkeit richtet sich nach dem Hintergrund. Jede Spielerfarbe erreicht auf `--bg` und `--surface` mindestens einen Kontrast von 4,5:1, weil sie auch für Namen im Diagramm dient.
- Linien in Diagrammen für Spieltage ohne Partie bleiben in der Farbe des Spielers und werden nur transparenter. So bleiben sie zuzuordnen und passen ohne eigene Farbe auf `--bg` wie auf `--surface`.
- Jede Branding-Datei definiert genau dieselben Variablen wie das OG-Design.

## Branding wechseln

- Ein neues Branding entsteht als Kopie von `branding/og-design.css` unter `branding/<name>.css` mit eigenen Werten.
- `tools/apply-branding.mjs <name>` aktiviert es: Das Werkzeug bindet die Datei in Liga- und Tippseite ein und überträgt die Farben dorthin, wo keine CSS-Variablen gelesen werden können. Das sind die Browserleiste (`--bg`), das Safari-Tab-Symbol (`--accent`) und das App-Manifest (`--bg`).
- Nach jeder Änderung an der aktiven Branding-Datei wird das Werkzeug erneut ausgeführt. Es setzt dabei auch die Versionskennung für den Browser-Cache. Ein Test schlägt fehl, solange Seiten oder Manifest nicht zum aktiven Branding passen.
- Die Partie- und Tippmails sowie die Supabase-Mailvorlagen verwenden vorerst fest die Farben des OG-Designs und folgen keinem Branding.

## Design-Vorschau für Admins

- Admins können im Konto unter „Einstellungen“ unterhalb der E-Mail-Benachrichtigungen im eigenen Bereich „Design“ jedes vorhandene Branding auswählen. Jedes Design erscheint als Karte mit einer kleinen Webseiten-Skizze (Wireframe) in seinen Farben, darunter Titel und Auswahlkästchen; das veröffentlichte Design ist markiert.
- Die Auswahl ist eine reine Vorschau: Sie gilt nur im Browser dieses Geräts, für Liga- und Tippseite gemeinsam, und ändert nicht das veröffentlichte Branding. Veröffentlicht wird weiterhin ausschließlich mit `tools/apply-branding.mjs`.
- Für Konten ohne Admin-Rolle wird eine gespeicherte Vorschau verworfen; sie sehen immer das veröffentlichte Branding.
- Jedes Branding unter `branding/` muss in der Vorschau-Liste von `js/branding-preview.js` stehen. Die dortigen Skizzenfarben müssen den Werten der Branding-Datei entsprechen; ein Test prüft beides.

## Offene Entscheidungen

- Ob und wie Mails einem Branding folgen, auch bei einer Auswahl des Brandings durch Nutzer, ist offen.
- Der Produktname (`PadelLiga`, `PadelTipp`), die Wortmarke im Seitenkopf, die Domain und der Mailabsender sind noch nicht Teil des Brandings.
