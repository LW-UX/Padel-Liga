// Admins können auf ihrem Gerät ein anderes Branding als Vorschau einschalten; alle anderen sehen
// das mit tools/apply-branding.mjs veröffentlichte Branding. Ein kleines Inline-Skript im Seitenkopf
// schaltet die gespeicherte Auswahl schon vor dem ersten Zeichnen ein und merkt sich den ursprünglichen Link.
// Die Farben je Branding dienen nur der Webseiten-Skizze auf den Designkarten im Konto und müssen zur Branding-Datei passen.
(function () {
  var STORAGE_KEY = 'padel-branding-preview';
  var BRANDINGS = [
    {
      name: 'og-design',
      label: 'OG-Design',
      colors: { bg: '#07080C', surface: '#131620', border: '#343C4E', text: '#F3F4F1', dim: '#B9BBC2', accent: '#d4f53a' }
    },
    {
      name: 'hanako-leben',
      label: 'Hanako Leben',
      colors: { bg: '#F7F4EE', surface: '#FFFFFF', border: '#E6E1D7', text: '#14303D', dim: '#4F6670', accent: '#397a98' }
    },
    {
      name: 'headsquare',
      label: 'Headsquare',
      colors: { bg: '#0A0B1A', surface: '#121426', border: '#43465E', text: '#FFFFFF', dim: '#E3E3E3', accent: '#FF0000' }
    }
  ];

  var link = document.querySelector('link[rel="stylesheet"][href*="branding/"]');
  var publishedHref = link && (link.dataset.publishedHref || link.getAttribute('href'));
  var match = publishedHref && publishedHref.match(/^(.*branding\/)([a-z0-9-]+)\.css/);
  if (!match) return;
  var basePath = match[1];
  var publishedName = match[2];
  var themeColor = document.querySelector('meta[name="theme-color"]');
  var publishedThemeColor = themeColor && themeColor.getAttribute('content');

  function isKnown(name) {
    return BRANDINGS.some(function (branding) { return branding.name === name; });
  }

  function readStored() {
    try { return window.localStorage.getItem(STORAGE_KEY); } catch (error) { return null; }
  }

  function writeStored(name) {
    try {
      if (name === publishedName) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, name);
    } catch (error) { /* Ohne Speicher gilt die Vorschau nur bis zum Neuladen. */ }
  }

  function apply(name) {
    var target = isKnown(name) ? name : publishedName;
    var href = target === publishedName ? publishedHref : basePath + target + '.css';
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
    if (!themeColor) return;
    if (target === publishedName) {
      themeColor.setAttribute('content', publishedThemeColor);
      return;
    }
    var colors = BRANDINGS.filter(function (branding) { return branding.name === target; })[0].colors;
    themeColor.setAttribute('content', colors.bg);
  }

  function readCurrent() {
    return isKnown(readStored()) ? readStored() : publishedName;
  }

  // Skripte, die Branding-Werte einmalig auslesen (etwa Diagramme), zeichnen nach diesem Ereignis neu.
  // Es folgt erst auf das Laden des Stylesheets, weil die neuen Werte vorher noch nicht gelten.
  link.addEventListener('load', function () {
    window.dispatchEvent(new CustomEvent('padel:branding-change'));
  });

  // Andere Tabs und die eingebettete Detailansicht der Tippseite folgen der Auswahl ohne Neuladen.
  window.addEventListener('storage', function (event) {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    current = readCurrent();
    apply(current);
  });

  var current = readCurrent();
  apply(current);

  window.PadelBrandingPreview = {
    brandings: BRANDINGS,
    publishedName: publishedName,
    current: function () { return current; },
    select: function (name) {
      current = isKnown(name) ? name : publishedName;
      writeStored(current);
      apply(current);
    },
    reset: function () {
      if (current === publishedName && !readStored()) return;
      this.select(publishedName);
    }
  };
})();
