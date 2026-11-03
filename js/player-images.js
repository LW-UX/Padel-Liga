// Profilbilder liegen im öffentlichen Supabase-Bildspeicher. Ohne gespeicherte Bildversion
// erscheint direkt das Profil-Emoji, sodass keine Anfragen auf fehlende Dateien entstehen.
(() => {
  const BUCKET = 'player-images';
  const CACHE_KEY = 'padel-player-image-versions';
  const FILES = Object.freeze({ profile: 'profile.webp', thumb: 'thumb.jpg' });
  const versions = new Map();
  const hasBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

  if (hasBrowser) try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    Object.entries(cached).forEach(([playerId, version]) => version && versions.set(playerId, version));
  } catch {
    // Ohne Zwischenspeicher erscheinen die Bilder erst nach der Abfrage.
  }

  function storeCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(versions)));
    } catch {
      // Der Zwischenspeicher ist optional.
    }
  }

  function has(playerId) {
    return Boolean(playerId && versions.has(playerId));
  }

  function url(playerId, variant = 'profile') {
    const baseUrl = hasBrowser ? window.PADEL_SUPABASE_CONFIG?.url : '';
    const version = versions.get(playerId);
    if (!playerId || !version || !baseUrl) return '';
    const cacheKey = new Date(version).getTime() || encodeURIComponent(version);
    return `${baseUrl}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(playerId)}/${FILES[variant] || FILES.profile}?v=${cacheKey}`;
  }

  function escapeAttribute(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  }

  // Attribute für ein <img>, dem direkt das Emoji-Element folgt.
  function attributes(playerId, variant = 'profile') {
    const src = url(playerId, variant);
    return `data-player-image="${escapeAttribute(playerId)}" data-player-image-variant="${variant}"${src ? ` src="${escapeAttribute(src)}"` : ' hidden'}`;
  }

  function fallbackAttribute(playerId) {
    return has(playerId) ? ' hidden' : '';
  }

  function apply(root = document) {
    root.querySelectorAll('img[data-player-image]').forEach(image => {
      const src = url(image.dataset.playerImage, image.dataset.playerImageVariant);
      const fallback = image.nextElementSibling;
      if (!src) {
        image.hidden = true;
        image.removeAttribute('src');
        fallback?.removeAttribute('hidden');
        return;
      }
      if (image.getAttribute('src') === src) return;
      image.hidden = false;
      fallback?.setAttribute('hidden', '');
      image.src = src;
    });
  }

  function notify(playerIds) {
    storeCache();
    apply();
    document.dispatchEvent(new CustomEvent('padel:player-images-changed', { detail: { playerIds } }));
  }

  function setVersion(playerId, version) {
    if (!playerId) return;
    if (version) versions.set(playerId, version);
    else versions.delete(playerId);
    notify([playerId]);
  }

  function getClient() {
    if (window.PADEL_SUPABASE_CLIENT) return window.PADEL_SUPABASE_CLIENT;
    const config = window.PADEL_SUPABASE_CONFIG;
    if (!config?.url || !config?.publishableKey || !window.supabase?.createClient) return null;
    window.PADEL_SUPABASE_CLIENT = window.supabase.createClient(config.url, config.publishableKey);
    return window.PADEL_SUPABASE_CLIENT;
  }

  async function load() {
    const client = getClient();
    if (!client) return;
    const { data, error } = await client
      .from('players')
      .select('id, profile_image_version')
      .not('profile_image_version', 'is', null);
    if (error) {
      console.error('Profilbilder konnten nicht geladen werden:', error);
      return;
    }
    const changed = new Set([...versions.keys()]);
    versions.clear();
    (data || []).forEach(row => {
      versions.set(row.id, row.profile_image_version);
      changed.add(row.id);
    });
    notify([...changed]);
  }

  const api = Object.freeze({
    url,
    has,
    attributes,
    fallbackAttribute,
    apply,
    setVersion,
    ready: hasBrowser ? load() : Promise.resolve()
  });
  if (typeof module !== 'undefined') module.exports = api;
  if (hasBrowser) window.PadelPlayerImages = api;
})();
