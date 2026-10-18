export type Ctx = CanvasRenderingContext2D;

/** proto: rrect */
export function rrect(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

export interface TextOpts {
  size?: number;
  weight?: number;
  mono?: boolean;
  color?: string;
  align?: CanvasTextAlign;
  max?: number;
}

/** proto: textAt */
export function textAt(c: Ctx, s: string, x: number, y: number, opts: TextOpts): void {
  c.save();
  c.font =
    (opts.weight || 500) +
    ' ' +
    (opts.size || 12) +
    'px ' +
    (opts.mono ? '"JetBrains Mono", monospace' : 'Onest, system-ui, sans-serif');
  c.fillStyle = opts.color || 'rgba(255,255,255,0.92)';
  c.textAlign = opts.align || 'left';
  c.textBaseline = 'middle';
  c.fillText(s, x, y, opts.max || 9999);
  c.restore();
}
