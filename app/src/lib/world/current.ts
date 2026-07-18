// Deterministic water current field with downstream momentum.
//
// Each tile GENERATES force proportional to its downhill slope, and INHERITS
// half of the force of the tile upstream of it (owner-specified mechanic:
// "o tile anterior exerce metade da própria força no seguinte"). The farther
// from where force is generated, the weaker it gets — so river mouths keep
// following the channel into the sea instead of obeying the (flat) local
// gradient. Strength is ALWAYS clamped strictly below swim speed: swimming
// against the current wins, so it can never trap anyone (anti-trap).

import { getElevation, getTile } from "./world-gen";
import { Simplex2, hashString } from "./noise";

export interface CurrentVector {
  vx: number;
  vy: number;
}

const STRENGTH: Record<string, number> = {
  river: 0.05,
  water: 0.03,
  deep_water: 0.02,
};

/** Largest current strength (px/ms). Must stay < 0.2 * TERRAIN_SPEED.deep_water. */
export const MAX_CURRENT = 0.05;

const GRAD_FULL = 0.002; // |gradient| that generates full local force
const MOMENTUM = 0.5; // half of the upstream tile's force (owner spec)
const UPSTREAM_STEPS = 4; // 1/2, 1/4, 1/8, 1/16 — beyond that it's noise
const EPS = 1e-4;
const DRIFT_SCALE = 80; // tiles per drift feature

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

const driftCache = new Map<string, Simplex2>();

function drift(seed: string): Simplex2 {
  let d = driftCache.get(seed);
  if (!d) {
    d = new Simplex2((hashString(seed) ^ hashString("water-drift")) >>> 0);
    driftCache.set(seed, d);
  }
  return d;
}

function strengthAt(seed: string, tx: number, ty: number): number | undefined {
  return STRENGTH[getTile(seed, tx, ty).terrain];
}

/** Locally generated force: downhill direction, magnitude scaled by slope. */
export function generatedAt(seed: string, tx: number, ty: number): CurrentVector {
  const s = strengthAt(seed, tx, ty);
  if (s === undefined) return { vx: 0, vy: 0 };

  const dx = getElevation(seed, tx - 1, ty) - getElevation(seed, tx + 1, ty);
  const dy = getElevation(seed, tx, ty - 1) - getElevation(seed, tx, ty + 1);
  const mag = Math.hypot(dx, dy);
  if (mag === 0) return { vx: 0, vy: 0 };

  const force = s * Math.min(1, mag / GRAD_FULL);
  return { vx: (dx / mag) * force, vy: (dy / mag) * force };
}

/**
 * The highest water neighbor — where the flow arrives from. Null when no
 * neighbor is strictly higher (flat open sea, or an isolated pool).
 */
export function upstreamOf(
  seed: string,
  tx: number,
  ty: number,
): { tx: number; ty: number } | null {
  let best: { tx: number; ty: number } | null = null;
  let bestE = getElevation(seed, tx, ty);
  for (const [ox, oy] of NEIGHBORS) {
    const nx = tx + ox;
    const ny = ty + oy;
    if (strengthAt(seed, nx, ny) === undefined) continue;
    const e = getElevation(seed, nx, ny);
    if (e > bestE) {
      bestE = e;
      best = { tx: nx, ty: ny };
    }
  }
  return best;
}

export function currentFor(seed: string, tx: number, ty: number): CurrentVector {
  const cap = strengthAt(seed, tx, ty);
  if (cap === undefined) return { vx: 0, vy: 0 };

  let { vx, vy } = generatedAt(seed, tx, ty);

  // Momento herdado: cada passo a montante contribui metade da força do
  // anterior — a foz segue o canal do rio, decaindo com a distância.
  let weight = MOMENTUM;
  let pos = { tx, ty };
  for (let k = 0; k < UPSTREAM_STEPS; k++) {
    const up = upstreamOf(seed, pos.tx, pos.ty);
    if (!up) break;
    const g = generatedAt(seed, up.tx, up.ty);
    vx += g.vx * weight;
    vy += g.vy * weight;
    weight *= MOMENTUM;
    pos = up;
  }

  const mag = Math.hypot(vx, vy);
  if (mag < EPS) {
    // Mar aberto sem geração nem herança: deriva lenta determinística.
    const angle = drift(seed).sample(tx / DRIFT_SCALE, ty / DRIFT_SCALE).value * Math.PI;
    return { vx: Math.cos(angle) * cap, vy: Math.sin(angle) * cap };
  }
  if (mag > cap) {
    // Anti-trava: nunca acima do teto do próprio terreno.
    return { vx: (vx / mag) * cap, vy: (vy / mag) * cap };
  }
  return { vx, vy };
}
