(() => {
  'use strict';

  const racketUrl = new URL('../assets/cursors/racket.svg', document.currentScript.src).href;
  const regions = [...document.querySelectorAll('[data-padel-loading]')].map(host => ({ host, timer: null, overlay: null }));
  let queued = false;

  function isLoading(host) {
    return host.getAttribute('aria-busy') === 'true'
      || (host.id === 'player-profile-state' && !host.hidden && Boolean(host.querySelector('.player-profile-skeleton')));
  }

  function visibleBounds(host) {
    const rect = host.getBoundingClientRect();
    const bounds = { left: Math.max(0, rect.left), right: Math.min(innerWidth, rect.right), top: Math.max(0, rect.top), bottom: Math.min(innerHeight, rect.bottom) };
    if (!host.getClientRects().length) return null;
    for (let parent = host.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden') return null;
      const box = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        bounds.top = Math.max(bounds.top, box.top);
        bounds.bottom = Math.min(bounds.bottom, box.bottom);
      }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        bounds.left = Math.max(bounds.left, box.left);
        bounds.right = Math.min(bounds.right, box.right);
      }
    }
    return bounds.right > bounds.left && bounds.bottom > bounds.top ? { rect, ...bounds } : null;
  }

  function position(region) {
    const bounds = visibleBounds(region.host);
    if (!bounds) return;
    region.overlay.style.left = `${(bounds.left + bounds.right) / 2 - bounds.rect.left + region.host.scrollLeft}px`;
    region.overlay.style.top = `${(bounds.top + bounds.bottom) / 2 - bounds.rect.top + region.host.scrollTop}px`;
  }

  function stop(region) {
    clearTimeout(region.timer);
    region.timer = null;
    region.overlay?.remove();
    region.overlay = null;
    region.host.classList.remove('has-padel-loader');
  }

  function refresh() {
    queued = false;
    for (const region of regions) {
      if (!isLoading(region.host) || !visibleBounds(region.host)) {
        if (region.timer !== null || region.overlay) stop(region);
        continue;
      }
      // Replacing the skeleton also removes its loader. Start a fresh delay for the new request.
      if (region.overlay && !region.overlay.isConnected) stop(region);
      if (region.overlay) { position(region); continue; }
      if (region.timer !== null) continue;
      region.timer = setTimeout(() => {
        region.timer = null;
        if (!isLoading(region.host) || !visibleBounds(region.host)) return;
        const overlay = document.createElement('div');
        overlay.className = 'padel-loader';
        overlay.setAttribute('aria-hidden', 'true');
        const racket = document.createElement('img');
        racket.className = 'padel-loader-racket';
        racket.src = racketUrl;
        racket.alt = '';
        const ball = document.createElement('div');
        ball.className = 'padel-loader-ball';
        overlay.append(racket, ball);
        region.overlay = overlay;
        region.host.append(overlay);
        region.host.classList.add('has-padel-loader');
        position(region);
      }, 400);
    }
  }

  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(refresh);
  }

  const observer = new MutationObserver(schedule);
  const resizeObserver = new ResizeObserver(schedule);
  for (const { host } of regions) {
    observer.observe(host, { attributes: true, attributeFilter: ['aria-busy', 'hidden', 'class'], childList: true, subtree: true });
    const dialog = host.closest('dialog');
    if (dialog) observer.observe(dialog, { attributes: true, attributeFilter: ['open', 'class', 'hidden'] });
    resizeObserver.observe(host);
  }
  window.addEventListener('scroll', schedule, { capture: true, passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  refresh();
})();
