// Only navigation lives on the league page. Game code is loaded on /arcade/.
(() => {
  const link = document.getElementById('arcade-link');
  if (!link) return;
  const season = new URLSearchParams(window.location.search).get('saison');
  if (season) {
    const destination = new URL(link.getAttribute('href'), window.location.href);
    destination.searchParams.set('saison', season);
    link.href = destination.href;
  }
})();
