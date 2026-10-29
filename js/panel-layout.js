// Gemeinsame Regeln für Seitenpanels auf PadelLiga und PadelTipp: Breiten, Platzprüfung, Panelposition und gespeicherte Darstellungswahl.
(function (global) {
  const PANEL_STICKY_TOP = 78;
  const PANEL_BOTTOM_GUTTER = 16;
  const PANEL_HOST_SELECTOR = '.ranking-profile-host, .match-statistics-panel-host';
  const PANEL_BREAKPOINT = 1100;
  const PANEL_GAP = 24;
  const PANEL_OUTER_GUTTER = 16;
  const CONTENT_MAX_WIDTH = 1100;
  const PRESENTATION_STORAGE_TTL = 30 * 24 * 60 * 60 * 1000;
  // Breite der Liste links und Mindestbreite des Panels rechts je Ansicht.
  const layouts = Object.freeze({
    matchList: Object.freeze({ listWidth: 420, panelMinWidth: 600 }),
    ranking: Object.freeze({ listWidth: 540, panelMinWidth: 460 }),
    allTimeRanking: Object.freeze({ listWidth: 720, panelMinWidth: 460 })
  });

  function getPanelHostHeight(viewportHeight, hostTop) {
    const top = Math.max(PANEL_STICKY_TOP, Number(hostTop) || 0);
    return Math.max(0, Math.floor((Number(viewportHeight) || 0) - top - PANEL_BOTTOM_GUTTER));
  }

  function readViewport() {
    return {
      innerWidth: global.innerWidth,
      clientWidth: global.document.documentElement.clientWidth || global.innerWidth
    };
  }

  function getRequiredWidth(layout) {
    return layout.listWidth + PANEL_GAP + layout.panelMinWidth;
  }

  // listLeft ist der linke Rand der Liste; ohne Angabe beginnt sie am äußeren Seitenrand.
  function hasPanelSpace(layout, { viewport = readViewport(), listLeft = PANEL_OUTER_GUTTER } = {}) {
    return viewport.innerWidth >= PANEL_BREAKPOINT
      && viewport.clientWidth - listLeft - PANEL_OUTER_GUTTER >= getRequiredWidth(layout);
  }

  // Die Liste bleibt an ihrer normalen Inhaltsposition, bis das Panel sonst nicht mehr passt.
  function getSplitLeft(layout, viewport = readViewport()) {
    const viewportWidth = viewport.clientWidth;
    const standardContentLeft = viewportWidth > CONTENT_MAX_WIDTH
      ? (viewportWidth - CONTENT_MAX_WIDTH) / 2 + PANEL_OUTER_GUTTER
      : PANEL_OUTER_GUTTER;
    const latestPossibleLeft = viewportWidth - PANEL_OUTER_GUTTER - getRequiredWidth(layout);
    return Math.max(0, Math.min(standardContentLeft, latestPossibleLeft));
  }

  function applySplitLeft(layout, property) {
    global.document.body.style.setProperty(property, `${getSplitLeft(layout)}px`);
  }

  // Panel oder Vollbild bleibt 30 Tage gespeichert; ungültige oder abgelaufene Werte werden entfernt.
  function createPresentationPreference(storageKey, {
    storage = () => global.localStorage,
    now = () => Date.now()
  } = {}) {
    function clear() {
      try {
        storage().removeItem(storageKey);
      } catch (error) {
        // Ignore inaccessible browser storage.
      }
    }
    return Object.freeze({
      get() {
        try {
          const stored = JSON.parse(storage().getItem(storageKey) || 'null');
          if (!['panel', 'modal'].includes(stored?.presentation)
            || !Number.isFinite(stored?.expiresAt)
            || stored.expiresAt <= now()) {
            clear();
            return null;
          }
          return stored.presentation;
        } catch (error) {
          clear();
          return null;
        }
      },
      set(presentation) {
        if (!['panel', 'modal'].includes(presentation)) return;
        try {
          storage().setItem(storageKey, JSON.stringify({
            presentation,
            expiresAt: now() + PRESENTATION_STORAGE_TTL
          }));
        } catch (error) {
          // The toggle still works for the current view if browser storage is blocked.
        }
      }
    });
  }

  const api = {
    PANEL_BREAKPOINT,
    PRESENTATION_STORAGE_TTL,
    layouts,
    getPanelHostHeight,
    hasPanelSpace,
    getSplitLeft,
    createPresentationPreference
  };
  if (typeof module !== 'undefined') module.exports = api;
  if (!global?.document) return;

  let updateFrame = 0;

  function updateNow() {
    updateFrame = 0;
    const viewportHeight = global.innerHeight || global.document.documentElement.clientHeight;
    global.document.querySelectorAll(PANEL_HOST_SELECTOR).forEach(host => {
      const height = getPanelHostHeight(viewportHeight, host.getBoundingClientRect().top);
      host.style.setProperty('--panel-host-height', `${height}px`);
    });
  }

  function update() {
    if (updateFrame) return;
    updateFrame = global.requestAnimationFrame(updateNow);
  }

  global.addEventListener('scroll', update, { passive: true });
  global.addEventListener('resize', update);
  global.visualViewport?.addEventListener('resize', update);
  global.addEventListener('pageshow', update);
  new MutationObserver(update).observe(global.document.body, {
    attributes: true,
    attributeFilter: ['class', 'data-player-profile-panel-context']
  });

  global.PadelLigaPanelLayout = Object.freeze({ ...api, applySplitLeft, update, updateNow });
  update();
})(typeof window !== 'undefined' ? window : null);
