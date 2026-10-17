import type { Prop } from './types';

/** Not in the prototype (docs/CHANGES.md): Vercel's prop - a small rocket going up, a flickering flame. */
export const rocket: Prop = {
  look: [0.6, -0.2],
  mood: 'запускает деплой',
  draw(c, R, b, _mc, _P, s) {
    const u = R * 0.2;
    c.save();
    c.translate(R * 0.98, b * 0.32);
    c.rotate(0.6);
    // flame first, under the body
    const f = 1 + 0.25 * Math.sin(s.t * 23) + 0.12 * Math.sin(s.t * 37);
    c.fillStyle = '#FFB547';
    c.beginPath();
    c.moveTo(-u * 0.75, u * 1.55);
    c.quadraticCurveTo(0, u * (1.55 + 2.1 * f), u * 0.75, u * 1.55);
    c.closePath();
    c.fill();
    c.fillStyle = '#FFF1C9';
    c.beginPath();
    c.moveTo(-u * 0.38, u * 1.55);
    c.quadraticCurveTo(0, u * (1.55 + 1.1 * f), u * 0.38, u * 1.55);
    c.closePath();
    c.fill();
    // fins
    c.fillStyle = '#918AC0';
    for (const side of [-1, 1]) {
      c.beginPath();
      c.moveTo(side * u * 0.8, u * 0.2);
      c.lineTo(side * u * 1.55, u * 1.55);
      c.lineTo(side * u * 0.8, u * 1.25);
      c.closePath();
      c.fill();
    }
    // body: a capsule with a pointed nose
    c.fillStyle = '#F7F7FA';
    c.beginPath();
    c.moveTo(0, -u * 2.3);
    c.quadraticCurveTo(u * 1.05, -u * 1.3, u * 0.9, u * 0.6);
    c.lineTo(u * 0.75, u * 1.55);
    c.lineTo(-u * 0.75, u * 1.55);
    c.lineTo(-u * 0.9, u * 0.6);
    c.quadraticCurveTo(-u * 1.05, -u * 1.3, 0, -u * 2.3);
    c.closePath();
    c.fill();
    // window
    c.fillStyle = '#C9C3E8';
    c.beginPath();
    c.arc(0, -u * 0.45, u * 0.45, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#918AC0';
    c.lineWidth = Math.max(0.8, u * 0.16);
    c.stroke();
    c.restore();
  },
};
