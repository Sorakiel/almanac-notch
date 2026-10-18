import { rrect } from '../../util/draw';
import type { Prop } from './types';

/** proto: PROPS.diff */
export const diff: Prop = {
  look: [0.65, 0.3],
  mood: 'изучает дифф',
  draw(c, R, b) {
    const x = R * 0.6,
      y = b * 0.04,
      w = R * 0.86,
      h = R * 0.92;
    c.fillStyle = '#F7F7FA';
    rrect(c, x, y, w, h, 3);
    c.fill();
    for (let i = 0; i < 5; i++) {
      const ly = y + 4 + (i * (h - 8)) / 5,
        bg = i === 1 ? '#FFD5D2' : i === 2 || i === 3 ? '#CFF1D8' : null;
      if (bg) {
        c.fillStyle = bg;
        c.fillRect(x + 1.5, ly - 1, w - 3, (h - 8) / 5 - 0.5);
      }
      c.fillStyle = 'rgba(40,44,52,0.45)';
      c.fillRect(x + 4, ly + 0.5, (w - 8) * (0.45 + (0.4 * ((i * 37) % 10)) / 10), 1.4);
    }
  },
};
