(function (global) {
  const PANEL_STICKY_TOP = 78;
  const PANEL_BOTTOM_GUTTER = 16;
  const PANEL_HOST_SELECTOR = '.ranking-profile-host, .match-statistics-panel-host';

  function getPanelHostHeight(viewportHeight, hostTop) {
    const top = Math.max(PANEL_STICKY_TOP, Number(hostTop) || 0);
    return Math.max(0, Math.floor((Number(viewportHeight) || 0) - top - PANEL_BOTTOM_GUTTER));
  }

  const api = { getPanelHostHeight };
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

  global.PadelLigaPanelLayout = Object.freeze({ update, updateNow, getPanelHostHeight });
  update();
})(typeof window !== 'undefined' ? window : null);
