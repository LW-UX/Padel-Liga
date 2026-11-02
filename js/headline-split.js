// Artikeltitel in zwei Hälften teilen: einzeilig nach Wörtern, mehrzeilig nach Zeilen.
// Die erste Hälfte bekommt .article-title-start; die Farbe setzt das jeweilige Branding.
(function () {
  const SELECTOR = '.article-card h2';

  function lineTops(words) {
    const tops = [];
    words.forEach(word => {
      const top = Math.round(word.getBoundingClientRect().top);
      if (!tops.length || Math.abs(tops[tops.length - 1] - top) > 2) tops.push(top);
    });
    return tops;
  }

  function update(heading) {
    const words = Array.from(heading.querySelectorAll('.article-title-word'));
    if (words.length < 2 || !heading.getClientRects().length) return;
    const tops = lineTops(words);
    let firstEnd;
    if (tops.length < 2) {
      firstEnd = Math.ceil(words.length / 2);
    } else {
      const firstEndLine = tops[Math.floor(tops.length / 2)];
      firstEnd = words.findIndex(word => Math.round(word.getBoundingClientRect().top) >= firstEndLine - 2);
    }
    words.forEach((word, index) => word.classList.toggle('article-title-start', index < firstEnd));
  }

  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(entries => entries.forEach(entry => update(entry.target)))
    : null;

  function prepare(heading) {
    if (heading.dataset.titleSplit) return;
    heading.dataset.titleSplit = 'true';
    const words = heading.textContent.trim().split(/\s+/);
    heading.textContent = '';
    words.forEach((text, index) => {
      if (index) heading.append(' ');
      const word = document.createElement('span');
      word.className = 'article-title-word';
      word.textContent = text;
      heading.append(word);
    });
    update(heading);
    if (resizeObserver) resizeObserver.observe(heading);
  }

  function scan(root) {
    if (root.matches?.(SELECTOR)) prepare(root);
    root.querySelectorAll?.(SELECTOR).forEach(prepare);
  }

  new MutationObserver(records => {
    records.forEach(record => record.addedNodes.forEach(node => {
      if (node.nodeType === 1) scan(node);
    }));
  }).observe(document.documentElement, { childList: true, subtree: true });

  scan(document);
  document.fonts?.ready.then(() => document.querySelectorAll(SELECTOR).forEach(update));
  window.addEventListener('resize', () => document.querySelectorAll(SELECTOR).forEach(update));
})();
