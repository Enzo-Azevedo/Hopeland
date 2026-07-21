// app/src/lib/world/world-gen.ts
// Pure per-tile world generation. getTile(seed, x, y) never depends on call
// order or neighboring chunks — the whole infinite world is one function.

import { GEN, WORLD_SEED } from "./world-config";
import { Simplex2, erodedFbm, fbm, hashString, ridgedFbm } from "./noise";

export type Biome =
  | "ocean" | "coast" | "mountain"
  | "tundra" | "snow" | "taiga"
  | "plains" | "forest" | "swamp"
  | "desert" | "savanna" | "jungle";

export type Terrain =
  | "deep_water" | "water" | "river" | "beach"
  | "grass" | "forest" | "jungle" | "swamp" | "desert" | "savanna"
  | "tundra" | "snow" | "taiga" | "rock" | "snow_rock";

export interface Tile {
  biome: Biome;
  terrain: Terrain;
  elevation: number;
  slope: number;
}

interface Generators {
  warpX: Simplex2;
  warpY: Simplex2;
  continent: Simplex2;
  elevation: Simplex2;
  ridge: Simplex2;
  temp: Simplex2;
  moist: Simplex2;
  river: Simplex2;
}

const generatorCache = new Map<string, Generators>();

function getGenerators(seed: string): Generators {
  let g = generatorCache.get(seed);
  if (!g) {
    const base = hashString(seed);
    const salted = (label: string) => new Simplex2((base ^ hashString(label)) >>> 0);
    g = {
      warpX: salted("warp-x"),
      warpY: salted("warp-y"),
      continent: salted("continent"),
      elevation: salted("elevation"),
      ridge: salted("ridge"),
      temp: salted("temperature"),
      moist: salted("moisture"),
      river: salted("river"),
    };
    generatorCache.set(seed, g);
  }
  return g;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function warped(g: Generators, tx: number, ty: number): { wx: number; wy: number } {
  const fx = fbm(g.warpX, tx / GEN.warpScale, ty / GEN.warpScale, 3).value;
  const fy = fbm(g.warpY, tx / GEN.warpScale, ty / GEN.warpScale, 3).value;
  return { wx: tx + GEN.warpAmp * fx, wy: ty + GEN.warpAmp * fy };
}

/** Elevation in [-1, 1]. Continentalness + eroded detail + ridged mountains. */
const elevationCache = new Map<string, number>();
const tileCache = new Map<string, Tile>();

export function getElevation(seed: string, tx: number, ty: number): number {
  const key = `${seed}:${tx},${ty}`;
  const hit = elevationCache.get(key);
  if (hit !== undefined) return hit;
  const value = computeElevation(seed, tx, ty);
  elevationCache.set(key, value);
  return value;
}

function computeElevation(seed: string, tx: number, ty: number): number {
  const g = getGenerators(seed);
  const { wx, wy } = warped(g, tx, ty);
  const cont = fbm(g.continent, wx / GEN.continentScale, wy / GEN.continentScale, 4).value;
  const detail = erodedFbm(
    g.elevation, wx / GEN.elevationScale, wy / GEN.elevationScale,
    GEN.elevationOctaves, GEN.erosion,
  ).value;
  const highland = smoothstep(0.15, 0.6, cont);
  const ridge = ridgedFbm(g.ridge, wx / GEN.ridgeScale, wy / GEN.ridgeScale, 4);
  const e = cont * 0.55 + detail * 0.35 + ridge * 0.55 * highland;
  return Math.max(-1, Math.min(1, e));
}

export function classifyBiome(temp: number, moist: number): Biome {
  if (temp < GEN.coldBelow) {
    if (moist < GEN.dryBelow) return "tundra";
    if (moist > GEN.wetAbove) return "taiga";
    return "snow";
  }
  if (temp > GEN.hotAbove) {
    if (moist < GEN.dryBelow) return "desert";
    if (moist > GEN.wetAbove) return "jungle";
    return "savanna";
  }
  if (moist < GEN.dryBelow) return "plains";
  if (moist > GEN.wetAbove) return "swamp";
  return "forest";
}

const BIOME_TERRAIN: Record<Biome, Terrain> = {
  ocean: "deep_water",
  coast: "water",
  mountain: "rock",
  tundra: "tundra",
  snow: "snow",
  taiga: "taiga",
  plains: "grass",
  forest: "forest",
  swamp: "swamp",
  desert: "desert",
  savanna: "savanna",
  jungle: "jungle",
};

export function getTile(seed: string, tx: number, ty: number): Tile {
  const key = `${seed}:${tx},${ty}`;
  const hit = tileCache.get(key);
  if (hit !== undefined) return hit;
  const value = computeTile(seed, tx, ty);
  tileCache.set(key, value);
  return value;
}

function computeTile(seed: string, tx: number, ty: number): Tile {
  const g = getGenerators(seed);
  const elevation = getElevation(seed, tx, ty);
  // Gameplay slope from finite differences of the real elevation field.
  const slope = Math.max(
    Math.abs(getElevation(seed, tx + 1, ty) - elevation),
    Math.abs(getElevation(seed, tx, ty + 1) - elevation),
  );

  if (elevation < GEN.deepWater) return { biome: "ocean", terrain: "deep_water", elevation, slope };
  if (elevation < GEN.water) return { biome: "coast", terrain: "water", elevation, slope };
  if (elevation < GEN.beach) return { biome: "coast", terrain: "beach", elevation, slope };

  const { wx, wy } = warped(g, tx, ty);
  const rawTemp = fbm(g.temp, wx / GEN.climateScale, wy / GEN.climateScale, 3).value;
  const temp = rawTemp - Math.max(0, elevation) * GEN.altitudeCooling;
  const moist = fbm(g.moist, wx / GEN.climateScale, wy / GEN.climateScale, 3).value;

  if (elevation > GEN.rock) {
    const snowy = elevation > GEN.snowRock || temp < GEN.coldBelow;
    return { biome: "mountain", terrain: snowy ? "snow_rock" : "rock", elevation, slope };
  }

  // Context-free rivers: thin ridged-noise band, wider in lowlands.
  const riverN = g.river.sample(wx / GEN.riverScale, wy / GEN.riverScale).value;
  const width = GEN.riverWidth * (1.4 - smoothstep(GEN.beach, GEN.rock, elevation));
  if (Math.abs(riverN) < width) {
    return { biome: "coast", terrain: "river", elevation, slope };
  }

  const biome = classifyBiome(temp, moist);
  return { biome, terrain: BIOME_TERRAIN[biome], elevation, slope };
}

export function getWorldTile(tx: number, ty: number): Tile {
  return getTile(WORLD_SEED, tx, ty);
}

/**
 * Deterministic spawn: square spiral from (0,0) in steps of 8 tiles, first
 * plains/forest tile wins. Same spawn for every player.
 */
export function findSpawn(seed: string): { tx: number; ty: number } {
  const STEP = 8;
  const MAX_RING = 500; // 4000 tiles out — statistically unreachable
  const ok = (tx: number, ty: number) => {
    const t = getTile(seed, tx, ty);
    return t.terrain === "grass" || t.terrain === "forest";
  };
  if (ok(0, 0)) return { tx: 0, ty: 0 };
  for (let ring = 1; ring <= MAX_RING; ring++) {
    const r = ring * STEP;
    for (let i = -ring; i <= ring; i++) {
      const s = i * STEP;
      if (ok(s, -r)) return { tx: s, ty: -r };
      if (ok(s, r)) return { tx: s, ty: r };
      if (ok(-r, s)) return { tx: -r, ty: s };
      if (ok(r, s)) return { tx: r, ty: s };
    }
  }
  return { tx: 0, ty: 0 }; // fallback: origin (still walkable — nothing blocks)
}
