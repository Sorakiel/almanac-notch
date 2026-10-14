import { rrect } from '../../util/draw';
import type { Prop } from './types';

/** proto: PROPS.terminal */
export const terminal: Prop = {
  look: [0.65, 0.4],
  mood: 'поглядывает в терминал',
  draw(c, R, b, _mc, _P, s) {
    const t = s.t;
    const x = R * 0.55,
      y = b * 0.1,
      w = R * 1.0,
      h = R * 0.76;
    c.fillStyle = '#1C1D22';
    rrect(c, x, y, w, h, 4);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.14)';
    c.lineWidth = 1;
    c.stroke();
    c.save();
    rrect(c, x, y, w, h, 4);
    c.clip();
    const top = h * 0.16;
    ['#FF5F57', '#FEBC2E', '#28C840'].forEach((cl, i) => {
      c.fillStyle = cl;
      c.beginPath();
      c.arc(x + top * 0.6 + i * top * 0.75, y + top * 0.6, top * 0.22, 0, Math.PI * 2);
      c.fill();
    });
    const sc = Math.floor(t * 1.5),
      lh = (h - top * 1.6) / 4;
    for (let i = 0; i < 3; i++) {
      const lw = (w - 10) * (0.4 + 0.5 * ((Math.sin((sc + i) * 7.1) + 1) / 2));
      c.fillStyle = i === 0 ? '#5FD27D' : 'rgba(255,255,255,0.45)';
      c.fillRect(x + 5, y + top * 1.4 + i * lh, lw, Math.max(1.2, lh * 0.4));
    }
    if (Math.floor(t * 2) % 2) {
      c.fillStyle = '#FFFFFF';
      c.fillRect(x + 5, y + top * 1.4 + 3 * lh, 3, Math.max(1.2, lh * 0.4));
    }
    c.restore();
  },
};
