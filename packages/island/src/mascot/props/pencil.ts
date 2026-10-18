import type { Prop } from './types';

/**
 * Not in the prototype (docs/CHANGES.md): Notion's prop, reserved in the prototype's PROPS
 * (look [0.4, 0.5], 'пишет в Notion'). A small sheet low on the right, a pencil writing a line
 * across it; the line grows, then a new one starts.
 */
export const pencil: Prop = {
  look: [0.4, 0.5],
  mood: 'пишет в Notion',
  draw(c, R, b, mc, _P, s) {
    const t = s.t;
    c.save();
    c.translate(R * 0.92, b * 0.58);
    c.rotate(-0.12);
    // the sheet
    const w = R * 0.78,
      h = R * 0.62;
    c.fillStyle = '#FFFFFF';
    c.beginPath();
    c.moveTo(-w / 2, -h / 2);
    c.lineTo(w / 2 - R * 0.14, -h / 2);
    c.lineTo(w / 2, -h / 2 + R * 0.14);
    c.lineTo(w / 2, h / 2);
    c.lineTo(-w / 2, h / 2);
    c.closePath();
    c.fill();
    // written lines: two done, the third growing under the pencil
    const ph = (t % 3) / 3,
      lx0 = -w / 2 + R * 0.12,
      lw = w - R * 0.3;
    c.strokeStyle = '#3A3B40';
    c.lineWidth = Math.max(0.8, R * 0.055);
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(lx0, -h * 0.22);
    c.lineTo(lx0 + lw, -h * 0.22);
    c.moveTo(lx0, h * 0.02);
    c.lineTo(lx0 + lw * 0.7, h * 0.02);
    c.stroke();
    const tipX = lx0 + lw * ph,
      tipY = h * 0.26 + Math.sin(t * 26) * R * 0.012;
    c.beginPath();
    c.moveTo(lx0, h * 0.26);
    c.lineTo(tipX, tipY);
    c.stroke();
    // the pencil: tip on the line, leaning up and right
    const len = R * 0.95;
    c.translate(tipX, tipY);
    // leaning away from the face, wobbling as it writes
    const lean = 0.55 + Math.sin(t * 13) * 0.05;
    c.rotate(lean);
    const u = R * 0.09;
    c.fillStyle = '#2A2C33';
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(u * 0.45, -u * 0.55);
    c.lineTo(-u * 0.45, -u * 0.55);
    c.closePath();
    c.fill();
    c.fillStyle = '#F2D2A9';
    c.beginPath();
    c.moveTo(u * 0.45, -u * 0.55);
    c.lineTo(u, -u * 1.7);
    c.lineTo(-u, -u * 1.7);
    c.lineTo(-u * 0.45, -u * 0.55);
    c.closePath();
    c.fill();
    c.fillStyle = '#FFC93C';
    c.fillRect(-u, -len, u * 2, len - u * 1.7);
    c.fillStyle = '#C9C9CF';
    c.fillRect(-u, -len - u * 0.6, u * 2, u * 0.6);
    c.fillStyle = '#F58BA8';
    c.beginPath();
    c.moveTo(-u, -len - u * 0.6);
    c.lineTo(-u, -len - u * 1.2);
    c.quadraticCurveTo(0, -len - u * 1.8, u, -len - u * 1.2);
    c.lineTo(u, -len - u * 0.6);
    c.closePath();
    c.fill();
    c.restore();
    // the hand holding it, halfway up the pencil (sheet space -> body space)
    const lx = tipX + Math.sin(lean) * len * 0.45,
      ly = tipY - Math.cos(lean) * len * 0.45,
      hx = R * 0.92 + Math.cos(-0.12) * lx - Math.sin(-0.12) * ly,
      hy = b * 0.58 + Math.sin(-0.12) * lx + Math.cos(-0.12) * ly;
    const g = c.createRadialGradient(hx - R * 0.05, hy - R * 0.05, 1, hx, hy, R * 0.16);
    g.addColorStop(0, mc ? mc.body : '#FFFFFF');
    g.addColorStop(1, mc ? mc.shade : '#CCCCCC');
    c.fillStyle = g;
    c.beginPath();
    c.arc(hx, hy, R * 0.13, 0, Math.PI * 2);
    c.fill();
  },
};
