// Das Konto führt auf allen Bildschirmgrößen einen URL-Zustand; „Was ist neu?“ auf dem Handy einen Zurück-Schritt.
// Spielerprofile führen überall einen eigenen Verlaufseintrag und gehören deshalb nicht hierher.
(() => {
  // Eingebettet teilt der Rahmen den Verlauf der Tippseite; dort führt die Tippseite den Zurück-Schritt.
  if (document.documentElement.classList.contains('is-detail-embed')) return;

  const authDialog = document.getElementById('auth-dialog');
  const whatsNewDialog = document.getElementById('whats-new-dialog');
  const pages = [
    { isOpen: () => Boolean(authDialog?.open), close: () => authDialog?.close() },
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
    if (isDetailActive() && !authDialog?.open && !entryId) return;
    const anyOpen = pages.some(page => page.isOpen());
    const accountOpen = Boolean(authDialog?.open);
    if (anyOpen && !entryId && (accountOpen || mobile.matches) && !isAuthLink()) {
      entryId = String(Date.now());
      let url = new URL(window.location.href);
      if (accountOpen) {
        // Direktlinks erhalten denselben Rückweg wie ein auf der Seite geöffnetes Konto.
        if (window.PadelSeasonRouting?.isAccountPath() || url.searchParams.has('konto')) {
          const returnUrl = window.PadelSeasonRouting?.isAccountPath()
            ? window.PadelSeasonRouting.getSeasonUrl(window.PadelSeasonRouting.getRequestedSeasonId(), 'league')
            : new URL(url);
          returnUrl.searchParams.delete('konto');
          window.history.replaceState({ ...window.history.state, mobileDialogPage: null, accountPage: false }, '', returnUrl.href);
        }
        url = window.PadelSeasonRouting.getAccountUrl();
        window.PadelSeasonRouting.ensureDocumentBase(url);
      }
      window.history.replaceState({ ...window.history.state, sectionScrollY: window.scrollY }, '', window.location.href);
      window.history.pushState({ ...window.history.state, mobileDialogPage: entryId, accountPage: accountOpen }, '', url.href);
    } else if (accountOpen && entryId && !window.history.state?.accountPage && !isAuthLink()) {
      const url = window.PadelSeasonRouting.getAccountUrl();
      window.PadelSeasonRouting.ensureDocumentBase(url);
      window.history.replaceState({ ...window.history.state, accountPage: true }, '', url.href);
    } else if (!anyOpen && entryId) {
      // Hat ein Folgeziel wie ein Spielerprofil den Eintrag übernommen, bleibt dessen Zurück-Schritt erhalten.
      const ownsCurrentEntry = window.history.state?.mobileDialogPage === entryId;
      entryId = null;
      if (ownsCurrentEntry) window.history.back();
    }
  }

  [authDialog, whatsNewDialog].filter(Boolean).forEach(dialog => {
    new MutationObserver(sync).observe(dialog, { attributes: true, attributeFilter: ['open'] });
  });
  window.addEventListener('popstate', () => {
    if (window.history.state?.accountPage && window.PadelSeasonRouting.isAccountRequested()) {
      entryId = window.history.state.mobileDialogPage;
      if (!authDialog?.open) window.PadelKonto?.openDialog();
    } else if (entryId && window.history.state?.mobileDialogPage !== entryId) {
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
