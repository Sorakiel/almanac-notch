import { rrect, textAt } from '../../util/draw';
import type { Prop } from './types';

/** proto: PROPS.calendar */
export const calendar: Prop = {
  look: [0.65, 0.25],
  mood: 'смотрит в календарь',
  draw(c, R, b, _mc, _P, s) {
    const x = R * 0.62,
      y = b * 0.02,
      w = R * 0.8,
      h = R * 0.86;
    c.fillStyle = '#FFFFFF';
    rrect(c, x, y, w, h, 3);
    c.fill();
    c.fillStyle = '#FF5A4E';
    rrect(c, x, y, w, h * 0.28, 3);
    c.fill();
    c.fillRect(x, y + h * 0.18, w, h * 0.1);
    c.fillStyle = '#2A2C33';
    for (const rx of [0.3, 0.7]) {
      c.beginPath();
      c.arc(x + w * rx, y + 1, 1.4, 0, Math.PI * 2);
      c.fill();
    }
    textAt(c, String(s.date().getDate()), x + w / 2, y + h * 0.64, {
      size: Math.round(R * 0.42),
      weight: 700,
      align: 'center',
      color: '#1A1A1E',
    });
  },
};
