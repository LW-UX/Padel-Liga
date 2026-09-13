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
  volume = 0.28,
  AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext,
  fetchAudio = globalThis.fetch
}) {
  let enabled = true;
  const active = new Set();
  const buffers = new Map();
  let context = null;
  let loading = null;
  try { enabled = storage?.getItem(preferenceKey) !== 'false'; } catch {}

  function forget(voice) { active.delete(voice); }
  function level(name) { return typeof volume === 'number' ? volume : volume[name] ?? 0.28; }
  function audioUrl(element) {
    return element?.currentSrc || element?.src || element?.getAttribute?.('src') || '';
  }
  function getContext() {
    if (context || typeof AudioContextClass !== 'function') return context;
    try { context = new AudioContextClass({ latencyHint: 'interactive' }); }
    catch {
      try { context = new AudioContextClass(); } catch {}
    }
    return context;
  }
  async function preload() {
    if (loading) return loading;
    const audioContext = getContext();
    if (!audioContext || typeof fetchAudio !== 'function') return false;
    loading = Promise.all(Object.entries(elements).map(async ([name, element]) => {
      const url = audioUrl(element);
      if (!url) return;
      try {
        const response = await fetchAudio(url);
        if (!response.ok) return;
        const buffer = await audioContext.decodeAudioData(await response.arrayBuffer());
        buffers.set(name, buffer);
      } catch {}
    })).then(() => buffers.size > 0);
    return loading;
  }
  async function unlock() {
    const audioContext = getContext();
    const resume = audioContext && !['running', 'closed'].includes(audioContext.state)
      ? audioContext.resume().catch(() => {}) : Promise.resolve();
    await Promise.all([resume, preload()]);
    return audioContext?.state === 'running' && buffers.size > 0;
  }
  function playBuffer(name, offsetSeconds) {
    const buffer = buffers.get(name);
    if (!context || context.state !== 'running' || !buffer) return null;
    const source = context.createBufferSource();
    const gain = context.createGain();
    const voice = { backend: 'buffer', source, gain, stopped: false };
    source.buffer = buffer;
    gain.gain.value = level(name);
    source.connect(gain); gain.connect(context.destination);
    source.onended = () => forget(voice);
    active.add(voice);
    try { source.start(0, Math.min(Math.max(0, offsetSeconds), Math.max(0, buffer.duration - 0.001))); }
    catch { forget(voice); return null; }
    return voice;
  }
  function playElement(name, offsetSeconds) {
    const element = elements[name];
    if (!element) return null;
    const voice = element.cloneNode(true);
    voice.volume = level(name);
    voice.preload = 'auto';
    try { voice.currentTime = Math.max(0, offsetSeconds); } catch {}
    active.add(voice);
    voice.addEventListener('ended', () => forget(voice), { once: true });
    voice.addEventListener('error', () => forget(voice), { once: true });
    voice.play().catch(() => forget(voice));
    return voice;
  }
  function play(name, { offsetSeconds = 0 } = {}) {
    if (!enabled || !elements[name]) return null;
    return playBuffer(name, offsetSeconds) ?? playElement(name, offsetSeconds);
  }
  function stop(voice) {
    if (!voice) return;
    if (voice.backend === 'buffer') {
      if (!voice.stopped) {
        voice.stopped = true;
        try { voice.source.stop(); } catch {}
        voice.source.disconnect(); voice.gain.disconnect();
      }
    } else {
      voice.pause();
      try { voice.currentTime = 0; } catch {}
    }
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
    preload,
    unlock,
    stop,
    stopAll,
    toggle() { return setEnabled(!enabled); }
  };
}
