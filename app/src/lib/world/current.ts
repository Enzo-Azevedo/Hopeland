// Deterministic water current field. Direction follows the downhill
// elevation gradient (rivers flow to the sea); where the gradient is ~flat
// (deep ocean) a slow noise field sets a drift direction. Strength is
// per-terrain and ALWAYS strictly below swim speed: swimming against the
// current wins, so the current can never trap anyone (anti-trap invariant).

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

const FLAT_GRADIENT = 1e-4;
const DRIFT_SCALE = 80; // tiles per drift feature

const driftCache = new Map<string, Simplex2>();

function drift(seed: string): Simplex2 {
  let d = driftCache.get(seed);
  if (!d) {
    d = new Simplex2((hashString(seed) ^ hashString("water-drift")) >>> 0);
    driftCache.set(seed, d);
  }
  return d;
}

export function currentFor(seed: string, tx: number, ty: number): CurrentVector {
  const strength = STRENGTH[getTile(seed, tx, ty).terrain];
  if (strength === undefined) return { vx: 0, vy: 0 };

  let dx = getElevation(seed, tx - 1, ty) - getElevation(seed, tx + 1, ty);
  let dy = getElevation(seed, tx, ty - 1) - getElevation(seed, tx, ty + 1);
  const mag = Math.hypot(dx, dy);

  if (mag < FLAT_GRADIENT) {
    const angle = drift(seed).sample(tx / DRIFT_SCALE, ty / DRIFT_SCALE).value * Math.PI;
    dx = Math.cos(angle);
    dy = Math.sin(angle);
  } else {
    dx /= mag;
    dy /= mag;
  }
  return { vx: dx * strength, vy: dy * strength };
}
