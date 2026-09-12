import { C, predictLanding } from './physics.mjs?v=2026-09-12-rules-v2';

export async function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Dein Browser unterstützt diese Spielansicht nicht.');
  const court = new Image(); court.src = new URL('./court.svg?v=2026-09-12-rules-v2', import.meta.url).href;
  await court.decode();
  ctx.imageSmoothingEnabled = false;
  const px = x => Math.round(24 + x * 22.4), py = y => Math.round(24 + y * 22.4);
  const rect = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  return function render(state) {
    ctx.drawImage(court, 0, 0, 272, 496);
    for (const team of state.teams) {
      for (const base of [2.5, 7.5]) {
        const x = px(base + team.offset), y = py(team.y), w = C.paddleWidth * 22.4;
        rect(x - w / 2 + 2, y + 3, w, 5, '#12273e');
        rect(x - w / 2 - 1, y - 4, w + 2, 8, '#101d29');
        rect(x - w / 2, y - 3, w, 5, team.side ? '#e8f36a' : '#fa9278');
        rect(x - w / 2 + 1, y - 3, w - 2, 1, team.side ? '#ffffbb' : '#ffd2ae');
      }
    }
    if (state.phase === 'rally' || state.phase === 'paused') {
      const landing = predictLanding(state.ball);
      if (landing) {
        const x = px(landing.x), y = py(landing.y);
        ctx.strokeStyle = landing.fault ? '#ff9c85' : '#b6cdbb';
        ctx.globalAlpha = 0.65;
        ctx.strokeRect(x - 4.5, y - 4.5, 9, 9);
        ctx.globalAlpha = 1;
      }
    }
    for (const e of state.effects) {
      const r = Math.round(3 + e.age * 22);
      ctx.globalAlpha = 1 - e.age / 0.4;
      ctx.strokeStyle = e.kind === 'bounce' ? '#e8f36a' : '#e9f5eb';
      ctx.strokeRect(px(e.x) - r + 0.5, py(e.y) - r + 0.5, r * 2, r * 2);
      ctx.globalAlpha = 1;
    }
    const b = state.ball, x = px(b.x), groundY = py(b.y);
    const height = Math.round(b.z * 8), y = groundY - height;
    rect(x - 3, groundY - 1, 7, 3, '#132b46');
    if (height > 3) {
      ctx.strokeStyle = '#b6c9c2'; ctx.globalAlpha = 0.65; ctx.setLineDash([1, 2]);
      ctx.beginPath(); ctx.moveTo(x + 0.5, groundY); ctx.lineTo(x + 0.5, y); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    const size = 5 + Math.min(2, Math.floor(b.z));
    rect(x - size / 2 - 1, y - size / 2 - 1, size + 2, size + 2, '#16304a');
    rect(x - size / 2, y - size / 2, size, size, '#eff465');
    rect(x - size / 2, y - size / 2, 2, 2, '#ffffc8');
    if (b.z > C.reach && state.phase === 'rally') {
      ctx.font = '8px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff8d5';
      ctx.fillText('HOCH', x, y - 9);
    }
  };
}
