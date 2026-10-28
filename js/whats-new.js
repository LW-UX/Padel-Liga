/* Release-Notes-Dialog „Was ist neu?“ mit einem Hinweispunkt, bis die aktuelle Ausgabe einmal geöffnet wurde. */
(function () {
  'use strict';
  // Bei neuen Release Notes ändern, damit der Hinweispunkt wieder erscheint.
  const RELEASE_ID = '2026-10-version-2-0';
  const STORAGE_KEY = 'padel-liga:whats-new-seen';
  // Start des zweiten Spieltags Winter 2026 (lokale Mitternacht); ab dann bleibt der Button ausgeblendet.
  const HIDE_FROM = new Date(2026, 10, 16);

  function readSeenRelease() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function markReleaseSeen() {
    try {
      window.localStorage.setItem(STORAGE_KEY, RELEASE_ID);
    } catch {
      // Ohne Speicher erscheint der Hinweispunkt beim nächsten Laden erneut.
    }
  }

  function openFeatureTarget(target) {
    if (target === 'matches') {
      document.getElementById('partien-nav-button')?.click();
      return;
    }
    if (target === 'account') {
      document.getElementById('auth-button')?.click();
      return;
    }
    if (target === 'tipping') {
      window.location.assign(new URL('tipp/', document.baseURI));
      return;
    }
    if (target === 'player-profile') {
      const profileButton = document.getElementById('viewer-profile-button');
      if (profileButton?.dataset.playerProfileId) {
        profileButton.click();
      } else {
        document.querySelector('[data-viewer-toggle]')?.click();
      }
    }
  }

  function init() {
    const button = document.getElementById('whats-new-button');
    const dialog = document.getElementById('whats-new-dialog');
    if (!button || !dialog || new Date() >= HIDE_FROM) return;

    button.hidden = false;
    button.classList.toggle('is-unseen', readSeenRelease() !== RELEASE_ID);
    button.addEventListener('click', () => {
      if (!dialog.open) dialog.showModal();
      markReleaseSeen();
      button.classList.remove('is-unseen');
    });
    dialog.addEventListener('click', event => {
      const featureLink = event.target.closest('[data-whats-new-target]');
      if (featureLink) {
        dialog.close();
        openFeatureTarget(featureLink.dataset.whatsNewTarget);
        return;
      }
      if (event.target === dialog || event.target.closest('[data-whats-new-close]')) dialog.close();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
