import { rrect } from '../../util/draw';
import type { Prop } from './types';

/** proto: PROPS.headphones */
export const headphones: Prop = {
  look: null,
  mood: 'в наушниках',
  draw(c, R, b, mc) {
    // the band over the head, then the cups with a pad in the module colour
    c.lineCap = 'round';
    c.strokeStyle = '#5E6370';
    c.lineWidth = R * 0.15;
    c.beginPath();
    c.arc(0, -b * 0.08, R * 1.07, Math.PI * 1.02, Math.PI * 1.98);
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.25)';
    c.lineWidth = R * 0.04;
    c.beginPath();
    c.arc(0, -b * 0.08, R * 1.1, Math.PI * 1.25, Math.PI * 1.75);
    c.stroke();
    for (const sd of [-1, 1]) {
      c.fillStyle = '#4C505B';
      rrect(c, sd * R * 1.04 - R * 0.17, -b * 0.34, R * 0.34, R * 0.62, R * 0.16);
      c.fill();
      c.fillStyle = mc ? mc.shade : '#5DB884';
      rrect(c, sd * R * 1.04 - R * 0.07, -b * 0.24, R * 0.14, R * 0.42, R * 0.07);
      c.fill();
    }
  },
};
