const test = require('node:test');
const assert = require('node:assert/strict');

test('countdown presents 3, 2, 1 and GO in four equal sound sections', async () => {
  const { COUNTDOWN_DURATION_MS, EFFECT_SOUND_NAMES, MUSIC_SOUND_NAMES, backgroundMusicVolume, countdownLabel, soundVolume } = await import('../arcade/audio.mjs');
  assert.deepEqual(EFFECT_SOUND_NAMES, ['countdown', 'dodge', 'hit', 'pointWon', 'pointLost']);
  assert.deepEqual(MUSIC_SOUND_NAMES, ['gameMusic', 'gameOver', 'victory']);
  assert.equal(backgroundMusicVolume(false), 0.22);
  assert.equal(backgroundMusicVolume(true), 0.10);
  assert.equal(soundVolume('countdown', false), 0.30);
  assert.equal(soundVolume('countdown', true), 0.225);
  assert.equal(soundVolume('dodge', false), 0.75);
  assert.equal(soundVolume('dodge', true), 0.75);
  assert.equal(soundVolume('hit', false), 0.28);
  assert.equal(soundVolume('hit', true), 0.5625);
  assert.equal(soundVolume('pointWon', false), 0.32);
  assert.equal(soundVolume('pointWon', true), 0.4125);
  assert.equal(soundVolume('pointLost', false), 0.32);
  assert.equal(soundVolume('pointLost', true), 0.4125);
  const section = COUNTDOWN_DURATION_MS / 4;
  assert.equal(countdownLabel(0), '3');
  assert.equal(countdownLabel(section - 1), '3');
  assert.equal(countdownLabel(section), '2');
  assert.equal(countdownLabel(section * 2), '1');
  assert.equal(countdownLabel(section * 3), 'GO');
  assert.equal(countdownLabel(COUNTDOWN_DURATION_MS), 'GO');
});

test('a score increase selects the point sound from the local player perspective', async () => {
  const { contactSoundName, pointSoundName } = await import('../arcade/audio.mjs');
  assert.equal(pointSoundName([2, 3], [2, 4], 1), 'pointWon');
  assert.equal(pointSoundName([2, 3], [3, 3], 0), 'pointLost');
  assert.equal(pointSoundName([2, 3], [2, 3], 1), null);
  assert.equal(pointSoundName([6, 6], [0, 0], 1), null);
  assert.equal(contactSoundName({ id: 9, kind: 'bounce' }, 9), null);
  assert.equal(contactSoundName({ id: 9, kind: 'wall' }, 9), null);
  assert.equal(contactSoundName({ id: 8, kind: 'bounce' }, 9), 'dodge');
  assert.equal(contactSoundName({ id: 9, kind: 'hit' }, 9), 'hit');
});

