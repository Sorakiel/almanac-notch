/** proto: clamp */
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/** proto: ss (smoothstep) */
export const ss = (e0: number, e1: number, x: number): number => {
  const k = clamp((x - e0) / (e1 - e0), 0, 1);
  return k * k * (3 - 2 * k);
};

/** proto: hexA */
export function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + clamp(a, 0, 1).toFixed(3) + ')';
}

/** mix as #rrggbb, for hexA */
export function mixHex(hex: string, hex2: string, k: number): string {
  const a = parseInt(hex.slice(1), 16),
    b = parseInt(hex2.slice(1), 16);
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k);
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0');
}

/** proto: mix */
export function mix(hex: string, hex2: string, k: number): string {
  const a = parseInt(hex.slice(1), 16),
    b = parseInt(hex2.slice(1), 16);
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k);
  return 'rgb(' + ch(16) + ',' + ch(8) + ',' + ch(0) + ')';
}
