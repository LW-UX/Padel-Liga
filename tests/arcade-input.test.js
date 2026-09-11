const test = require('node:test');
const assert = require('node:assert/strict');

function event(target, type, values = {}) {
  const e = new Event(type, { cancelable: true });
  Object.assign(e, values);
  target.dispatchEvent(e);
}
async function inputHarness(width = 272, height = 496) {
  const previousWindow = global.window;
  const win = new EventTarget(); win.closest = () => null; global.window = win;
  const canvas = Object.assign(new EventTarget(), {
    focus() {}, setPointerCapture() {}, getBoundingClientRect: () => ({ width, height })
  });
  const knob = { style: {} };
  const joystick = Object.assign(new EventTarget(), {
    querySelector: () => knob, setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 })
  });
  let toggles = 0;
  const { createInput } = await import('../arcade/input.mjs');
  const input = createInput(canvas, joystick, () => ({ offset: 0, y: 17 }), () => toggles++);
  return { input, canvas, joystick, win, toggles: () => toggles, close() { input.destroy(); global.window = previousWindow; } };
}
test('mouse dragging accounts for fitted court scale and releases cleanly', async () => {
  for (const [width, height, delta] of [[272, 496, 4.48], [544, 992, 8.96], [544, 496, 4.48]]) {
    const h = await inputHarness(width, height);
    try {
      event(h.canvas, 'pointerdown', { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
      event(h.canvas, 'pointermove', { pointerId: 1, clientX: delta, clientY: -delta });
      assert.ok(Math.abs(h.input.read().x - 0.6) < 1e-6);
      assert.ok(Math.abs(h.input.read().y + 0.6) < 1e-6);
      event(h.canvas, 'pointercancel', { pointerId: 1 });
      assert.deepEqual(h.input.read(), { x: 0, y: 0 });
    } finally { h.close(); }
  }
});
test('joystick is bounded, ignores another finger and resets on lost capture', async () => {
  const h = await inputHarness();
  try {
    event(h.joystick, 'pointerdown', { pointerId: 1, clientX: 50, clientY: -500 });
    assert.deepEqual(h.input.read(), { x: 0, y: -1 });
    event(h.joystick, 'pointerdown', { pointerId: 2, clientX: -500, clientY: 50 });
    assert.deepEqual(h.input.read(), { x: 0, y: -1 });
    event(h.joystick, 'lostpointercapture', { pointerId: 1 });
    assert.deepEqual(h.input.read(), { x: 0, y: 0 });
  } finally { h.close(); }
});
test('keyboard input clears on blur and a held pause key toggles only once', async () => {
  const h = await inputHarness();
  try {
    event(h.win, 'keydown', { code: 'KeyW' }); event(h.win, 'keydown', { code: 'ArrowRight' });
    assert.deepEqual(h.input.read(), { x: 1, y: -1 });
    event(h.win, 'blur'); assert.deepEqual(h.input.read(), { x: 0, y: 0 });
    event(h.win, 'keydown', { code: 'Space', repeat: false });
    event(h.win, 'keydown', { code: 'Space', repeat: true });
    assert.equal(h.toggles(), 1);
  } finally { h.close(); }
});
