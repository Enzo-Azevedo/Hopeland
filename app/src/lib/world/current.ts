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
import { windAt } from "./wind";

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
const DEFLECT = 0.9; // 90% da força desvia quando a margem bloqueia (owner spec)
const EPS = 1e-4;

const OCTANTS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

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

/** How many of a tile's 8 neighbors are water — its "openness". */
function waterOpenness(seed: string, tx: number, ty: number): number {
  let n = 0;
  for (const [ox, oy] of NEIGHBORS) {
    if (strengthAt(seed, tx + ox, ty + oy) !== undefined) n++;
  }
  return n;
}

/**
 * Deflexão de margem (mecânica do dono): se a direção padrão do fluxo
 * aponta contra a borda do terreno, 90% da força desvia para o vizinho de
 * água mais livre (mais cercado de água) — nunca de volta ao tile de onde a
 * força veio. É o que faz o fluxo "escorregar" em diagonal pelo canal.
 */
function deflectAtBanks(
  seed: string,
  tx: number,
  ty: number,
  vx: number,
  vy: number,
  source: { tx: number; ty: number } | null,
): CurrentVector {
  const mag = Math.hypot(vx, vy);
  if (mag < EPS) return { vx, vy };

  const ang = Math.atan2(vy, vx);
  const oct = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
  const [sx, sy] = OCTANTS[oct]!;
  if (strengthAt(seed, tx + sx, ty + sy) !== undefined) {
    return { vx, vy }; // a direção padrão está livre — sem colisão de margem
  }

  let best: readonly [number, number] | null = null;
  let bestScore = -Infinity;
  for (const [ox, oy] of NEIGHBORS) {
    const nx = tx + ox;
    const ny = ty + oy;
    if (strengthAt(seed, nx, ny) === undefined) continue;
    if (source && nx === source.tx && ny === source.ty) continue;
    // Abertura domina (tile "livre" = cercado de água); alinhamento com o
    // fluxo original desempata para não inverter o sentido do rio.
    const len = Math.hypot(ox, oy);
    const align = (ox * vx + oy * vy) / (len * mag);
    const score = waterOpenness(seed, nx, ny) + align;
    if (score > bestScore) {
      bestScore = score;
      best = [ox, oy];
    }
  }
  if (!best) return { vx, vy };

  const len = Math.hypot(best[0], best[1]);
  return {
    vx: DEFLECT * mag * (best[0] / len) + (1 - DEFLECT) * vx,
    vy: DEFLECT * mag * (best[1] / len) + (1 - DEFLECT) * vy,
  };
}

/**
 * Canal puro: geração + momento herdado + deflexão de margem. Sem
 * cancelamento, vento ou deriva — só a força que o próprio canal produz,
 * limitada ao teto do terreno (anti-trava).
 */
export function rawChannelFlow(seed: string, tx: number, ty: number): CurrentVector {
  const cap = strengthAt(seed, tx, ty);
  if (cap === undefined) return { vx: 0, vy: 0 };

  let { vx, vy } = generatedAt(seed, tx, ty);

  // Momento herdado: cada passo a montante contribui metade da força do
  // anterior — a foz segue o canal do rio, decaindo com a distância.
  let weight = MOMENTUM;
  let pos = { tx, ty };
  let source: { tx: number; ty: number } | null = null;
  for (let k = 0; k < UPSTREAM_STEPS; k++) {
    const up = upstreamOf(seed, pos.tx, pos.ty);
    if (!up) break;
    if (k === 0) source = up; // o tile de onde esta força chegou
    const g = generatedAt(seed, up.tx, up.ty);
    vx += g.vx * weight;
    vy += g.vy * weight;
    weight *= MOMENTUM;
    pos = up;
  }

  ({ vx, vy } = deflectAtBanks(seed, tx, ty, vx, vy, source));

  const mag = Math.hypot(vx, vy);
  if (mag > cap) {
    // Anti-trava: nunca acima do teto do próprio terreno.
    return { vx: (vx / mag) * cap, vy: (vy / mag) * cap };
  }
  return { vx, vy };
}

/** Canal + cancelamento (Task 3 pluga aqui). Cacheado pelo flow-field. */
export function channelFlowAt(seed: string, tx: number, ty: number): CurrentVector {
  return rawChannelFlow(seed, tx, ty);
}

const WIND_INFLUENCE: Record<string, number> = {
  deep_water: 1.0,
  water: 0.5,
  river: 0.1,
};

export function currentFor(
  seed: string,
  tx: number,
  ty: number,
  timeMs = 0,
): CurrentVector {
  const terrain = getTile(seed, tx, ty).terrain;
  const cap = STRENGTH[terrain];
  if (cap === undefined) return { vx: 0, vy: 0 };

  const ch = channelFlowAt(seed, tx, ty);
  const wind = windAt(seed, timeMs);
  const infl = WIND_INFLUENCE[terrain] ?? 0;
  let vx = ch.vx + wind.vx * infl;
  let vy = ch.vy + wind.vy * infl;

  const mag = Math.hypot(vx, vy);
  if (mag > cap) {
    vx = (vx / mag) * cap;
    vy = (vy / mag) * cap;
  }
  return { vx, vy };
}
