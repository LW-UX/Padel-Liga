(function () {
  // Spielernamen wie „Luca W.“ brechen nie zwischen Vorname und Nachnamenkürzel um:
  // Das Leerzeichen davor wird in allen angezeigten Texten zu einem geschützten Leerzeichen.
  const NAME_SPACE = /(\p{L}) (\p{Lu}\.)(?!\p{L})/gu;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT']);

  function protect(text) {
    return String(text ?? '').replace(NAME_SPACE, '$1 $2');
  }

  function fixText(node) {
    const parent = node.parentNode;
    if (!parent || SKIP.has(parent.nodeName) || parent.isContentEditable) return;
    if (!node.data.includes('.') || !node.data.includes(' ')) return;
    const next = protect(node.data);
    // Nur echte Änderungen schreiben, damit der Beobachter nicht erneut auslöst.
    if (next !== node.data) node.data = next;
  }

  function scan(root) {
    if (!root) return;
    if (root.nodeType === 3) { fixText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (SKIP.has(root.nodeName)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) fixText(node);
  }

  window.PadelNameWrap = { protect, scan };
  if (typeof MutationObserver !== 'function' || !document.body) return;

  scan(document.body);
  new MutationObserver(records => {
    records.forEach(record => {
      if (record.type === 'characterData') fixText(record.target);
      else record.addedNodes.forEach(scan);
    });
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
})();
