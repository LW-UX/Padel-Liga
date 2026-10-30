# Branding

Regeln dafür, welche Gestaltungswerte zu einem Branding gehören und wie ein Branding gewechselt wird.

## Grundsätze

- Das aktuelle Design heißt `OG-Design`. Seine Werte stehen in `branding/og-design.css`.
- Zu einem Branding gehören Schriften samt `@font-face`, die Überschriftengröße `--text-heading`, alle Farben, die Eckenradien nach Rolle (`--button-radius`, `--dropdown-radius`, `--menu-radius`), der Abstand zwischen Inhaltsbereichen (`--section-gap`) und das Aussehen der Inhaltsbereiche (`--widget-bg`, `--widget-border`, `--widget-radius`, `--widget-padding`). Außerdem gehören die Bilddateien für Favicon, App-Symbole und Safari-Tab-Symbol dazu; sie liegen an ihren festen Pfaden.
- Alle Größen in der Überschriftenschrift, also Überschriften, Wortmarken und große Zahlen, sind Vielfache von `--text-heading`. Die übrigen Schriftgrößen (`--text-xs`, `--text-sm`, `--text-base`), die Radius-Grundskala (`--radius-xs`, `--radius-sm`, `--radius-lg`, `--radius-full`) und alle übrigen Abstände gelten für jedes Branding gleich und bleiben in `style.css`.
- Die gemeinsamen Stylesheets enthalten keine Farbwerte und keine Schriftdateien, sondern verwenden ausschließlich die Variablen des Brandings. Ausnahmen sind die fest mit `orange` gemischten Tiebreak-Farben und die Spielerfarben-Palette der Diagramme.
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
