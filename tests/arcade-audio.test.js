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
