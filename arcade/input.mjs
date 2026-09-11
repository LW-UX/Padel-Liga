import { C, clamp } from './physics.mjs';

export function createInput(canvas, joystick, getTeam, onToggle) {
  const abort = new AbortController(), options = { signal: abort.signal };
  const keys = new Set();
  let drag = null, target = null, stick = { x: 0, y: 0 }, stickId = null;
  const knob = joystick.querySelector('span');
  const movementKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);
  function clear() {
    keys.clear(); drag = null; target = null; stickId = null; stick = { x: 0, y: 0 };
    knob.style.transform = '';
  }
  window.addEventListener('keydown', e => {
    if (e.target.closest('button, a, select, input, summary')) return;
    if (movementKeys.has(e.code)) { e.preventDefault(); keys.add(e.code); target = null; }
    if ((e.code === 'Space' || e.code === 'KeyP') && !e.repeat) { e.preventDefault(); onToggle(); }
  }, options);
  window.addEventListener('keyup', e => keys.delete(e.code), options);
  window.addEventListener('blur', clear, options);
  canvas.addEventListener('pointerdown', e => {
    if (drag || e.button !== 0) return;
    e.preventDefault(); canvas.focus({ preventScroll: true }); canvas.setPointerCapture(e.pointerId);
    const team = getTeam();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, offset: team.offset, depth: team.y };
    target = { offset: team.offset, y: team.y };
  }, options);
  canvas.addEventListener('pointermove', e => {
    if (e.pointerId !== drag?.id) return;
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / 272, rect.height / 496) * 22.4;
    target = {
      offset: clamp(drag.offset + (e.clientX - drag.x) / scale, -C.maxOffset, C.maxOffset),
      y: clamp(drag.depth + (e.clientY - drag.y) / scale, 10.9, 19.35)
    };
  }, options);
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(event, e => { if (e.pointerId === drag?.id) { drag = null; target = null; } }, options);
  }
  function updateStick(e) {
    const rect = joystick.getBoundingClientRect(), radius = rect.width * 0.32;
    let x = (e.clientX - rect.left - rect.width / 2) / radius;
    let y = (e.clientY - rect.top - rect.height / 2) / radius;
    const length = Math.max(1, Math.hypot(x, y)); x /= length; y /= length;
    stick = { x, y }; target = null;
    knob.style.transform = `translate(${x * radius}px, ${y * radius}px)`;
  }
  joystick.addEventListener('pointerdown', e => {
    if (stickId !== null) return;
    e.preventDefault(); stickId = e.pointerId; joystick.setPointerCapture(e.pointerId); updateStick(e);
  }, options);
  joystick.addEventListener('pointermove', e => { if (e.pointerId === stickId) updateStick(e); }, options);
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    joystick.addEventListener(event, e => { if (e.pointerId === stickId) { stickId = null; stick = { x: 0, y: 0 }; knob.style.transform = ''; } }, options);
  }
  return {
    clear,
    read() {
      if (target) {
        const team = getTeam();
        return { x: clamp((target.offset - team.offset) * 3, -1, 1), y: clamp((target.y - team.y) * 3, -1, 1) };
      }
      if (keys.size) return {
        x: Number(keys.has('ArrowRight') || keys.has('KeyD')) - Number(keys.has('ArrowLeft') || keys.has('KeyA')),
        y: Number(keys.has('ArrowDown') || keys.has('KeyS')) - Number(keys.has('ArrowUp') || keys.has('KeyW'))
      };
      return stick;
    },
    destroy() { clear(); abort.abort(); }
  };
}
