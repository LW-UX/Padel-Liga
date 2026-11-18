(function (season) {
  const receive = typeof document !== 'undefined' && document.currentScript?.padelSearchReceive;
  if (typeof receive === 'function') {
    receive(season);
  } else {
    window.PADEL_SEASON = season;
    window.PadelSiteSearch?.rememberEditorial(season);
  }
})({
  id: "2026-winter",
  label: "Winter 2026",
  matchdayBreaks: [
    { title: "Winterpause", startDate: "2026-12-14", endDate: "2027-01-15" }
  ],
  homeAnnouncement: {
    label: "Saisonstart Winter 2026",
    expiresAt: "2026-11-02T00:00:00+01:00",
    title: "Die Liga startet!",
    body: [
      {
        type: "p",
        text: "Das Teilnehmerfeld steht, die Elo-Werte wurden berechnet und der Spielplan ist erstellt."
      },
      {
        type: "p",
        text: "Zwanzig Spieler gehen in die Wintersaison, darunter vier Neulinge: Christian H., Lisa S., Lukas T. und Yonatan G. Wie schlagen sie sich gegen die Spieler mit Sommer-Erfahrung?"
      },
      {
        type: "p",
        text: "Luca W. startet als amtierender Champion. Verteidigt er seinen Titel? Nach Elo liegt er zum Auftakt nur auf Platz fünf. Dass das aber nichts heißen muss, hat die letzte Saison gezeigt."
      },
      {
        type: "p",
        text: "Der Weg ins Final Four wird länger: Diesmal ziehen die Top 8 ins Halbfinale ein. Headsquare und Envidual stellen je acht Spieler, Hanako vier - das Firmenduell geht in die nächste Runde."
      },
      {
        type: "p",
        text: "Ab jetzt kann es losgehen!"
      }
    ],
    link: { label: "Zur Partienübersicht", target: "partien" }
  },
  articles: [
    {
      spieltag: 1,
      startDate: "2026-11-02",
      endDate: "2026-11-15",
      title: "Die PadelLiga geht in die zweite Saison",
      meta: "SPIELTAG 1  ·  2. NOVEMBER - 13. NOVEMBER 2026",
      body: [
        {
          type: "p",
          text: "Raunen und Beschwerden hallen durch den Büroflur. Grund ist der neue Spielplan. Viele sind mit ihren Ansetzungen nicht zufrieden. „Viel zu schwer“, „Na toll, da gewinn ich gar nichts.“ oder „Warum trifft es wieder mich?“ sind Worte, die man aus den Büros vernehmen kann. Weil sich aber so viele benachteiligt fühlen, scheint es ein fairer und ausgeglichener Spielplan zu sein."
        },
        {
          type: "p",
          text: "Zwanzig Spieler gehen in die Wintersaison, vier davon sind neu: Christian H., Lisa S., Lukas T. und Yonatan G. starten mit einem Elo von 550. Jeder bestreitet sechs Partien, die Top 8 ziehen ins Halbfinale ein. Die Rangliste steht noch bei null."
        },
        {
          type: "h",
          text: "Partie 1 - Wiedersehen nach dem Final Four"
        },
        {
          type: "match",
          matchId: "winter-2026-partie-1",
          text: "Ludwig W. & Florian Z. vs. Luca W. & Christoph L.",
          result: "54 : 46 %",
          resultLabel: "Gewinnwahrscheinlichkeit"
        },
        {
          type: "p",
          text: "Seit dem letzten Ballwechsel ist bei manchen einige Zeit vergangen. So haben unter anderem Flo und Ludwig sich mit einem Trainingsspiel auf die neue Saison vorbereitet. Andere haben nicht trainiert, sich aber darüber beschwert, dass man sich vorbereitet. Ob da das Urteil aus Trägheit gefällt wurde oder aus Angst, da es gegen den Angstgegner geht (1 von 4,5)?"
        },
        {
          type: "p",
          text: "Florian Z. kann mit jedem Sieg einen neuen Elo-Höchstwert erreichen. Sein bisheriger liegt bei 866, aktuell steht er bei 814."
        },
        {
          type: "h",
          text: "Partie 2 - Zwei Serien suchen ihr Ende"
        },
        {
          type: "match",
          matchId: "winter-2026-partie-2",
          text: "Leonie R. & Christian H. vs. Jonas L. & Agnes K.",
          result: "40 : 60 %",
          resultLabel: "Gewinnwahrscheinlichkeit"
        },
        {
          type: "p",
          text: "Jonas L. und Agnes K. gehen als Team in diese Partie, und beide bringen eine Niederlagenserie mit. Zusammen können sie diese nun beenden. Die Gewinnwahrscheinlichkeit von 60 Prozent spricht für sie."
        },
        {
          type: "p",
          text: "Leonie R. bekommt mit Christian H. einen Neuling an die Seite. Seinen Einstand in der Liga würde er sicherlich gern mit einem Sieg feiern."
        },
        {
          type: "h",
          text: "Partie 3 - Früher Vogel gegen Langschläfer"
        },
        {
          type: "match",
          matchId: "winter-2026-partie-3",
          text: "Chris M. & Raphael H. vs. Marcel M. & Niklas K.",
          result: "54 : 46 %",
          resultLabel: "Gewinnwahrscheinlichkeit"
        },
        {
          type: "p",
          text: "Auf der einen Seite steht Raphael H., der mit einer durchschnittlichen Anstoßzeit von 9:30 Uhr der früheste Vogel der Liga-Geschichte ist. Auf der anderen Seite steht Niklas K., dessen Partien im Schnitt um 14:36 Uhr beginnen. Wer sich bei der Terminfindung durchsetzt, entscheidet vielleicht schon vor dem ersten Ballwechsel einen Teil der Partie."
        },
        {
          type: "p",
          text: "An deren Seite stehen zwei der Mayr-Brüder. Wessen Partner findet am Ende die bessere Tageszeit?"
        },
        {
          type: "h",
          text: "Partie 4 - Das Neulingsduell"
        },
        {
          type: "match",
          matchId: "winter-2026-partie-4",
          text: "Lisa S. & Lukas P. vs. Marco M. & Lukas T.",
          result: "48 : 52 %",
          resultLabel: "Gewinnwahrscheinlichkeit"
        },
        {
          type: "p",
          text: "Mit Lisa S. und Lukas T. stehen sich zwei der vier Neulinge direkt gegenüber. Beide starten mit einem Elo von 550, und beide wollen zeigen, dass sie in dieser Liga mehr sind als die Neuen. Wer startet besser in die Saison?"
        },
        {
          type: "p",
          text: "An ihrer Seite stehen mit Lukas P. und Marco M. zwei erfahrene Spieler. Die Wahrscheinlichkeit von 48 zu 52 Prozent lässt die Partie weitgehend offen."
        },
        {
          type: "h",
          text: "Partie 5 - Der letzte Platz ist nicht gesetzt"
        },
        {
          type: "match",
          matchId: "winter-2026-partie-5",
          text: "Andreas L. & Yonatan G. vs. Greta P. & Martin B.",
          result: "56 : 44 %",
          resultLabel: "Gewinnwahrscheinlichkeit"
        },
        {
          type: "p",
          text: "Martin B. bringt eine lange Niederlagenserie mit. Der Auto-Tipp sieht ihn zusätzlich am Ende der Saison auf dem letzten Platz. Experten halten das für einen Trugschluss, und nicht wenige trauen ihm wegen des Spielplans sogar einen Platz in den Top 8 zu."
        },
        {
          type: "p",
          text: "Dafür müsste er allerdings Andreas L. und Yonatan G. schlagen. Das Team ist laut Gewinnwahrscheinlichkeit leicht favorisiert. Gelingt Martin B. und Greta P. der erste Schritt gegen die Prognose?"
        },
        {
          type: "h",
          text: "Spieltag 1 - auf einen Blick"
        },
        {
          type: "p",
          text: "Fünf Partien, zwanzig Spieler, noch kein Punkt. Die Rangliste füllt sich mit dem ersten Spieltag im Zeitfenster bis zum 13. November."
        },
        {
          type: "p",
          text: "Wer sich nicht nur auf dem Platz beweisen will, kann bei PadelTipp noch seine Prognosen platzieren. Besonders die sechs Bonustipps lohnen sich, denn jede richtige Antwort bringt vier Punkte. Sie schließen mit Beginn des zweiten Spieltags am 16. November um 00:00 Uhr."
        }
      ]
    },
    {
      spieltag: 2,
      startDate: "2026-11-16",
      endDate: "2026-11-29",
      title: "Einer legt vor, der Rest sucht noch Termine",
      meta: "SPIELTAG 2  ·  16. NOVEMBER - 27. NOVEMBER 2026",
      body: [
        {
          type: "p",
          text: "Der erste Spieltag ist offiziell vorbei, gespielt wurde aber erst eine Partie. Ludwig W. und Florian Z. gewannen das Eröffnungsspiel 6:4, 6:0 gegen Luca W. und Christoph L. Für Florian Z. brachte der Sieg den angekündigten neuen Elo-Höchstwert. Er steht jetzt bei 904 statt zuvor 866."
        },
        {
          type: "p",
          text: "Ludwig W. hat sich damit nicht begnügt. Schon am nächsten Tag gewann er auch seine Partie vom zweiten Spieltag, dazu mehr weiter unten. Nach zwei Siegen führt er die Rangliste an. Mit einem Elo von 1228 ist er außerdem der neue Elo-Erste der Liga, knapp vor Marco M. mit 1199."
        },
        {
          type: "p",
          text: "Der Rest der Liga hängt den Terminen dagegen schon jetzt hinterher. Vier Partien des ersten Spieltags sind noch offen. Einen Termin hat bisher nur Partie 2, nämlich den 19. November."
        },
        {
          type: "h",
          text: "Partie 6 - Ex-Partner auf beiden Seiten"
        },
        {
          type: "match",
          matchId: "winter-2026-partie-6",
          text: "Marcel M. & Christoph L. vs. Greta P. & Luca W.",
          result: "48 : 52 %",
          resultLabel: "Gewinnwahrscheinlichkeit"
        },
        {
          type: "p",
          text: "Vor wenigen Tagen standen Luca W. und Christoph L. noch auf derselben Seite des Netzes. Gemeinsam verloren sie Partie 1. Jetzt stehen sie sich gegenüber: Christoph L. spielt an der Seite von Marcel M., Luca W. mit Greta P."
        },
        {
          type: "p",
          text: "Für Marcel M. ist das keine angenehme Aufgabe. Luca W. ist sein Angstgegner, von drei Partien gegen ihn hat Marcel M. nur eine gewonnen. Die Gewinnwahrscheinlichkeit von 48 zu 52 Prozent sieht Luca W. und Greta P. leicht vorn."
        },
        {
          type: "p",
          text: "Luca W. selbst ist mit der Auslosung alles andere als zufrieden, er fühlt sich bei den Ansetzungen betrogen:"
        },
        {
          type: "quote",
          text: "Ich bin gespannt, ob sich die Korruption wieder verbessert. Hat alles ein Geschmäckle.",
          author: "Luca W"
        },
        {
          type: "p",
          text: "Beweise hat diese Redaktion bislang nicht erhalten. Ein Sieg gegen den Ex-Partner wäre wohl die beste Antwort an die Verschwörung."
        },
        {
          type: "h",
          text: "Partie 7 - Früher Vogel und Langschläfer, jetzt im selben Team"
        },
        {
          type: "match",
          matchId: "winter-2026-partie-7",
          text: "Agnes K. & Lukas P. vs. Niklas K. & Raphael H.",
          result: "40 : 60 %",
          resultLabel: "Gewinnwahrscheinlichkeit"
        },
        {
          type: "p",
          text: "In Partie 3 treffen Raphael H. und Niklas K. noch aufeinander, hier spielen sie zusammen. Beide haben ihr letztes Spiel allerdings deutlich verloren. Raphael H. unterlag 0:6, 0:6, Niklas K. 2:6, 0:6. Gegen Agnes K. und Lukas P. sind sie mit 60 Prozent trotzdem favorisiert. Schaffen die beiden den Turnaround?"
        },
        {
          type: "h",
          text: "Partie 8 - Florian Z. will nachlegen"
        },
        {
          type: "match",
          matchId: "winter-2026-partie-8",
          text: "Florian Z. & Lisa S. vs. Martin B. & Christian H.",
          result: "61 : 39 %",
          resultLabel: "Gewinnwahrscheinlichkeit"
        },
        {
          type: "p",
          text: "Florian Z. ist mit einem Sieg in die Saison gestartet und steht auf Platz zwei. Jetzt will er nachlegen. Mit jedem Sieg würde er seinen gerade erst erreichten Elo-Höchstwert von 904 erneut verbessern. Mit 61 Prozent gehen er und Lisa S. als Favoriten in die Partie."
        },
        {
          type: "h",
          text: "Partie 9 - Bereits gespielt: Der sechste Matchball"
        },
        {
          type: "match",
          matchId: "winter-2026-partie-9",
          text: "Jonas L. & Ludwig W. vs. Andreas L. & Chris M.",
          result: "6:2, 6:3",
          resultLabel: "Ergebnis"
        },
        {
          type: "p",
          text: "Das Ergebnis liest sich klar, das Spiel war es nicht. Jonas L. und Ludwig W. gewannen 6:2, 6:3 gegen Andreas L. und Chris M. Auffällig viele Punkte wurden dabei erst im Golden Point entschieden."
        },
        {
          type: "p",
          text: "Im zweiten Satz hatten Jonas L. und Ludwig W. beim Stand von 5:1 den ersten Matchball. Er saß nicht, die nächsten auch nicht. Andreas L. und Chris M. kamen noch auf 5:3 heran, bevor der sechste Matchball zum 6:3 endlich verwandelt war."
        },
        {
          type: "p",
          text: "Für beide Sieger hat sich die Mühe gelohnt. Ludwig W. erreichte mit 1228 einen neuen Elo-Höchstwert und übernahm die Tabellenführung. Auch Jonas L. steht mit 1028 so hoch wie nie zuvor."
        },
        {
          type: "h",
          text: "Partie 10 - Fünf Siege und leise Töne"
        },
        {
          type: "match",
          matchId: "winter-2026-partie-10",
          text: "Thomas H. & Marco M. vs. Lukas T. & Leonie R.",
          result: "66 : 34 %",
          resultLabel: "Gewinnwahrscheinlichkeit"
        },
        {
          type: "p",
          text: "Marco M. geht mit fünf Siegen in Folge in diese Partie. Den letzten holte er zusammen mit Jonas L. sogar mit 6:0, 6:0. Mit Thomas H. an seiner Seite liegt die Gewinnwahrscheinlichkeit bei 66 Prozent, so deutlich wie bei keiner anderen Partie dieses Spieltags."
        },
        {
          type: "p",
          text: "Auf der anderen Seite stehen Lukas T. und Leonie R. In der Sommersaison war Leonie R. noch für große Ansagen bekannt. Vor ihrem ersten Spiel kündigte sie an: „Ich werde das Turnier gewinnen.“ Später folgte nur noch: „Ich sage gar nichts mehr.“ Diesmal klingt sie vorsichtiger:"
        },
        {
          type: "quote",
          text: "Ich lass alles erstmal auf mich zukommen.",
          author: "Leonie R"
        },
        {
          type: "p",
          text: "Leonie R. scheint aus dem Sommer gelernt zu haben. Gegen die längste Siegesserie des Spieltags ist etwas Zurückhaltung vielleicht auch nicht die schlechteste Idee."
        },
        {
          type: "h",
          text: "Blick auf die Rangliste"
        },
        {
          type: "p",
          text: "Ludwig W. führt mit sechs Punkten aus zwei Spielen und einer Differenz von +15. Dahinter folgen Florian Z. mit +8 und Jonas L. mit +7. Beide haben drei Punkte und ein Spiel weniger."
        },
        {
          type: "p",
          text: "Viel sagt die Tabelle allerdings noch nicht. Vierzehn der zwanzig Spieler haben in dieser Saison noch keine Partie bestritten. Das Spielfenster des zweiten Spieltags läuft bis zum 27. November. Dazu kommen die vier offenen Partien des ersten Spieltags."
        },
        {
          type: "p",
          text: "Es bleibt abzuwarten, wer sich von Anfang an in der oberen Tabellenhälfte und unter den Top 8 positionieren kann."
        }
      ]
    }
  ]
});
