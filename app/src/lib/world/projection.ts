// Pure oblique 2.5D projection: straight grid, square 32px tops, elevation
// quantized to half-block levels, south walls only. No Phaser imports —
// everything here is unit-testable.

import type { Tile } from "./world-gen";
import { GEN, HALF_STEP_PX, MAX_LEVEL } from "./world-config";

const WATER_TERRAINS = new Set(["deep_water", "water", "river"]);

/** Water = 0; land maps [GEN.beach, 1] linearly onto 1..MAX_LEVEL. */
export function levelFor(tile: Pick<Tile, "terrain" | "elevation">): number {
  if (WATER_TERRAINS.has(tile.terrain)) return 0;
  const n = (tile.elevation - GEN.beach) / (1 - GEN.beach);
  const clamped = Math.min(1, Math.max(0, n));
  return 1 + Math.min(MAX_LEVEL - 1, Math.floor(clamped * (MAX_LEVEL - 1)));
}

/** Screen y for a world-pixel y at a given block level. */
export function projectY(tyPx: number, level: number): number {
  return tyPx - level * HALF_STEP_PX;
}

/** Number of 16px wall strips exposed on the south face. */
export function wallStripsFor(level: number, southLevel: number): number {
  return Math.max(0, level - southLevel);
}

/**
 * Analytic player occlusion. southLevels[d] = levels of the tile columns the
 * player overlaps at row offset d+1 south of it. A tile at row offset r hides
 * the player when its block rises at least 2 half-steps per row of distance.
 */
export function isOccluded(playerLevel: number, southLevels: number[][]): boolean {
  for (let d = 0; d < southLevels.length; d++) {
    const r = d + 1;
    for (const lvl of southLevels[d]!) {
      if (lvl - playerLevel >= 2 * r) return true;
    }
  }
  return false;
}

/** Bake-time top shading: valleys darker, peaks full brightness. */
export function brightnessFor(level: number): number {
  const l = Math.min(MAX_LEVEL, Math.max(0, level));
  return 0.82 + 0.18 * (l / MAX_LEVEL);
}
