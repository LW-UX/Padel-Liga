const test = require('node:test');
const assert = require('node:assert/strict');

test('countdown presents 3, 2, 1 and GO in four equal sound sections', async () => {
  const { COUNTDOWN_DURATION_MS, countdownLabel } = await import('../arcade/audio.mjs');
  const section = COUNTDOWN_DURATION_MS / 4;
  assert.equal(countdownLabel(0), '3');
  assert.equal(countdownLabel(section - 1), '3');
  assert.equal(countdownLabel(section), '2');
  assert.equal(countdownLabel(section * 2), '1');
  assert.equal(countdownLabel(section * 3), 'GO');
  assert.equal(countdownLabel(COUNTDOWN_DURATION_MS), 'GO');
});

test('sound effects apply their individually normalized playback level', async () => {
  const { createSoundEffects } = await import('../arcade/audio.mjs');
  const voices = [];
  const template = { cloneNode() {
    const voice = { volume: 0, preload: '', paused: false, currentTime: 0, addEventListener() {}, play: () => Promise.resolve(), pause() { this.paused = true; } };
    voices.push(voice); return voice;
  } };
  const sounds = createSoundEffects({ elements: { hit: template, victory: template }, storage: null, volume: { hit: 0.28, victory: 0.11 } });
  assert.equal(sounds.play('hit').volume, 0.28);
  const victory = sounds.play('victory', { offsetSeconds: 0.05 });
  assert.equal(victory.volume, 0.11);
  assert.equal(victory.currentTime, 0.05);
  assert.equal(voices.length, 2);
});

test('preloaded effects use one unlocked low-latency audio context and can overlap', async () => {
  const { createSoundEffects } = await import('../arcade/audio.mjs');
  const sources = [], gains = [];
  class FakeAudioContext {
    constructor(options) { this.options = options; this.state = 'suspended'; this.destination = {}; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    decodeAudioData() { return Promise.resolve({ duration: 0.4 }); }
    createBufferSource() {
      const source = { connect() {}, disconnect() {}, start(when, offset) { this.started = { when, offset }; }, stop() { this.stopped = true; } };
      sources.push(source); return source;
    }
    createGain() {
      const gain = { gain: { value: 0 }, connect() {}, disconnect() {} };
      gains.push(gain); return gain;
    }
  }
  const element = { currentSrc: '/hit.mp3', cloneNode() { throw new Error('HTML audio fallback must not be used'); } };
  const sounds = createSoundEffects({
    elements: { hit: element }, storage: null, volume: { hit: 0.28 }, AudioContextClass: FakeAudioContext,
    fetchAudio: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })
  });
  assert.equal(await sounds.unlock(), true);
  const first = sounds.play('hit');
  const second = sounds.play('hit', { offsetSeconds: 0.1 });
  assert.equal(first.backend, 'buffer');
  assert.equal(second.backend, 'buffer');
  assert.equal(sources.length, 2);
  assert.deepEqual(sources.map(source => source.started), [{ when: 0, offset: 0 }, { when: 0, offset: 0.1 }]);
  assert.deepEqual(gains.map(gain => gain.gain.value), [0.28, 0.28]);
  sounds.stopAll();
  assert.ok(sources.every(source => source.stopped));
});
