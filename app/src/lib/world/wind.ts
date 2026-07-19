// Vento global determinístico: direção gira lentamente + rajadas de ruído,
// magnitude limitada ao teto do oceano profundo. Puro em (seed, tempo de
// época quantizado) — todo jogador do MMO calcula o mesmo vento, sem
// sincronização. Interpolação suave entre degraus de 10s.

import { Simplex2, hashString } from "./noise";

export interface WindVector {
  vx: number;
  vy: number;
}

export const WIND_MIN = 0.004; // px/ms
export const WIND_MAX = 0.02; // px/ms — teto do empurrão do oceano profundo

const STEP_MS = 10_000;
const ROTATION_MS = 600_000; // uma volta base a cada ~10 min

const genCache = new Map<string, Simplex2>();

function gen(seed: string): Simplex2 {
  let g = genCache.get(seed);
  if (!g) {
    g = new Simplex2((hashString(seed) ^ hashString("wind")) >>> 0);
    genCache.set(seed, g);
  }
  return g;
}

function sampleBucket(seed: string, bucket: number): WindVector {
  const n = gen(seed);
  const angle =
    ((bucket * STEP_MS) / ROTATION_MS) * Math.PI * 2 +
    n.sample(bucket * 0.13, 7.7).value * 1.2;
  const mag =
    WIND_MIN + (WIND_MAX - WIND_MIN) * (0.5 + 0.5 * n.sample(bucket * 0.29, 3.3).value);
  return { vx: Math.cos(angle) * mag, vy: Math.sin(angle) * mag };
}

export function windAt(seed: string, timeMs: number): WindVector {
  const bucket = Math.floor(timeMs / STEP_MS);
  const f = (timeMs - bucket * STEP_MS) / STEP_MS;
  const s = f * f * (3 - 2 * f);
  const a = sampleBucket(seed, bucket);
  const b = sampleBucket(seed, bucket + 1);
  return { vx: a.vx + (b.vx - a.vx) * s, vy: a.vy + (b.vy - a.vy) * s };
}
