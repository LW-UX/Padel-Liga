// Exact length of countdown.mp3; the online clock uses the same value so both
// peers reveal GO and start play on the same audio boundary.
export const COUNTDOWN_DURATION_MS = 3552;
export const COUNTDOWN_LABELS = Object.freeze(['3', '2', '1', 'GO']);
export const EFFECT_SOUND_NAMES = Object.freeze(['countdown', 'dodge', 'hit']);
export const MUSIC_SOUND_NAMES = Object.freeze(['gameMusic', 'gameOver', 'victory']);
export const backgroundMusicVolume = mobile => mobile ? 0.10 : 0.22;
const DESKTOP_SOUND_VOLUMES = Object.freeze({ gameMusic: 0.22, countdown: 0.30, dodge: 0.75, hit: 0.28, gameOver: 0.27, victory: 0.11 });
const MOBILE_SOUND_VOLUMES = Object.freeze({ ...DESKTOP_SOUND_VOLUMES, dodge: 1, hit: 0.75 });
export const soundVolume = (name, mobile = false) => name === 'gameMusic'
  ? backgroundMusicVolume(mobile)
  : (mobile ? MOBILE_SOUND_VOLUMES : DESKTOP_SOUND_VOLUMES)[name] ?? 0.28;

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
  audioSession = globalThis.navigator?.audioSession,
  AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext,
  fetchAudio = globalThis.fetch
}) {
  let enabled = true;
  const toggledNames = new Set(toggleNames);
  const active = new Set();
  const encoded = new Map();
  const buffers = new Map();
  const loads = new Map();
  const decodes = new Map();
  let context = null;
  try { enabled = storage?.getItem(preferenceKey) !== 'false'; } catch {}

  function forget(voice) { active.delete(voice); }
  function level(name) {
    const value = typeof volume === 'function' ? volume(name) : typeof volume === 'number' ? volume : volume[name] ?? 0.28;
    return Number.isFinite(value) ? Math.max(0, value) : 0.28;
  }
  function audioUrl(element) {
    return element?.currentSrc || element?.src || element?.getAttribute?.('src') || '';
  }
  function usePlaybackAudioSession() {
    if (!audioSession) return false;
    try {
      // Safari otherwise assigns Web Audio to its ambient category, which is
      // silenced by the iPhone Ring/Silent switch. Playback is the explicit
      // media category and remains audible in silent mode.
      audioSession.type = 'playback';
      return audioSession.type === 'playback';
    } catch { return false; }
  }
  function getContext() {
    if (context || typeof AudioContextClass !== 'function') return context;
    try { context = new AudioContextClass({ latencyHint: 'interactive' }); }
    catch {
      try { context = new AudioContextClass(); } catch {}
    }
    return context;
  }
  function prime(audioContext) {
    if (!audioContext) return false;
    try {
      // iOS requires a source to be started synchronously inside the tap/key
      // event. Waiting for resume() or decoding first can leave the context
      // reported as running while its output remains silent.
      const source = audioContext.createBufferSource();
      source.buffer = audioContext.createBuffer(1, 1, audioContext.sampleRate || 44100);
      source.connect(audioContext.destination);
      source.onended = () => { try { source.disconnect(); } catch {} };
      source.start(0);
      return true;
    } catch { return false; }
  }
  async function load(name) {
    if (encoded.has(name)) return true;
    if (loads.has(name)) return loads.get(name);
    if (typeof fetchAudio !== 'function' || !elements[name]) return false;
    const loading = (async () => {
      const element = elements[name];
      const url = audioUrl(element);
      if (!url) return false;
      try {
        const response = await fetchAudio(url);
        if (!response.ok) return false;
        encoded.set(name, await response.arrayBuffer());
        return true;
      } catch { return false; }
    })();
    loads.set(name, loading);
    const loaded = await loading;
    if (!loaded) loads.delete(name);
    return loaded;
  }
  async function preload(names = Object.keys(elements)) {
    const results = await Promise.all(names.map(load));
    return results.some(Boolean);
  }
  async function decodeName(name) {
    if (buffers.has(name)) return true;
    if (decodes.has(name)) return decodes.get(name);
    const audioContext = getContext();
    if (!audioContext) return false;
    const decoding = (async () => {
      if (!await load(name)) return false;
      try {
        buffers.set(name, await audioContext.decodeAudioData(encoded.get(name).slice(0)));
        return true;
      } catch { return false; }
    })();
    decodes.set(name, decoding);
    const decoded = await decoding;
    if (!decoded) decodes.delete(name);
    return decoded;
  }
  async function decode(names = Object.keys(elements)) {
    const results = await Promise.all(names.map(decodeName));
    return results.some(Boolean);
  }
  async function unlock(names = Object.keys(elements)) {
    // Session selection, context creation and the first source start all
    // happen before the first await so Safari sees them as part of the
    // initiating user gesture.
    usePlaybackAudioSession();
    const audioContext = getContext();
    prime(audioContext);
    const resume = audioContext && !['running', 'closed'].includes(audioContext.state)
      ? audioContext.resume().catch(() => {}) : Promise.resolve();
    await Promise.all([resume, decode(names)]);
    return audioContext?.state === 'running' && names.some(name => buffers.has(name));
  }
  async function resume() {
    usePlaybackAudioSession();
    if (!context || context.state === 'closed') return false;
    if (context.state !== 'running') {
      try { await context.resume(); } catch {}
    }
    return context.state === 'running';
  }
  function playBuffer(name, offsetSeconds, loop) {
    const buffer = buffers.get(name);
    if (!context || context.state !== 'running' || !buffer) return null;
    const source = context.createBufferSource();
    const gain = context.createGain();
    const voice = { backend: 'buffer', soundName: name, source, gain, stopped: false };
    source.buffer = buffer;
    source.loop = loop;
    gain.gain.value = level(name);
    source.connect(gain); gain.connect(context.destination);
    source.onended = () => forget(voice);
    active.add(voice);
    try { source.start(0, Math.min(Math.max(0, offsetSeconds), Math.max(0, buffer.duration - 0.001))); }
    catch { forget(voice); return null; }
    return voice;
  }
  function playElement(name, offsetSeconds, loop) {
    const element = elements[name];
    if (!element) return null;
    const voice = element.cloneNode(true);
    voice.soundName = name;
    voice.volume = Math.min(1, level(name));
    voice.loop = loop;
    voice.preload = 'auto';
    try { voice.currentTime = Math.max(0, offsetSeconds); } catch {}
    active.add(voice);
    voice.addEventListener('ended', () => forget(voice), { once: true });
    voice.addEventListener('error', () => forget(voice), { once: true });
    voice.play().catch(() => forget(voice));
    return voice;
  }
  function play(name, { offsetSeconds = 0, enabled: playbackEnabled = enabled, loop = false, elementFallback = true } = {}) {
    if (!playbackEnabled || !elements[name]) return null;
    usePlaybackAudioSession();
    if (!buffers.has(name) && context) decodeName(name);
    return playBuffer(name, offsetSeconds, loop) ?? (elementFallback ? playElement(name, offsetSeconds, loop) : null);
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
    get webAudioReady() { return Boolean(context); },
    duration(name) {
      const duration = elements[name]?.duration;
      return Number.isFinite(duration) && duration > 0 ? duration : null;
    },
    play,
    preload,
    decode,
    unlock,
    resume,
    stop,
    stopAll,
    stopNames,
    toggle() { return setEnabled(!enabled); }
  };
}
