import { rrect } from '../../util/draw';
import type { Prop } from './types';

/**
 * Not in the prototype (docs/CHANGES.md): Grafana's prop. A small dark panel low on the right with
 * a trace running across it; the trace turns red and spikes while an alert fires.
 */
export const monitor: Prop = {
  look: [0.4, 0.5],
  mood: 'следит за графиками',
  draw(c, R, b, mc, _P, s) {
    const t = s.t,
      gf = s.grafana,
      fire = !!gf && gf.auth === 'ok' && gf.state === 'fail';
    c.save();
    c.translate(R * 0.92, b * 0.58);
    c.rotate(-0.1);
    const w = R * 0.98,
      h = R * 0.7,
      rr = R * 0.08;
    // the bezel and the screen
    c.fillStyle = '#3A3D46';
    rrect(c, -w / 2, -h / 2, w, h, rr);
    c.fill();
    const iw = w - R * 0.1,
      ih = h - R * 0.1;
    c.fillStyle = '#14161B';
    rrect(c, -iw / 2, -ih / 2, iw, ih, rr * 0.6);
    c.fill();
    // the grid line in the middle
    c.strokeStyle = 'rgba(255,255,255,0.12)';
    c.lineWidth = Math.max(0.5, R * 0.02);
    c.beginPath();
    c.moveTo(-iw / 2 + R * 0.04, 0);
    c.lineTo(iw / 2 - R * 0.04, 0);
    c.stroke();
    // the trace scrolls left; a beat every cycle, taller while firing
    const n = 18,
      x0 = -iw / 2 + R * 0.05,
      dx = (iw - R * 0.1) / (n - 1),
      amp = ih * (fire ? 0.36 : 0.22);
    c.strokeStyle = fire ? '#FF6B61' : mc ? mc.body : '#92D9E6';
    c.lineWidth = Math.max(0.8, R * 0.05);
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1) + t * 0.45,
        ph = u - Math.floor(u),
        beat = ph > 0.62 && ph < 0.74 ? Math.sin(((ph - 0.62) / 0.12) * Math.PI * 2) : 0,
        y = -beat * amp + Math.sin(u * 19) * ih * 0.04;
      if (i) c.lineTo(x0 + i * dx, y);
      else c.moveTo(x0, y);
    }
    c.stroke();
    // the alarm light on the bezel
    if (fire) {
      c.globalAlpha *= 0.5 + 0.5 * Math.sin(t * 8);
      c.fillStyle = '#FF453A';
      c.beginPath();
      c.arc(w / 2 - R * 0.09, -h / 2 + R * 0.09, R * 0.035, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
    // the hand holding its left edge (panel space -> body space)
    const lx = -w / 2,
      ly = h * 0.15,
      hx = R * 0.92 + Math.cos(-0.1) * lx - Math.sin(-0.1) * ly,
      hy = b * 0.58 + Math.sin(-0.1) * lx + Math.cos(-0.1) * ly;
    const g = c.createRadialGradient(hx - R * 0.05, hy - R * 0.05, 1, hx, hy, R * 0.16);
    g.addColorStop(0, mc ? mc.body : '#FFFFFF');
    g.addColorStop(1, mc ? mc.shade : '#CCCCCC');
    c.fillStyle = g;
    c.beginPath();
    c.arc(hx, hy, R * 0.13, 0, Math.PI * 2);
    c.fill();
  },
};
