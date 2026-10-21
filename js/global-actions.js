(function () {
  const mobileViewport = window.matchMedia('(max-width: 768px)');
  const roots = [...document.querySelectorAll('[data-global-actions]')];
  let accountTaskCount = 0;
  let liveActive = false;
  const viewerPicker = document.getElementById('viewer-picker');
  const viewerHome = viewerPicker?.parentElement;

  function getToggle(root) {
    return root.querySelector('[data-global-actions-toggle]');
  }

  function getList(root) {
    return root.querySelector('[data-global-actions-list]');
  }

  function setListInteractive(root, interactive) {
    const list = getList(root);
    if (!list) return;
    list.setAttribute('aria-hidden', String(!interactive));
    list.toggleAttribute('inert', !interactive);
  }

  function closeSeasonMenu(root) {
    const picker = root.querySelector('.season-picker');
    if (!picker) return;
    picker.classList.remove('open');
    picker.querySelector('[data-season-toggle]')?.setAttribute('aria-expanded', 'false');
  }

  function close(root, { restoreFocus = false } = {}) {
    if (!root?.classList.contains('open')) return;
    root.classList.remove('open');
    getToggle(root)?.setAttribute('aria-expanded', 'false');
    closeSeasonMenu(root);
    if (root.contains(viewerPicker)) window.closeViewerMenu?.();
    if (mobileViewport.matches) setListInteractive(root, false);
    renderRootState(root);
    if (restoreFocus) getToggle(root)?.focus({ preventScroll: true });
  }

  function closeAll(options = {}) {
    roots.forEach(root => close(root, options));
  }

  function open(root) {
    closeAll();
    root.classList.add('open');
    const toggle = getToggle(root);
    toggle?.setAttribute('aria-expanded', 'true');
    toggle?.setAttribute('aria-label', 'Schnellzugriffe schließen');
    setListInteractive(root, true);
    const firstAction = [...root.querySelectorAll('[data-global-action]')]
      .find(action => !action.hidden && action.getAttribute('aria-hidden') !== 'true');
    window.requestAnimationFrame(() => firstAction?.focus({ preventScroll: true }));
  }

  function renderRootState(root) {
    const rootHasLiveAction = Boolean(root.querySelector('[data-live-open-active]'));
    const hasLive = rootHasLiveAction && liveActive;
    const hasAccountTasks = accountTaskCount > 0;
    const toggle = getToggle(root);
    const badge = root.querySelector('[data-global-actions-badge]');

    root.classList.toggle('has-live', hasLive);
    root.classList.toggle('has-account-tasks', hasAccountTasks);
    if (!toggle || !badge) return;

    if (hasLive) {
      badge.hidden = false;
      badge.textContent = '1';
      toggle.setAttribute('aria-label', 'Schnellzugriffe öffnen. Ein Livespiel läuft.');
      return;
    }
    if (hasAccountTasks) {
      badge.hidden = false;
      badge.textContent = String(accountTaskCount);
      toggle.setAttribute('aria-label', `Schnellzugriffe öffnen. ${accountTaskCount} ${accountTaskCount === 1 ? 'Kontoaufgabe' : 'Kontoaufgaben'}.`);
      return;
    }

    badge.hidden = true;
    badge.textContent = '';
    toggle.setAttribute('aria-label', 'Schnellzugriffe öffnen');
  }

  function syncViewport() {
    roots.forEach(root => {
      if (viewerPicker && viewerHome) {
        if (mobileViewport.matches) {
          const account = getList(root)?.querySelector('[data-auth-open]');
          if (account) account.before(viewerPicker);
        } else {
          window.closeViewerMenu?.();
          viewerHome.append(viewerPicker);
        }
      }
      if (mobileViewport.matches) {
        setListInteractive(root, root.classList.contains('open'));
      } else {
        close(root);
        setListInteractive(root, true);
      }
    });
    syncVisualViewport();
  }

  function syncVisualViewport() {
    const viewport = window.visualViewport;
    const height = viewport?.height || window.innerHeight;
    const bottom = viewport ? Math.max(0, window.innerHeight - height - viewport.offsetTop) : 0;
    roots.forEach(root => {
      root.style.setProperty('--global-actions-viewport-height', `${height}px`);
      root.style.setProperty('--global-actions-keyboard-offset', `${bottom}px`);
    });
  }

  document.addEventListener('click', event => {
    const toggle = event.target.closest('[data-global-actions-toggle]');
    if (toggle) {
      const root = toggle.closest('[data-global-actions]');
      if (!root || !mobileViewport.matches) return;
      if (root.classList.contains('open')) close(root, { restoreFocus: true });
      else open(root);
      return;
    }

    const dismiss = event.target.closest('[data-global-actions-dismiss]');
    if (dismiss) {
      close(dismiss.closest('[data-global-actions]'), { restoreFocus: true });
      return;
    }

    const action = event.target.closest('[data-global-action-close]');
    if (action) close(action.closest('[data-global-actions]'));

    const seasonOption = event.target.closest('[data-global-actions] [data-season-id]');
    if (seasonOption) close(seasonOption.closest('[data-global-actions]'));
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !mobileViewport.matches) return;
    const openRoot = roots.find(root => root.classList.contains('open'));
    if (!openRoot) return;
    // Let the app close an active picker first, keeping focus inside the dial.
    if (openRoot.querySelector('.viewer-picker.open, .season-picker.open')) return;
    event.preventDefault();
    close(openRoot, { restoreFocus: true });
  });

  mobileViewport.addEventListener?.('change', syncViewport);
  window.visualViewport?.addEventListener('resize', syncVisualViewport);
  window.visualViewport?.addEventListener('scroll', syncVisualViewport);
  window.addEventListener('resize', syncVisualViewport);
  roots.forEach(renderRootState);
  syncViewport();

  window.PadelGlobalActions = {
    close: closeAll,
    setAccountTaskCount(count = 0) {
      accountTaskCount = Math.max(0, Number(count) || 0);
      roots.forEach(renderRootState);
    },
    setLiveActive(active = false) {
      liveActive = Boolean(active);
      roots.forEach(renderRootState);
    }
  };
})();
