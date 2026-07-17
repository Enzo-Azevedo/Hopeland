// app/src/lib/world/world-config.ts
// Global world constants. The seed is the same for every player (MMO):
// the world of Hopeland is called into being by the word "Esperança".

export const WORLD_SEED = "Esperança";

export const TILE_SIZE = 32; // px
export const CHUNK_SIZE = 32; // tiles per chunk side
export const CHUNK_PX = TILE_SIZE * CHUNK_SIZE; // 1024
export const VIEW_RADIUS = 2; // 5x5 chunk ring
export const MAX_CHUNK_CREATES_PER_FRAME = 1;

// Uphill fatigue: elevation delta (per tile) that counts as climbing.
export const CLIMB_DELTA = 0.004;

// Oblique 2.5D projection (spec 2026-07-17): straight grid, square tops,
// elevation as block height. Half a block per level, south walls only.
export const HALF_STEP_PX = 16;
export const MAX_LEVEL = 13; // land levels 1..13; water is 0
export const RT_PAD_PX = MAX_LEVEL * HALF_STEP_PX; // 208
export const CHUNK_RT_HEIGHT_PX = CHUNK_PX + 2 * RT_PAD_PX; // 1440

// Generation scales are in tiles (wavelength of the noise features).
export const GEN = {
  continentScale: 2000,
  elevationScale: 400,
  elevationOctaves: 6,
  erosion: 8,
  ridgeScale: 700,
  climateScale: 700, // biome patches ~500 tiles across
  warpScale: 150,
  warpAmp: 80,
  riverScale: 300,
  riverWidth: 0.012,
  // Elevation thresholds
  deepWater: -0.25,
  water: -0.015,
  beach: 0.005,
  rock: 0.62,
  snowRock: 0.78,
  // Climate thresholds
  coldBelow: -0.25,
  hotAbove: 0.3,
  dryBelow: -0.2,
  wetAbove: 0.25,
  altitudeCooling: 0.6,
} as const;
