(function (season) {
  const receive = typeof document !== 'undefined' && document.currentScript?.padelSearchReceive;
  if (typeof receive === 'function') {
    receive(season);
  } else {
    window.PADEL_SEASON = season;
    window.PadelSiteSearch?.rememberEditorial(season);
  }
})({
  id: "2026-test",
  label: "Test-Saison",
  articles: []
});
