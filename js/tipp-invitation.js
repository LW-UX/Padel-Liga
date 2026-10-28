/* Einmaliger PadelTipp-Hinweis beim ersten regulären Liga-Aufruf. */
(function () {
  'use strict';

  const STORAGE_KEY = 'padel-liga:tipp-invitation-seen';
  const INVITATION_ID = 'winter-2026';
  let shownThisPage = false;

  function hasSeenInvitation() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === INVITATION_ID;
    } catch {
      return false;
    }
  }

  function markInvitationSeen() {
    try {
      window.localStorage.setItem(STORAGE_KEY, INVITATION_ID);
    } catch {
      // Ohne verfügbaren Speicher bleibt der Hinweis nur für diesen Seitenaufruf ausgeblendet.
    }
  }

  function isDirectDetailView() {
    const params = new URLSearchParams(window.location.search);
    return document.documentElement.classList.contains('is-detail-embed')
      || ['partie', 'live', 'spielerprofil'].some(parameter => params.has(parameter));
  }

  function closeInvitation(dialog) {
    markInvitationSeen();
    if (dialog.open) dialog.close();
  }

  function showInvitation(event) {
    const dialog = document.getElementById('tipp-invitation-dialog');
    if (!dialog || shownThisPage || !event.detail?.predictionsEnabled || isDirectDetailView() || hasSeenInvitation()) return;

    const tippLink = dialog.querySelector('[data-tipp-invitation-link]');
    if (tippLink && event.detail.tippHref) tippLink.dataset.href = event.detail.tippHref;

    shownThisPage = true;
    dialog.showModal();

    dialog.addEventListener('click', clickEvent => {
      if (clickEvent.target === dialog || clickEvent.target.closest('[data-tipp-invitation-close]')) {
        closeInvitation(dialog);
      }
    });
    dialog.addEventListener('cancel', () => markInvitationSeen());
    tippLink?.addEventListener('click', () => {
      markInvitationSeen();
      window.location.assign(tippLink.dataset.href || 'tipp/');
    });
  }

  window.addEventListener('padel:season-ready', showInvitation);
})();
