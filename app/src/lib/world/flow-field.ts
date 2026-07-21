// Per-tile water flow samples for the water shader, encoded for a toroidal
// data texture. Uses the channel-only flow (channelFlowAt) — the static
// part of the current, without wind — since the world is static and
// samples cache permanently; wind's time dependence isn't baked into this
// texture.

import { channelFlowAt, MAX_CURRENT } from "./current";
import { getTile } from "./world-gen";
import { createTileCache } from "./tile-cache";

export const FIELD_TILES = 160; // 5x5 chunk ring * 32 tiles

export type FlowKind = 0 | 1 | 2 | 3; // land, deep, coast, river

export interface FlowSample {
  vx: number;
  vy: number;
  kind: FlowKind;
}

const KIND_BY_TERRAIN: Record<string, FlowKind> = {
  deep_water: 1,
  water: 2,
  river: 3,
};

export function kindOf(terrain: string): FlowKind {
  return KIND_BY_TERRAIN[terrain] ?? 0;
}

const cache = createTileCache<FlowSample>();

export function flowAt(seed: string, tx: number, ty: number): FlowSample {
  const key = `${seed}:${tx},${ty}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const kind = kindOf(getTile(seed, tx, ty).terrain);
  const sample: FlowSample =
    kind === 0
      ? { vx: 0, vy: 0, kind }
      : { ...channelFlowAt(seed, tx, ty), kind };
  cache.set(key, sample);
  return sample;
}

/** [R, G, B, A]: R/G = flow components, B = kind ramp, A = water mask. */
export function encodeFlow(s: FlowSample): [number, number, number, number] {
  const enc = (v: number) =>
    Math.max(0, Math.min(255, Math.round((v / MAX_CURRENT) * 127) + 128));
  return [enc(s.vx), enc(s.vy), s.kind * 85, s.kind === 0 ? 0 : 255];
}

export function decodeFlow(r: number, g: number, b: number): FlowSample {
  return {
    vx: ((r - 128) / 127) * MAX_CURRENT,
    vy: ((g - 128) / 127) * MAX_CURRENT,
    kind: (Math.round(b / 85) as FlowKind),
  };
}

/** Euclidean modulo into the toroidal field (safe for negative tiles). */
export function fieldTexel(t: number): number {
  return ((t % FIELD_TILES) + FIELD_TILES) % FIELD_TILES;
}
