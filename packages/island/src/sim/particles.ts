import type { IslandState, Particle } from './state';

/** proto: burst - square bits with gravity and spin; a third of them with reduced motion */
export function burst(s: IslandState, n: number, color: string): void {
  const { sp, rng } = s;
  if (s.S.reduced) n = Math.ceil(n / 3);
  // property order matters: it is the order rng is called in
  for (let i = 0; i < n; i++)
    s.particles.push({
      type: 'bit',
      color,
      x: sp.posX.x + (rng() - 0.5) * 0.8,
      y: sp.posY.x - 1.5,
      vx: (rng() - 0.5) * 5,
      vy: -(2 + rng() * 3.4),
      life: 0,
      max: 0.9 + rng() * 0.7,
      rot: rng() * 6,
      vr: (rng() - 0.5) * 8,
      size: 0.06 + rng() * 0.05,
    });
}

/** proto: spawnFloat - a floating bit, note or sleep z */
export function spawnFloat(s: IslandState, type: Particle['type'], color?: string): void {
  const { sp, rng } = s;
  s.particles.push({
    type,
    color,
    x: sp.posX.x + (rng() - 0.5) * 0.6,
    y: sp.posY.x - 2.0,
    vx: 0,
    vy: 0,
    life: 0,
    max: type === 'z' ? 2.6 : 1.2,
    rot: rng() * 6,
    vr: 0,
    size: type === 'z' ? 0.2 + rng() * 0.08 : 0.06,
  });
}

/** proto: particle step at the end of update */
export function stepParticles(s: IslandState, dt: number): void {
  const ps = s.particles;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i] as Particle;
    p.life += dt;
    if (p.type === 'z') {
      p.y -= 0.42 * dt;
      p.x += Math.sin(p.life * 2.6 + p.rot) * 0.18 * dt;
    } else if (p.vx === 0 && p.vy === 0) {
      p.y -= 0.7 * dt;
      p.x += Math.sin(p.life * 4 + p.rot) * 0.2 * dt;
    } else {
      p.vy += 7 * dt;
      p.vx *= 1 - 1.5 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    if (p.life > p.max) ps.splice(i, 1);
  }
}
