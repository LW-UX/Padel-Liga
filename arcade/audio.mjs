// Exact length of countdown.mp3; the online clock uses the same value so both
// peers reveal GO and start play on the same audio boundary.
export const COUNTDOWN_DURATION_MS = 3552;
export const COUNTDOWN_LABELS = Object.freeze(['3', '2', '1', 'GO']);

export function countdownLabel(elapsedMs, durationMs = COUNTDOWN_DURATION_MS) {
  const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : COUNTDOWN_DURATION_MS;
  const index = Math.min(COUNTDOWN_LABELS.length - 1, Math.max(0, Math.floor(elapsedMs / duration * COUNTDOWN_LABELS.length)));
  return COUNTDOWN_LABELS[index];
}

export function createSoundEffects({
  elements,
  storage = globalThis.localStorage,
  preferenceKey = 'padelArcadeEffectsEnabled',
  volume = 0.28
}) {
  let enabled = true;
  const active = new Set();
  try { enabled = storage?.getItem(preferenceKey) !== 'false'; } catch {}

  function forget(voice) { active.delete(voice); }
  function play(name, { offsetSeconds = 0 } = {}) {
    if (!enabled || !elements[name]) return null;
    const voice = elements[name].cloneNode(true);
    voice.volume = typeof volume === 'number' ? volume : volume[name] ?? 0.28;
    voice.preload = 'auto';
    try { voice.currentTime = Math.max(0, offsetSeconds); } catch {}
    active.add(voice);
    voice.addEventListener('ended', () => forget(voice), { once: true });
    voice.addEventListener('error', () => forget(voice), { once: true });
    voice.play().catch(() => forget(voice));
    return voice;
  }
  function stop(voice) {
    if (!voice) return;
    voice.pause();
    try { voice.currentTime = 0; } catch {}
    forget(voice);
  }
  function stopAll() {
    for (const voice of [...active]) stop(voice);
  }
  function setEnabled(value) {
    enabled = Boolean(value);
    if (!enabled) stopAll();
    try { storage?.setItem(preferenceKey, String(enabled)); } catch {}
    return enabled;
  }

  return {
    get enabled() { return enabled; },
    duration(name) {
      const duration = elements[name]?.duration;
      return Number.isFinite(duration) && duration > 0 ? duration : null;
    },
    play,
    stop,
    stopAll,
    toggle() { return setEnabled(!enabled); }
  };
}
