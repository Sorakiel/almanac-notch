import { rrect } from '../../util/draw';
import type { Prop } from './types';

/** proto: PROPS.book */
export const book: Prop = {
  look: [0.1, 0.65],
  mood: 'читает книгу привычек',
  draw(c, R, b, mc, _P, s) {
    const t = s.t;
    // an open book held low, seen from the outside: two brown cover halves around the spine,
    // the bowed page tops peeking over them and a page turning now and then
    c.save();
    c.translate(R * 0.1, b * 0.62);
    c.rotate(Math.sin(t * 0.8) * 0.04);
    const hw = R * 0.56,
      h = R * 0.56,
      top = -h / 2;
    c.fillStyle = '#F2E6CF';
    for (const sd of [-1, 1]) {
      c.beginPath();
      c.moveTo(0, top + 3);
      c.lineTo(0, top);
      c.quadraticCurveTo(sd * hw * 0.5, top - h * 0.24, sd * hw * 0.95, top - h * 0.02);
      c.lineTo(sd * hw * 0.95, top + 3);
      c.closePath();
      c.fill();
    }
    c.strokeStyle = 'rgba(140,105,70,0.45)';
    c.lineWidth = 0.8;
    for (const sd of [-1, 1]) {
      c.beginPath();
      c.moveTo(0, top + 1.5);
      c.quadraticCurveTo(sd * hw * 0.5, top - h * 0.12, sd * hw * 0.92, top + 1.2);
      c.stroke();
    }
    const ph = (t % 4.2) / 0.7;
    if (ph < 1) {
      const x = hw * 0.9 * Math.cos(ph * Math.PI),
        lift = h * (0.2 + 0.32 * Math.sin(ph * Math.PI));
      c.strokeStyle = '#FFF8EA';
      c.lineWidth = 1.6;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(0, top);
      c.quadraticCurveTo(x * 0.45, top - lift * 1.2, x, top - lift * 0.55);
      c.stroke();
    }
    for (const sd of [-1, 1]) {
      c.fillStyle = sd < 0 ? '#7A4E2D' : '#875A3A';
      c.beginPath();
      c.moveTo(0, top);
      c.lineTo(sd * hw, top + h * 0.07);
      c.lineTo(sd * hw, h / 2 - h * 0.03);
      c.lineTo(0, h / 2);
      c.closePath();
      c.fill();
    }
    c.fillStyle = '#5E3A20';
    rrect(c, -R * 0.05, top - 1, R * 0.1, h + 2, 2);
    c.fill();
    c.strokeStyle = mc ? mc.body : '#F4A9C6';
    c.lineWidth = 1.4;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(R * 0.02, h / 2);
    c.quadraticCurveTo(R * 0.06, h / 2 + h * 0.15, R * 0.03, h / 2 + h * 0.3);
    c.stroke();
    c.restore();
    for (const sd of [-1, 1]) {
      const hx = R * 0.1 + sd * hw * 0.98,
        hy = b * 0.7;
      const g = c.createRadialGradient(hx - R * 0.05, hy - R * 0.05, 1, hx, hy, R * 0.16);
      g.addColorStop(0, mc ? mc.body : '#FFFFFF');
      g.addColorStop(1, mc ? mc.shade : '#CCCCCC');
      c.fillStyle = g;
      c.beginPath();
      c.arc(hx, hy, R * 0.14, 0, Math.PI * 2);
      c.fill();
    }
  },
};