test('laptop duels celebrate either team while solo and online retain perspective sounds', async () => {
  const { matchSoundName, pointSoundName } = await import('../arcade/audio.mjs');
  for (const winner of [0, 1]) {
    const score = [6, 6];
    score[winner]++;
    assert.equal(pointSoundName([6, 6], score, winner, true), 'pointWon');
    assert.equal(matchSoundName(winner, true), 'victory');
    assert.equal(pointSoundName(score, score, winner, true), null);
    assert.equal(pointSoundName(score, [0, 0], winner, true), null);
    assert.equal(matchSoundName(winner), winner === 1 ? 'victory' : 'gameOver');
  }
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

test('music and effects switches stop only the sounds assigned to their channel', async () => {
  const { createSoundEffects, EFFECT_SOUND_NAMES, MUSIC_SOUND_NAMES } = await import('../arcade/audio.mjs');
  const template = { cloneNode() {
    return { paused: false, currentTime: 0, addEventListener() {}, play: () => Promise.resolve(), pause() { this.paused = true; } };
  } };
  const sounds = createSoundEffects({
    elements: { gameMusic: template, countdown: template, dodge: template, hit: template, gameOver: template, victory: template },
    storage: null, toggleNames: EFFECT_SOUND_NAMES, AudioContextClass: null, fetchAudio: null
  });
  const hit = sounds.play('hit');
  const gameMusic = sounds.play('gameMusic', { enabled: true, loop: true });
  const victory = sounds.play('victory', { enabled: true });
  sounds.toggle();
  assert.equal(hit.paused, true);
  assert.equal(gameMusic.paused, false);
  assert.equal(gameMusic.loop, true);
  assert.equal(victory.paused, false);
  assert.equal(sounds.play('dodge'), null);
  const gameOver = sounds.play('gameOver', { enabled: true });
  sounds.stopNames(MUSIC_SOUND_NAMES);
  assert.equal(gameMusic.paused, true);
  assert.equal(victory.paused, true);
  assert.equal(gameOver.paused, true);
});

test('music and effects share one unlocked low-latency audio context and can overlap', async () => {
  const { createSoundEffects, MUSIC_SOUND_NAMES } = await import('../arcade/audio.mjs');
  const sources = [], gains = [], activationOrder = [];
  let contexts = 0;
  class FakeAudioContext {
    constructor(options) { contexts++; activationOrder.push('context'); this.options = options; this.state = 'suspended'; this.destination = {}; this.sampleRate = 48000; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    decodeAudioData() { return Promise.resolve({ duration: 0.4 }); }
    createBuffer(channels, frames, sampleRate) { return { channels, frames, sampleRate, duration: frames / sampleRate, silent: true }; }
    createBufferSource() {
      const source = { connect() {}, disconnect() {}, start(when, offset) { this.started = { when, offset }; }, stop() { this.stopped = true; } };
      sources.push(source); return source;
    }
    createGain() {
      const gain = { gain: { value: 0 }, connect() {}, disconnect() {} };
      gains.push(gain); return gain;
    }
  }
  const audioSession = {
    currentType: 'auto',
    get type() { return this.currentType; },
    set type(value) { activationOrder.push(`session:${value}`); this.currentType = value; }
  };
  const element = name => ({ currentSrc: `/${name}.mp3`, cloneNode() { throw new Error('HTML audio fallback must not be used'); } });
  const sounds = createSoundEffects({
    elements: { hit: element('hit'), gameMusic: element('game-music') }, storage: null,
    volume: { hit: 0.28, gameMusic: 0.10 }, AudioContextClass: FakeAudioContext,
    audioSession,
    fetchAudio: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })
  });
  assert.equal(await sounds.preload(), true);
  assert.equal(contexts, 0);
  assert.equal(sounds.webAudioReady, false);
  const unlocking = sounds.unlock();
  assert.deepEqual(activationOrder.slice(0, 2), ['session:playback', 'context']);
  assert.equal(audioSession.type, 'playback');
  assert.equal(contexts, 1);
  assert.equal(sounds.webAudioReady, true);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].buffer.silent, true);
  assert.deepEqual(sources[0].started, { when: 0, offset: undefined });
  assert.equal(await unlocking, true);
  const first = sounds.play('hit');
  const second = sounds.play('hit', { offsetSeconds: 0.1 });
  const music = sounds.play('gameMusic', { enabled: true, loop: true, elementFallback: false });
  assert.equal(first.backend, 'buffer');
  assert.equal(second.backend, 'buffer');
  assert.equal(music.backend, 'buffer');
  assert.equal(music.source.loop, true);
  assert.equal(sources.length, 4);
  assert.deepEqual(sources.slice(1).map(source => source.started), [{ when: 0, offset: 0 }, { when: 0, offset: 0.1 }, { when: 0, offset: 0 }]);
  assert.deepEqual(gains.map(gain => gain.gain.value), [0.28, 0.28, 0.10]);
  sounds.stopNames(MUSIC_SOUND_NAMES);
  assert.equal(music.source.stopped, true);
  assert.equal(first.source.stopped, undefined);
  assert.equal(second.source.stopped, undefined);
  sounds.stopAll();
  assert.ok(sources.slice(1).every(source => source.stopped));
});
