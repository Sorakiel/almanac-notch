import { clamp } from '../util/math';
import type { Ctx } from '../util/draw';
import type { IslandState } from '../sim/state';

/** proto: drawParticles - bits, notes and sleep z, big stage only */
export function drawParticles(s: IslandState, c: Ctx, cx: number, gy: number, R: number): void {
  for (const p of s.particles) {
    const a = 1 - Math.pow(p.life / p.max, 2),
      x = cx + p.x * R,
      y = gy + p.y * R,
      sz = p.size * R;
    c.save();
    c.globalAlpha = clamp(a, 0, 1);
    c.translate(x, y);
    if (p.type === 'z') {
      c.fillStyle = s.theme.muted;
      c.font = '500 ' + Math.round(sz) + 'px "JetBrains Mono", monospace';
      c.textAlign = 'center';
      c.fillText('z', 0, 0);
    } else if (p.type === 'note') {
      c.fillStyle = p.color ?? '#000';
      c.font = '600 ' + Math.round(sz * 3.2) + 'px system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText(p.rot > 3 ? '♪' : '♫', 0, 0);
    } else {
      c.rotate(p.rot);
      c.fillStyle = p.color ?? '#000';
      c.fillRect(-sz / 2, -sz / 2, sz, sz);
    }
    c.restore();
  }
}
