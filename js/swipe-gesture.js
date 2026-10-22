/* Horizontale Wischgeste mit bewusst strengen Schwellen, damit vertikales Scrollen nichts auslöst. */
(function () {
  'use strict';
  const MIN_DISTANCE = 50;
  const MIN_WIDTH_SHARE = 0.15;
  const MAX_DURATION = 1500;
  const DIRECTION_RATIO = 2;
  const EDGE_GUARD = 24;
  const ignoredTargets = 'input, select, textarea, canvas, [contenteditable], [data-no-swipe]';

  function hasHorizontalScrollAncestor(element, boundary) {
    for (let node = element; node && node !== boundary; node = node.parentElement) {
      if (node.scrollWidth <= node.clientWidth + 1) continue;
      const overflowX = getComputedStyle(node).overflowX;
      if (overflowX === 'auto' || overflowX === 'scroll') return true;
    }
    return false;
  }

  // onSwipe erhält 1 für Wischen nach links (nächstes Ziel) und -1 für Wischen nach rechts.
  function attach(area, { enabled = () => true, onSwipe }) {
    if (!area) return;
    let swipe = null;

    area.addEventListener('touchstart', event => {
      swipe = null;
      if (!enabled() || event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (touch.clientX < EDGE_GUARD || touch.clientX > window.innerWidth - EDGE_GUARD) return;
      if (event.target.closest(ignoredTargets)) return;
      if (hasHorizontalScrollAncestor(event.target, area)) return;
      swipe = { x: touch.clientX, y: touch.clientY, time: Date.now(), cancelled: false };
    }, { passive: true });

    area.addEventListener('touchmove', event => {
      if (!swipe || swipe.cancelled) return;
      const touch = event.touches[0];
      const dx = Math.abs(touch.clientX - swipe.x);
      const dy = Math.abs(touch.clientY - swipe.y);
      // Sobald die Bewegung erkennbar vertikal ist, gilt die Geste als Scrollen.
      if (dy > 12 && dy * 1.2 > dx) swipe.cancelled = true;
    }, { passive: true });

    area.addEventListener('touchend', event => {
      const current = swipe;
      swipe = null;
      if (!current || current.cancelled || event.changedTouches.length !== 1) return;
      if (Date.now() - current.time > MAX_DURATION) return;
      if (window.getSelection?.()?.toString()) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - current.x;
      const dy = touch.clientY - current.y;
      const minDistance = Math.max(MIN_DISTANCE, window.innerWidth * MIN_WIDTH_SHARE);
      if (Math.abs(dx) < minDistance || Math.abs(dx) < Math.abs(dy) * DIRECTION_RATIO) return;
      onSwipe(dx < 0 ? 1 : -1);
    }, { passive: true });

    area.addEventListener('touchcancel', () => {
      swipe = null;
    }, { passive: true });
  }

  function animateIn(element, step) {
    if (!element) return;
    element.classList.remove('swipe-in-from-left', 'swipe-in-from-right');
    void element.offsetWidth;
    element.classList.add(step > 0 ? 'swipe-in-from-right' : 'swipe-in-from-left');
    const finish = event => {
      if (event.target !== element) return;
      element.classList.remove('swipe-in-from-left', 'swipe-in-from-right');
      element.removeEventListener('animationend', finish);
    };
    element.addEventListener('animationend', finish);
  }

  window.PadelSwipeGesture = { attach, animateIn };
})();
