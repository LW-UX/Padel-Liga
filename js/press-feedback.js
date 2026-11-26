(() => {
  const controls = ':is(button, a[href]):is(.primary-button, .secondary-button, .danger-button, .global-actions-toggle, .viewer-profile-button, .text-link), .player-profile-link';
  const excluded = ':disabled, [aria-disabled="true"], .site-nav, .toggle, .auth-mode-toggle, .site-search-filters';
  const presses = new Map();

  // Touch-Browser setzen :active teils erst beim Loslassen eines Taps.
  document.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || (event.pointerType !== 'touch' && event.pointerType !== 'pen')) return;
    const control = event.target.closest(controls);
    if (!control || control.closest(excluded)) return;
    presses.set(event.pointerId, control);
    control.classList.add('is-pressing');
  }, { capture: true, passive: true });

  function release(event) {
    const control = presses.get(event.pointerId);
    if (!control) return;
    presses.delete(event.pointerId);
    control.classList.remove('is-pressing');
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    document.addEventListener(type, release, { capture: true, passive: true });
  }
})();
