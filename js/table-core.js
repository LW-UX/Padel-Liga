// Gemeinsame Bausteine der Ranglisten-Tabellen. Die Tippseite lädt app.js nicht, deshalb stehen sie in einer eigenen Datei.
(function () {
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[character]);
  }

  // Diese Attribute machen eine ganze Zeile zum Profil-Link; Cursor und gelber Hover hängen in style.css daran.
  function renderPlayerProfileRowAttributes(player) {
    if (!player?.id || !player.name) return '';
    return ` data-player-profile-id="${escapeHtml(player.id)}" tabindex="0" role="link" aria-label="Profil von ${escapeHtml(player.name)} öffnen"`;
  }

  function updateSortHeaders(buttonSelector, datasetKey, activeMode, direction = 'descending') {
    if (!document.querySelectorAll) return;
    document.querySelectorAll(buttonSelector).forEach(button => {
      const header = button.closest('th');
      if (!header) return;
      if (button.dataset[datasetKey] === activeMode) {
        header.setAttribute('aria-sort', direction);
      } else {
        header.removeAttribute('aria-sort');
      }
    });
  }

  function getRankingRowPositions(container, rowSelector, entryDatasetKey = 'rankingEntry') {
    if (!container?.querySelectorAll) return null;

    return new Map([...container.querySelectorAll(rowSelector)]
      .map(row => [row.dataset[entryDatasetKey], row.getBoundingClientRect().top])
      .filter(([entryId, top]) => entryId && Number.isFinite(top)));
  }

  function animateRankingRows(container, rowSelector, previousPositions, entryDatasetKey = 'rankingEntry') {
    if (!container?.querySelectorAll || !previousPositions?.size) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    container.querySelectorAll(rowSelector).forEach(row => {
      const previousTop = previousPositions.get(row.dataset[entryDatasetKey]);
      if (!Number.isFinite(previousTop)) return;

      const currentTop = row.getBoundingClientRect().top;
      const deltaY = previousTop - currentTop;
      if (Math.abs(deltaY) < 1) return;

      row.style.transition = 'none';
      row.style.transform = `translateY(${deltaY}px)`;
      row.getBoundingClientRect();

      requestAnimationFrame(() => {
        row.style.transition = 'transform 520ms cubic-bezier(0.2, 0.8, 0.2, 1)';
        row.style.transform = 'translateY(0)';

        window.setTimeout(() => {
          row.style.transition = '';
          row.style.transform = '';
        }, 540);
      });
    });
  }

  function getDeltaClass(value) {
    return value > 0 ? 'pos' : value < 0 ? 'neg' : 'neu';
  }

  function formatStatDiff(diff) {
    if (!Number.isFinite(diff)) return '—';
    return diff > 0 ? `+${diff}` : `${diff}`;
  }

  // Inhalt der Spalte col-diff.
  function renderDiffValue(diff, { played = true } = {}) {
    if (!played) return '<span class="neu">—</span>';
    return `<span class="${getDeltaClass(diff)}">${formatStatDiff(diff)}</span>`;
  }

  const api = Object.freeze({
    renderPlayerProfileRowAttributes,
    updateSortHeaders,
    getRankingRowPositions,
    animateRankingRows,
    getDeltaClass,
    formatStatDiff,
    renderDiffValue
  });
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.PadelTable = api;
}());
