// Exact length of countdown.mp3; the online clock uses the same value so both
// peers reveal GO and start play on the same audio boundary.
export const COUNTDOWN_DURATION_MS = 3552;
export const COUNTDOWN_LABELS = Object.freeze(['3', '2', '1', 'GO']);
export const EFFECT_SOUND_NAMES = Object.freeze(['countdown', 'dodge', 'hit']);
export const MUSIC_CUE_NAMES = Object.freeze(['gameOver', 'victory']);
export const backgroundMusicVolume = mobile => mobile ? 0.10 : 0.22;
const DESKTOP_SOUND_VOLUMES = Object.freeze({ countdown: 0.30, dodge: 0.75, hit: 0.28, gameOver: 0.27, victory: 0.11 });
const MOBILE_SOUND_VOLUMES = Object.freeze({ ...DESKTOP_SOUND_VOLUMES, dodge: 1, hit: 0.75 });
export const soundVolume = (name, mobile = false) => (mobile ? MOBILE_SOUND_VOLUMES : DESKTOP_SOUND_VOLUMES)[name] ?? 0.28;

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
  toggleNames = Object.keys(elements),
  AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext,
  fetchAudio = globalThis.fetch
}) {
  let enabled = true;
  const toggledNames = new Set(toggleNames);
  const active = new Set();
  const encoded = new Map();
  const buffers = new Map();
  let context = null;
  let loading = null;
  let decoding = null;
  try { enabled = storage?.getItem(preferenceKey) !== 'false'; } catch {}

  function forget(voice) { active.delete(voice); }
  function level(name) {
    const value = typeof volume === 'function' ? volume(name) : typeof volume === 'number' ? volume : volume[name] ?? 0.28;
    return Number.isFinite(value) ? Math.max(0, value) : 0.28;
  }
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
    if (typeof fetchAudio !== 'function') return false;
    loading = Promise.all(Object.entries(elements).map(async ([name, element]) => {
      const url = audioUrl(element);
      if (!url) return;
      try {
        const response = await fetchAudio(url);
        if (!response.ok) return;
        encoded.set(name, await response.arrayBuffer());
      } catch {}
    })).then(() => encoded.size > 0);
    return loading;
  }
  async function decode() {
    if (decoding) return decoding;
    const audioContext = getContext();
    if (!audioContext) return false;
    decoding = (async () => {
      await preload();
      await Promise.all([...encoded].map(async ([name, data]) => {
        try { buffers.set(name, await audioContext.decodeAudioData(data.slice(0))); } catch {}
      }));
      return buffers.size > 0;
    })();
    return decoding;
  }
  async function unlock() {
    // Creating the context here keeps it inside the user gesture on mobile;
    // preload() deliberately fetches only encoded bytes before that gesture.
    const audioContext = getContext();
    const resume = audioContext && !['running', 'closed'].includes(audioContext.state)
      ? audioContext.resume().catch(() => {}) : Promise.resolve();
    await Promise.all([resume, decode()]);
    return audioContext?.state === 'running' && buffers.size > 0;
  }
  function playBuffer(name, offsetSeconds) {
    const buffer = buffers.get(name);
    if (!context || context.state !== 'running' || !buffer) return null;
    const source = context.createBufferSource();
    const gain = context.createGain();
    const voice = { backend: 'buffer', soundName: name, source, gain, stopped: false };
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
    voice.soundName = name;
    voice.volume = Math.min(1, level(name));
    voice.preload = 'auto';
    try { voice.currentTime = Math.max(0, offsetSeconds); } catch {}
    active.add(voice);
    voice.addEventListener('ended', () => forget(voice), { once: true });
    voice.addEventListener('error', () => forget(voice), { once: true });
    voice.play().catch(() => forget(voice));
    return voice;
  }
  function play(name, { offsetSeconds = 0, enabled: playbackEnabled = enabled } = {}) {
    if (!playbackEnabled || !elements[name]) return null;
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
  function stopNames(names) {
    const selected = new Set(names);
    for (const voice of [...active]) if (selected.has(voice.soundName)) stop(voice);
  }
  function setEnabled(value) {
    enabled = Boolean(value);
    if (!enabled) stopNames(toggledNames);
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
    stopNames,
    toggle() { return setEnabled(!enabled); }
  };
}
