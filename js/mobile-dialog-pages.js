// Konto, Spielerprofil und „Was ist neu?“ wirken auf dem Handy wie eigene Seiten; die Zurück-Geste schließt sie deshalb auch wie eine Seite.
(() => {
  // Eingebettet teilt der Rahmen den Verlauf der Tippseite; dort führt die Tippseite den Zurück-Schritt.
  if (document.documentElement.classList.contains('is-detail-embed')) return;

  const authDialog = document.getElementById('auth-dialog');
  const profileDialog = document.getElementById('player-profile-dialog');
  const whatsNewDialog = document.getElementById('whats-new-dialog');
  const pages = [
    { isOpen: () => Boolean(authDialog?.open), close: () => authDialog?.close() },
    { isOpen: () => Boolean(profileDialog?.open), close: () => window.PadelLigaClosePlayerProfile?.({ fromHistory: true }) },
    { isOpen: () => Boolean(whatsNewDialog?.open), close: () => whatsNewDialog?.close() }
  ];
  const mobile = window.matchMedia('(max-width: 768px)');
  let entryId = null;

  // Partie- und Liveansicht führen einen eigenen Verlauf; darüber geöffnete Profile gehören zu deren Eintrag.
  const isDetailActive = () => Boolean(
    window.PadelMatchStatistics?.active || document.getElementById('detail-view-dialog')?.open
  );
  // Einmal-Links dürfen nicht über einen Zurück-Schritt wieder in der Adresszeile landen.
  const isAuthLink = () => {
    const params = new URLSearchParams(window.location.search);
    return params.has('auth') || params.has('confirmation_url');
  };

  function sync() {
    if (isDetailActive()) return;
    const anyOpen = pages.some(page => page.isOpen());
    if (anyOpen && !entryId && mobile.matches && !isAuthLink()) {
      entryId = String(Date.now());
      window.history.pushState({ ...window.history.state, mobileDialogPage: entryId }, '', window.location.href);
    } else if (!anyOpen && entryId) {
      entryId = null;
      window.history.back();
    }
  }

  [authDialog, profileDialog, whatsNewDialog].filter(Boolean).forEach(dialog => {
    new MutationObserver(sync).observe(dialog, { attributes: true, attributeFilter: ['open'] });
  });
  window.addEventListener('popstate', () => {
    if (entryId && window.history.state?.mobileDialogPage !== entryId) {
      entryId = null;
      pages.forEach(page => page.close());
    }
    // Erst nach den übrigen Verlaufs-Handlern steht fest, ob noch etwas offen ist.
    setTimeout(sync);
  });

  window.PadelMobileDialogPages = {
    // close muss die Seite sofort schließen, sonst legt der Abgleich den Zurück-Schritt erneut an.
    register: page => pages.push(page),
    sync
  };
})();
