# Procedural World with Biomes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder Phaser scene with an infinite, deterministic, procedurally generated 2D world with realistic biomes, textured with the Classic Faithful 32x pack, where the player can never get stuck.

**Architecture:** Pure per-tile generation `getTile(seed, x, y)` (simplex noise with analytical derivatives → domain warping → continentalness spline → erosion-damped fBm + ridged mountains → Whittaker climate → context-free rivers). Chunks of 32×32 tiles rendered as one `TilemapGPULayer` each (fallback: regular `TilemapLayer`), managed by a render-agnostic ring/queue planner. No terrain ever blocks movement — water and steep climbs only slow the player.

**Tech Stack:** TypeScript, Phaser 4.2 (`TilemapGPULayer`), bun (runtime/tests), sharp (build-time atlas), Classic Faithful 32x textures.

**Spec:** `docs/superpowers/specs/2026-07-16-procedural-world-design.md`

## Global Constraints

- All commands run inside `app/` with **bun** (`bun test`, `bunx tsc --noEmit`, `bun run build`).
- Work on branch `feat/procedural-world`. **Never commit to `main`. No `Co-Authored-By` trailer.** Commit messages in English, imperative subject.
- User-facing text in PT-BR; identifiers, types, file names, commits in English.
- World seed is the string **`"Esperança"`** (constant `WORLD_SEED` in `world-config.ts`), hashed to numeric seeds.
- `getTile` must be a **pure function** — same inputs, same output, independent of call order. No global mutable state besides memoized per-seed generators.
- **Anti-trap invariant:** every terrain has speed multiplier > 0; no terrain collision exists anywhere.
- Chunk = 32×32 tiles; tile = 32 px. Chunk address `(cx, cy) = (floor(tx/32), floor(ty/32))`.
- Atlas output in `app/public/tiles/` is **committed** (Cloudflare build does not run the pipeline).
- Texture credits: Faithful License v3 — attribution + link to faithfulpack.net, non-commercial. Must be recorded in `assets/tiles/CREDITS.md`.
- Tests are co-located: `app/src/lib/world/<name>.test.ts`, run with `bun test`.

---

### Task 1: Noise core — simplex 2D with analytical derivatives

**Files:**
- Create: `app/src/lib/world/noise.ts`
- Test: `app/src/lib/world/noise.test.ts`

**Interfaces:**
- Produces:
  - `hashString(str: string): number` — deterministic 32-bit hash (xmur3 final state).
  - `interface NoiseSample { value: number; dx: number; dy: number }`
  - `class Simplex2 { constructor(seed: number); sample(x: number, y: number): NoiseSample }` — `value` in `[-1, 1]`, `dx`/`dy` are analytical partial derivatives.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/world/noise.test.ts
import { describe, expect, test } from "bun:test";
import { hashString, Simplex2 } from "./noise";

describe("hashString", () => {
  test("is deterministic and seed-sensitive", () => {
    expect(hashString("Esperança")).toBe(hashString("Esperança"));
    expect(hashString("Esperança")).not.toBe(hashString("esperança"));
    expect(Number.isInteger(hashString("Esperança"))).toBe(true);
  });
});

describe("Simplex2", () => {
  const noise = new Simplex2(hashString("Esperança"));

  test("is deterministic", () => {
    expect(noise.sample(12.34, -56.78)).toEqual(noise.sample(12.34, -56.78));
  });

  test("different seeds give different fields", () => {
    const other = new Simplex2(hashString("outra"));
    let diff = 0;
    for (let i = 0; i < 50; i++) {
      if (noise.sample(i * 1.7, i * 0.9).value !== other.sample(i * 1.7, i * 0.9).value) diff++;
    }
    expect(diff).toBeGreaterThan(45);
  });

  test("values stay in [-1, 1] and actually vary", () => {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < 2000; i++) {
      const v = noise.sample(i * 0.37, i * 0.53).value;
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      min = Math.min(min, v); max = Math.max(max, v);
    }
    expect(max - min).toBeGreaterThan(0.5);
  });

  test("analytical derivatives match finite differences", () => {
    const h = 1e-4;
    for (const [x, y] of [[0.3, 0.7], [5.1, -2.2], [-13.4, 8.8]] as const) {
      const s = noise.sample(x, y);
      const fdx = (noise.sample(x + h, y).value - noise.sample(x - h, y).value) / (2 * h);
      const fdy = (noise.sample(x, y + h).value - noise.sample(x, y - h).value) / (2 * h);
      expect(Math.abs(s.dx - fdx)).toBeLessThan(0.01);
      expect(Math.abs(s.dy - fdy)).toBeLessThan(0.01);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && bun test src/lib/world/noise.test.ts`
Expected: FAIL — cannot resolve `./noise`.

- [ ] **Step 3: Implement `noise.ts`**

```ts
// app/src/lib/world/noise.ts
// Simplex 2D noise with analytical derivatives (Gustavson corner scheme,
// derivative form after Quilez "morenoise"). Deterministic per seed.

export interface NoiseSample {
  value: number;
  dx: number;
  dy: number;
}

/** xmur3 string hash — deterministic 32-bit unsigned int from a string. */
export function hashString(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
// 8 unit gradients around the circle.
const GRAD_X: number[] = [];
const GRAD_Y: number[] = [];
for (let i = 0; i < 8; i++) {
  GRAD_X.push(Math.cos((i * Math.PI) / 4));
  GRAD_Y.push(Math.sin((i * Math.PI) / 4));
}
// Empirical scale to bring output near [-1, 1]; sample() clamps for safety.
const SCALE = 45.23;

export class Simplex2 {
  private perm = new Uint8Array(512);

  constructor(seed: number) {
    const rand = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = p[i]!;
      p[i] = p[j]!;
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]!;
  }

  sample(x: number, y: number): NoiseSample {
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;

    let value = 0;
    let dx = 0;
    let dy = 0;

    const corner = (cx: number, cy: number, gi: number) => {
      const tt = 0.5 - cx * cx - cy * cy;
      if (tt <= 0) return;
      const gx = GRAD_X[gi]!;
      const gy = GRAD_Y[gi]!;
      const gdot = gx * cx + gy * cy;
      const t2 = tt * tt;
      const t4 = t2 * t2;
      value += t4 * gdot;
      // d/dx [t^4 (g.d)] = -8 x t^3 (g.d) + t^4 gx
      dx += -8 * cx * tt * t2 * gdot + t4 * gx;
      dy += -8 * cy * tt * t2 * gdot + t4 * gy;
    };

    corner(x0, y0, this.perm[ii + this.perm[jj]!]! & 7);
    corner(x1, y1, this.perm[ii + i1 + this.perm[jj + j1]!]! & 7);
    corner(x2, y2, this.perm[ii + 1 + this.perm[jj + 1]!]! & 7);

    let v = value * SCALE;
    if (v > 1) v = 1;
    else if (v < -1) v = -1;
    return { value: v, dx: dx * SCALE, dy: dy * SCALE };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && bun test src/lib/world/noise.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/world/noise.ts app/src/lib/world/noise.test.ts
git commit -m "Add seeded simplex noise with analytical derivatives"
```

---

### Task 2: Fractal builders — fBm, eroded fBm, ridged, warp

**Files:**
- Modify: `app/src/lib/world/noise.ts` (append)
- Test: `app/src/lib/world/noise.test.ts` (append)

**Interfaces:**
- Consumes: `Simplex2`, `NoiseSample` from Task 1.
- Produces (all deterministic, exported from `noise.ts`):
  - `fbm(noise: Simplex2, x: number, y: number, octaves: number, lacunarity?: number, gain?: number): NoiseSample` — normalized to ~[-1, 1], derivatives chain-ruled.
  - `erodedFbm(noise: Simplex2, x: number, y: number, octaves: number, erosion: number): NoiseSample` — gradient-damped octaves (Quilez erosion).
  - `ridgedFbm(noise: Simplex2, x: number, y: number, octaves: number): number` — in [0, 1], sharp ridges.

- [ ] **Step 1: Append failing tests**

```ts
// append to app/src/lib/world/noise.test.ts
import { fbm, erodedFbm, ridgedFbm } from "./noise";

describe("fractal builders", () => {
  const noise = new Simplex2(hashString("Esperança"));

  test("fbm is deterministic, bounded, and richer than one octave", () => {
    expect(fbm(noise, 3.3, 4.4, 5)).toEqual(fbm(noise, 3.3, 4.4, 5));
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < 1000; i++) {
      const v = fbm(noise, i * 0.11, i * 0.07, 5).value;
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      min = Math.min(min, v); max = Math.max(max, v);
    }
    expect(max - min).toBeGreaterThan(0.5);
  });

  test("erodedFbm stays bounded and diverges from plain fbm", () => {
    let differs = 0;
    for (let i = 0; i < 200; i++) {
      const e = erodedFbm(noise, i * 0.13, i * 0.19, 5, 8);
      expect(Math.abs(e.value)).toBeLessThanOrEqual(1);
      if (Math.abs(e.value - fbm(noise, i * 0.13, i * 0.19, 5).value) > 1e-9) differs++;
    }
    expect(differs).toBeGreaterThan(150);
  });

  test("ridgedFbm is in [0,1] and reaches high values", () => {
    let max = 0;
    for (let i = 0; i < 1000; i++) {
      const v = ridgedFbm(noise, i * 0.17, i * 0.23, 4);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      max = Math.max(max, v);
    }
    expect(max).toBeGreaterThan(0.6);
  });
});
```

- [ ] **Step 2: Run to verify new tests fail**

Run: `cd app && bun test src/lib/world/noise.test.ts`
Expected: FAIL — `fbm` not exported.

- [ ] **Step 3: Append implementations to `noise.ts`**

```ts
// append to app/src/lib/world/noise.ts

/** Standard fBm with chain-ruled derivatives, normalized to ~[-1, 1]. */
export function fbm(
  noise: Simplex2,
  x: number,
  y: number,
  octaves: number,
  lacunarity = 2,
  gain = 0.5,
): NoiseSample {
  let value = 0;
  let dx = 0;
  let dy = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = noise.sample(x * freq, y * freq);
    value += amp * n.value;
    dx += amp * freq * n.dx;
    dy += amp * freq * n.dy;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return { value: value / norm, dx: dx / norm, dy: dy / norm };
}

/**
 * Erosion-style fBm (Quilez / de Carpentier): high-frequency octaves are
 * damped where the accumulated gradient is steep, producing smooth valleys
 * and rough ridges.
 */
export function erodedFbm(
  noise: Simplex2,
  x: number,
  y: number,
  octaves: number,
  erosion: number,
): NoiseSample {
  let value = 0;
  let sumDx = 0;
  let sumDy = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = noise.sample(x * freq, y * freq);
    sumDx += amp * freq * n.dx;
    sumDy += amp * freq * n.dy;
    value += (amp * n.value) / (1 + erosion * (sumDx * sumDx + sumDy * sumDy));
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return { value: value / norm, dx: sumDx / norm, dy: sumDy / norm };
}

/** Ridged multifractal in [0, 1]: sharp continuous crests. */
export function ridgedFbm(noise: Simplex2, x: number, y: number, octaves: number): number {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(noise.sample(x * freq, y * freq).value);
    value += amp * n * n;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return value / norm;
}
```

- [ ] **Step 4: Run tests**

Run: `cd app && bun test src/lib/world/noise.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/world/noise.ts app/src/lib/world/noise.test.ts
git commit -m "Add fbm, erosion-damped fbm and ridged multifractal"
```

---

### Task 3: World generation pipeline (`world-config.ts` + `world-gen.ts`)

**Files:**
- Create: `app/src/lib/world/world-config.ts`
- Create: `app/src/lib/world/world-gen.ts`
- Test: `app/src/lib/world/world-gen.test.ts`

**Interfaces:**
- Consumes: `Simplex2`, `hashString`, `fbm`, `erodedFbm`, `ridgedFbm` from Tasks 1-2.
- Produces:
  - `world-config.ts`: `WORLD_SEED = "Esperança"`, `TILE_SIZE = 32`, `CHUNK_SIZE = 32`, `CHUNK_PX = 1024`, `VIEW_RADIUS = 2`, `CLIMB_DELTA = 0.004`, plus a `GEN` object with all scales/thresholds (see code).
  - `world-gen.ts`:
    - `type Biome = "ocean" | "coast" | "mountain" | "tundra" | "snow" | "taiga" | "plains" | "forest" | "swamp" | "desert" | "savanna" | "jungle"`
    - `type Terrain = "deep_water" | "water" | "river" | "beach" | "grass" | "forest" | "jungle" | "swamp" | "desert" | "savanna" | "tundra" | "snow" | "taiga" | "rock" | "snow_rock"`
    - `interface Tile { biome: Biome; terrain: Terrain; elevation: number; slope: number }`
    - `classifyBiome(temp: number, moist: number): Biome` (land biomes only)
    - `getElevation(seed: string, tx: number, ty: number): number` — in [-1, 1]
    - `getTile(seed: string, tx: number, ty: number): Tile`
    - `getWorldTile(tx: number, ty: number): Tile` — bound to `WORLD_SEED`

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/world/world-gen.test.ts
import { describe, expect, test } from "bun:test";
import { classifyBiome, getTile, getWorldTile, type Terrain } from "./world-gen";
import { WORLD_SEED } from "./world-config";

describe("classifyBiome (Whittaker matrix)", () => {
  test("covers the 9 land biomes", () => {
    expect(classifyBiome(-0.6, -0.6)).toBe("tundra");
    expect(classifyBiome(-0.6, 0)).toBe("snow");
    expect(classifyBiome(-0.6, 0.6)).toBe("taiga");
    expect(classifyBiome(0, -0.6)).toBe("plains");
    expect(classifyBiome(0, 0)).toBe("forest");
    expect(classifyBiome(0, 0.6)).toBe("swamp");
    expect(classifyBiome(0.6, -0.6)).toBe("desert");
    expect(classifyBiome(0.6, 0)).toBe("savanna");
    expect(classifyBiome(0.6, 0.6)).toBe("jungle");
  });
});

describe("getTile", () => {
  test("is pure and order-independent", () => {
    const a = getTile(WORLD_SEED, 123, -456);
    getTile(WORLD_SEED, 9999, 9999); // unrelated call in between
    expect(getTile(WORLD_SEED, 123, -456)).toEqual(a);
  });

  test("different seeds produce different worlds", () => {
    let diff = 0;
    for (let i = 0; i < 100; i++) {
      if (getTile("Esperança", i * 31, i * 17).terrain !== getTile("outra", i * 31, i * 17).terrain) diff++;
    }
    expect(diff).toBeGreaterThan(20);
  });

  test("produces varied terrain over a large area, including water and land", () => {
    const seen = new Set<Terrain>();
    for (let y = -300; y <= 300; y += 7) {
      for (let x = -300; x <= 300; x += 7) {
        seen.add(getWorldTile(x, y).terrain);
      }
    }
    const hasWater = seen.has("water") || seen.has("deep_water") || seen.has("river");
    const landKinds = [...seen].filter(
      (t) => !["water", "deep_water", "river", "beach"].includes(t),
    );
    expect(hasWater).toBe(true);
    expect(landKinds.length).toBeGreaterThanOrEqual(2);
  });

  test("elevation and slope are finite and bounded", () => {
    for (let i = 0; i < 500; i++) {
      const t = getWorldTile(i * 13 - 3000, i * 7 - 1500);
      expect(t.elevation).toBeGreaterThanOrEqual(-1);
      expect(t.elevation).toBeLessThanOrEqual(1);
      expect(Number.isFinite(t.slope)).toBe(true);
      expect(t.slope).toBeGreaterThanOrEqual(0);
    }
  });

  test("water tiles sit below beach elevation, mountains above land", () => {
    for (let i = 0; i < 2000; i++) {
      const t = getWorldTile(i * 11 - 11000, i * 5 - 5000);
      if (t.terrain === "deep_water") expect(t.elevation).toBeLessThan(-0.2);
      if (t.terrain === "rock" || t.terrain === "snow_rock") expect(t.elevation).toBeGreaterThan(0.5);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && bun test src/lib/world/world-gen.test.ts`
Expected: FAIL — cannot resolve `./world-gen` / `./world-config`.

- [ ] **Step 3: Implement `world-config.ts`**

```ts
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
  water: -0.03,
  beach: 0.02,
  rock: 0.62,
  snowRock: 0.78,
  // Climate thresholds
  coldBelow: -0.25,
  hotAbove: 0.3,
  dryBelow: -0.2,
  wetAbove: 0.25,
  altitudeCooling: 0.6,
} as const;
```

- [ ] **Step 4: Implement `world-gen.ts`**

```ts
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
export function getElevation(seed: string, tx: number, ty: number): number {
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
```

- [ ] **Step 5: Run tests**

Run: `cd app && bun test src/lib/world/world-gen.test.ts`
Expected: PASS. If the "varied terrain" test fails because the sampled window is all ocean or all land, adjust `GEN.continentScale` down (e.g. 1500) or the sampled window up — do **not** weaken the assertion.

- [ ] **Step 6: Typecheck and commit**

```bash
cd app && bunx tsc --noEmit
git add src/lib/world/world-config.ts src/lib/world/world-gen.ts src/lib/world/world-gen.test.ts
git commit -m "Add deterministic world generation pipeline with biomes"
```

---

### Task 4: Movement modifiers and climb fatigue (`movement.ts`)

**Files:**
- Create: `app/src/lib/world/movement.ts`
- Test: `app/src/lib/world/movement.test.ts`

**Interfaces:**
- Consumes: `Terrain`, `getWorldTile` from Task 3.
- Produces:
  - `TERRAIN_SPEED: Record<Terrain, number>` — every entry > 0.
  - `class FatigueTracker { update(deltaMs: number, climbing: boolean): void; get multiplier(): number }` — multiplier in [0.4, 1]; full fatigue after ~4 s climbing, full recovery after ~2 s.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/world/movement.test.ts
import { describe, expect, test } from "bun:test";
import { FatigueTracker, TERRAIN_SPEED } from "./movement";
import { getWorldTile } from "./world-gen";

describe("anti-trap invariant", () => {
  test("every terrain has a positive speed multiplier", () => {
    for (const [terrain, mult] of Object.entries(TERRAIN_SPEED)) {
      expect(mult, terrain).toBeGreaterThan(0);
      expect(mult, terrain).toBeLessThanOrEqual(1);
    }
  });

  test("thousands of real world tiles are all walkable", () => {
    for (let y = -400; y <= 400; y += 11) {
      for (let x = -400; x <= 400; x += 11) {
        const t = getWorldTile(x, y);
        expect(TERRAIN_SPEED[t.terrain]).toBeGreaterThan(0);
      }
    }
  });
});

describe("FatigueTracker", () => {
  test("builds up while climbing and caps at 0.4x", () => {
    const f = new FatigueTracker();
    expect(f.multiplier).toBe(1);
    for (let i = 0; i < 100; i++) f.update(100, true); // 10 s climbing
    expect(f.multiplier).toBeCloseTo(0.4, 1);
  });

  test("recovers on flat ground", () => {
    const f = new FatigueTracker();
    for (let i = 0; i < 50; i++) f.update(100, true); // 5 s climbing -> tired
    for (let i = 0; i < 30; i++) f.update(100, false); // 3 s flat
    expect(f.multiplier).toBeCloseTo(1, 1);
  });

  test("partial climb gives partial slowdown", () => {
    const f = new FatigueTracker();
    for (let i = 0; i < 20; i++) f.update(100, true); // 2 s of 4 s ramp
    expect(f.multiplier).toBeLessThan(0.9);
    expect(f.multiplier).toBeGreaterThan(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && bun test src/lib/world/movement.test.ts`
Expected: FAIL — cannot resolve `./movement`.

- [ ] **Step 3: Implement `movement.ts`**

```ts
// app/src/lib/world/movement.ts
// No terrain blocks movement — that is the anti-trap guarantee. Terrain and
// climb fatigue only scale speed, and every multiplier is strictly positive.

import type { Terrain } from "./world-gen";

export const TERRAIN_SPEED: Record<Terrain, number> = {
  deep_water: 0.35,
  water: 0.45,
  river: 0.45,
  beach: 1,
  grass: 1,
  forest: 1,
  jungle: 1,
  swamp: 0.8,
  desert: 1,
  savanna: 1,
  tundra: 1,
  snow: 0.9,
  taiga: 1,
  rock: 1,
  snow_rock: 0.9,
};

const RAMP_UP_MS = 4000; // 0 -> full fatigue while climbing
const RECOVER_MS = 2000; // full -> 0 on flat/downhill
const MIN_MULTIPLIER = 0.4;

export class FatigueTracker {
  private fatigue = 0; // 0..1

  update(deltaMs: number, climbing: boolean): void {
    if (climbing) this.fatigue += deltaMs / RAMP_UP_MS;
    else this.fatigue -= deltaMs / RECOVER_MS;
    this.fatigue = Math.min(1, Math.max(0, this.fatigue));
  }

  get multiplier(): number {
    return 1 - (1 - MIN_MULTIPLIER) * this.fatigue;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd app && bun test src/lib/world/movement.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/world/movement.ts app/src/lib/world/movement.test.ts
git commit -m "Add terrain speed modifiers and climb fatigue"
```

---

### Task 5: Deterministic spawn search

**Files:**
- Modify: `app/src/lib/world/world-gen.ts` (append)
- Test: `app/src/lib/world/world-gen.test.ts` (append)

**Interfaces:**
- Consumes: `getTile` from Task 3.
- Produces: `findSpawn(seed: string): { tx: number; ty: number }` — spiral from (0,0), first plains/forest land tile; same result for everyone.

- [ ] **Step 1: Append failing test**

```ts
// append to app/src/lib/world/world-gen.test.ts
import { findSpawn } from "./world-gen";

describe("findSpawn", () => {
  test("is deterministic and lands on dry, gentle ground", () => {
    const a = findSpawn(WORLD_SEED);
    expect(findSpawn(WORLD_SEED)).toEqual(a);
    const t = getTile(WORLD_SEED, a.tx, a.ty);
    expect(["grass", "forest"]).toContain(t.terrain);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && bun test src/lib/world/world-gen.test.ts`
Expected: FAIL — `findSpawn` not exported.

- [ ] **Step 3: Append implementation to `world-gen.ts`**

```ts
// append to app/src/lib/world/world-gen.ts

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
```

- [ ] **Step 4: Run tests, typecheck**

Run: `cd app && bun test src/lib/world && bunx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/world/world-gen.ts app/src/lib/world/world-gen.test.ts
git commit -m "Add deterministic spiral spawn search"
```

---

### Task 6: Chunk planner (render-agnostic)

**Files:**
- Create: `app/src/lib/world/chunk-manager.ts`
- Test: `app/src/lib/world/chunk-manager.test.ts`

**Interfaces:**
- Consumes: `VIEW_RADIUS`, `CHUNK_SIZE` from `world-config.ts`.
- Produces:
  - `interface ChunkCoord { cx: number; cy: number }`
  - `chunkKey(cx: number, cy: number): string` — `"cx,cy"`.
  - `tileToChunk(t: number): number` — `Math.floor(t / CHUNK_SIZE)`.
  - `neededChunks(center: ChunkCoord, radius: number): ChunkCoord[]`
  - `planChunkUpdates(loaded: ReadonlySet<string>, center: ChunkCoord, radius: number, maxCreates: number): { create: ChunkCoord[]; destroy: string[] }` — `create` sorted nearest-first, capped at `maxCreates`; `destroy` = loaded chunks outside the ring.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/world/chunk-manager.test.ts
import { describe, expect, test } from "bun:test";
import { chunkKey, neededChunks, planChunkUpdates, tileToChunk } from "./chunk-manager";

describe("chunk planner", () => {
  test("tileToChunk floors negatives correctly", () => {
    expect(tileToChunk(0)).toBe(0);
    expect(tileToChunk(31)).toBe(0);
    expect(tileToChunk(32)).toBe(1);
    expect(tileToChunk(-1)).toBe(-1);
    expect(tileToChunk(-32)).toBe(-1);
    expect(tileToChunk(-33)).toBe(-2);
  });

  test("neededChunks returns the full ring", () => {
    const ring = neededChunks({ cx: 10, cy: -5 }, 2);
    expect(ring.length).toBe(25);
    expect(ring).toContainEqual({ cx: 8, cy: -7 });
    expect(ring).toContainEqual({ cx: 12, cy: -3 });
  });

  test("plan creates nearest chunks first, capped, and destroys far ones", () => {
    const loaded = new Set([chunkKey(0, 0), chunkKey(99, 99)]);
    const plan = planChunkUpdates(loaded, { cx: 0, cy: 0 }, 2, 3);
    expect(plan.destroy).toEqual([chunkKey(99, 99)]);
    expect(plan.create.length).toBe(3);
    // nearest missing chunks are the 4-neighbors of center
    for (const c of plan.create) {
      expect(Math.abs(c.cx) + Math.abs(c.cy)).toBeLessThanOrEqual(2);
    }
  });

  test("plan is empty when everything is loaded", () => {
    const loaded = new Set(neededChunks({ cx: 0, cy: 0 }, 2).map((c) => chunkKey(c.cx, c.cy)));
    const plan = planChunkUpdates(loaded, { cx: 0, cy: 0 }, 2, 5);
    expect(plan.create).toEqual([]);
    expect(plan.destroy).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && bun test src/lib/world/chunk-manager.test.ts`
Expected: FAIL — cannot resolve `./chunk-manager`.

- [ ] **Step 3: Implement `chunk-manager.ts`**

```ts
// app/src/lib/world/chunk-manager.ts
// Pure chunk ring planning — knows nothing about Phaser, so the render
// backend (TilemapGPULayer today, anything tomorrow) stays swappable.

import { CHUNK_SIZE } from "./world-config";

export interface ChunkCoord {
  cx: number;
  cy: number;
}

export const chunkKey = (cx: number, cy: number): string => `${cx},${cy}`;

export const tileToChunk = (t: number): number => Math.floor(t / CHUNK_SIZE);

export function neededChunks(center: ChunkCoord, radius: number): ChunkCoord[] {
  const out: ChunkCoord[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      out.push({ cx: center.cx + dx, cy: center.cy + dy });
    }
  }
  return out;
}

export function planChunkUpdates(
  loaded: ReadonlySet<string>,
  center: ChunkCoord,
  radius: number,
  maxCreates: number,
): { create: ChunkCoord[]; destroy: string[] } {
  const needed = neededChunks(center, radius);
  const neededKeys = new Set(needed.map((c) => chunkKey(c.cx, c.cy)));

  const missing = needed.filter((c) => !loaded.has(chunkKey(c.cx, c.cy)));
  missing.sort((a, b) => {
    const da = (a.cx - center.cx) ** 2 + (a.cy - center.cy) ** 2;
    const db = (b.cx - center.cx) ** 2 + (b.cy - center.cy) ** 2;
    return da - db;
  });

  const destroy = [...loaded].filter((k) => !neededKeys.has(k));
  return { create: missing.slice(0, maxCreates), destroy };
}
```

- [ ] **Step 4: Run tests**

Run: `cd app && bun test src/lib/world/chunk-manager.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/world/chunk-manager.ts app/src/lib/world/chunk-manager.test.ts
git commit -m "Add render-agnostic chunk ring planner"
```

---

### Task 7: Curate Classic Faithful tiles + credits

**Files:**
- Create: `assets/tiles/source/*.png` (extracted from the zip, committed)
- Create: `assets/tiles/CREDITS.md`

No unit test — deliverable is verified by listing files. The zip stays out of git (already ignored by pattern; verify).

- [ ] **Step 1: Extract the curated subset from the zip**

Run from the repo root (PowerShell):

```powershell
New-Item -ItemType Directory -Force assets\tiles\source | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead("$PWD\Classic FaithFull 32x Jappa-2026r15.zip")
$wanted = @(
  "grass_block_top.png","moss_block.png","sand.png","sandstone_top.png",
  "stone.png","andesite.png","snow.png","podzol_top.png","coarse_dirt.png",
  "mud.png","gravel.png","dirt.png","water_still.png"
)
foreach ($name in $wanted) {
  $entry = $zip.GetEntry("assets/minecraft/textures/block/$name")
  if ($null -eq $entry) { Write-Output "MISSING: $name"; continue }
  $dest = "assets\tiles\source\$name"
  [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $dest, $true)
  Write-Output "ok: $name"
}
$zip.Dispose()
```

Expected: 13 lines of `ok:`. If any prints `MISSING`, list similar names with a zip listing and pick the closest equivalent (e.g. `grass_top.png`), then update the `SOURCES` table in Task 8 to match.

- [ ] **Step 2: Verify sizes**

Run: `Get-ChildItem assets\tiles\source | Select-Object Name, Length`
Expected: 13 PNGs. `water_still.png` is a tall animation strip (32×N frames); the others are 32×32.

- [ ] **Step 3: Write `assets/tiles/CREDITS.md`**

```markdown
# Tile texture credits

World tile textures are taken from **Classic Faithful 32x (Jappa)** —
https://faithfulpack.net/ — © Faithful Resource Pack contributors.

- License: **Faithful License v3** (see the `license.txt` inside the source
  pack archive). Requirements: clear credit, link back to
  https://faithfulpack.net/, and **no monetization** of content containing
  this work.
- What we use: a small curated subset of `assets/minecraft/textures/block/`
  (ground/water tiles listed in `source/`), resized/tinted at build time by
  `app/scripts/build-tiles.mjs` into the atlas at `app/public/tiles/`.
- Attribution note: Classic Faithful is a faithful recreation of Mojang's
  Minecraft art style. Using it outside Minecraft is an IP gray area on top
  of the license's non-commercial clause.

**Owner TODO (same as the portraits pack):** these assets must be replaced
or relicensed before Hopeland ever monetizes.
```

- [ ] **Step 4: Confirm the zip is not staged, commit**

```bash
git status --short   # must NOT list "Classic FaithFull 32x Jappa-2026r15.zip"
git add assets/tiles/source assets/tiles/CREDITS.md
git commit -m "Add curated Classic Faithful 32x tile subset with credits"
```

If the zip shows up in `git status`, add `*.zip` to the root `.gitignore` in the same commit.

---

### Task 8: Atlas build script (`build-tiles.mjs`)

**Files:**
- Create: `app/scripts/build-tiles.mjs`
- Create (generated, committed): `app/public/tiles/atlas.png`, `app/public/tiles/atlas.json`
- Modify: `app/package.json` (add script `"build:tiles": "node scripts/build-tiles.mjs"`)
- Test: `app/src/lib/world/atlas.test.ts` (validates the committed manifest)

**Interfaces:**
- Produces `atlas.json`:
  ```json
  {
    "tileSize": 32,
    "columns": 8,
    "frames": ["grass_0", "grass_1", "..."],
    "terrain": { "<Terrain>": [frameIndex, ...] },
    "waterFrames": { "water": [i0..i3], "deep_water": [...], "river": [...] }
  }
  ```
  Every `Terrain` value from Task 3 must have at least one frame. `terrain[t][0]` is the primary frame; extra entries are visual variants picked by tile hash.

- [ ] **Step 1: Write the failing manifest test**

```ts
// app/src/lib/world/atlas.test.ts
import { describe, expect, test } from "bun:test";
import manifest from "../../../public/tiles/atlas.json";

const ALL_TERRAINS = [
  "deep_water", "water", "river", "beach", "grass", "forest", "jungle",
  "swamp", "desert", "savanna", "tundra", "snow", "taiga", "rock", "snow_rock",
] as const;

describe("tile atlas manifest", () => {
  test("covers every terrain with valid frame indices", () => {
    expect(manifest.tileSize).toBe(32);
    for (const t of ALL_TERRAINS) {
      const frames = (manifest.terrain as Record<string, number[]>)[t];
      expect(frames, t).toBeDefined();
      expect(frames!.length, t).toBeGreaterThan(0);
      for (const f of frames!) {
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThan(manifest.frames.length);
      }
    }
  });

  test("water terrains have 4 animation frames", () => {
    for (const t of ["water", "deep_water", "river"] as const) {
      expect((manifest.waterFrames as Record<string, number[]>)[t]!.length).toBe(4);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && bun test src/lib/world/atlas.test.ts`
Expected: FAIL — cannot resolve `../../../public/tiles/atlas.json`.

- [ ] **Step 3: Write `app/scripts/build-tiles.mjs`**

```js
// app/scripts/build-tiles.mjs
// Builds public/tiles/atlas.png + atlas.json from assets/tiles/source/.
// Grayscale Minecraft textures (grass, water) are tinted per terrain with a
// multiply blend, mirroring Minecraft's biome colormap approach.
// Output is committed — the Cloudflare build never runs this.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const SRC = path.resolve(import.meta.dirname, "../../assets/tiles/source");
const OUT = path.resolve(import.meta.dirname, "../public/tiles");
const TILE = 32;
const COLUMNS = 8;

const tint = (hex) => async (file) =>
  sharp(path.join(SRC, file))
    .extract({ left: 0, top: 0, width: TILE, height: TILE })
    .composite([{ input: { create: { width: TILE, height: TILE, channels: 4, background: hex } }, blend: "multiply" }])
    .png()
    .toBuffer();

const plain = () => async (file) =>
  sharp(path.join(SRC, file))
    .extract({ left: 0, top: 0, width: TILE, height: TILE })
    .png()
    .toBuffer();

// Water: crop 4 frames (rows 0-3) from the animation strip, then tint.
const waterFrame = (row, hex) => async (file) =>
  sharp(path.join(SRC, file))
    .extract({ left: 0, top: row * TILE, width: TILE, height: TILE })
    .composite([{ input: { create: { width: TILE, height: TILE, channels: 4, background: hex } }, blend: "multiply" }])
    .png()
    .toBuffer();

// name -> { file, make } ; order defines frame indices.
const FRAME_DEFS = [];
const TERRAIN = {};
const WATER_FRAMES = {};

function def(terrain, name, file, make) {
  FRAME_DEFS.push({ name, file, make });
  (TERRAIN[terrain] ??= []).push(FRAME_DEFS.length - 1);
}

// Land terrains (variants: primary first).
def("grass", "grass_0", "grass_block_top.png", tint("#91BD59"));
def("grass", "grass_1", "moss_block.png", tint("#A5C97A"));
def("forest", "forest_0", "grass_block_top.png", tint("#79C05A"));
def("forest", "forest_1", "moss_block.png", tint("#79C05A"));
def("jungle", "jungle_0", "grass_block_top.png", tint("#59C93C"));
def("jungle", "jungle_1", "moss_block.png", tint("#59C93C"));
def("savanna", "savanna_0", "grass_block_top.png", tint("#BFB755"));
def("savanna", "savanna_1", "coarse_dirt.png", plain());
def("taiga", "taiga_0", "podzol_top.png", plain());
def("taiga", "taiga_1", "grass_block_top.png", tint("#86B783"));
def("tundra", "tundra_0", "grass_block_top.png", tint("#80B497"));
def("tundra", "tundra_1", "coarse_dirt.png", plain());
def("swamp", "swamp_0", "mud.png", plain());
def("swamp", "swamp_1", "grass_block_top.png", tint("#6A7039"));
def("desert", "desert_0", "sand.png", plain());
def("desert", "desert_1", "sandstone_top.png", plain());
def("beach", "beach_0", "sand.png", plain());
def("snow", "snow_0", "snow.png", plain());
def("rock", "rock_0", "stone.png", plain());
def("rock", "rock_1", "andesite.png", plain());
def("snow_rock", "snow_rock_0", "snow.png", plain());
def("snow_rock", "snow_rock_1", "gravel.png", plain());

// Water animation frames.
for (const [terrain, hex] of [
  ["water", "#3F76E4"],
  ["deep_water", "#2A4F9E"],
  ["river", "#4F86E8"],
]) {
  WATER_FRAMES[terrain] = [];
  for (let row = 0; row < 4; row++) {
    FRAME_DEFS.push({ name: `${terrain}_${row}`, file: "water_still.png", make: waterFrame(row, hex) });
    WATER_FRAMES[terrain].push(FRAME_DEFS.length - 1);
  }
  TERRAIN[terrain] = [WATER_FRAMES[terrain][0]];
}

const buffers = [];
for (const d of FRAME_DEFS) buffers.push(await d.make(d.file));

const rows = Math.ceil(FRAME_DEFS.length / COLUMNS);
const composites = buffers.map((input, i) => ({
  input,
  left: (i % COLUMNS) * TILE,
  top: Math.floor(i / COLUMNS) * TILE,
}));

await mkdir(OUT, { recursive: true });
await sharp({
  create: { width: COLUMNS * TILE, height: rows * TILE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite(composites)
  .png()
  .toFile(path.join(OUT, "atlas.png"));

await writeFile(
  path.join(OUT, "atlas.json"),
  JSON.stringify(
    {
      tileSize: TILE,
      columns: COLUMNS,
      frames: FRAME_DEFS.map((d) => d.name),
      terrain: TERRAIN,
      waterFrames: WATER_FRAMES,
    },
    null,
    2,
  ),
);

console.log(`atlas: ${FRAME_DEFS.length} frames, ${COLUMNS}x${rows}`);
```

- [ ] **Step 4: Add the npm script and run the build**

In `app/package.json`, next to `"build:portraits"`, add:

```json
"build:tiles": "node scripts/build-tiles.mjs",
```

Run: `cd app && bun run build:tiles`
Expected: `atlas: 34 frames, 8x5` (22 land + 12 water frames). Open `app/public/tiles/atlas.png` and **look at it** — tiles must be recognizable, tints must look like grass/water, not neon.

- [ ] **Step 5: Run the manifest test**

Run: `cd app && bun test src/lib/world/atlas.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit (script + generated output together)**

```bash
git add app/scripts/build-tiles.mjs app/package.json app/public/tiles app/src/lib/world/atlas.test.ts
git commit -m "Add tile atlas build pipeline from Classic Faithful subset"
```

---

### Task 9: Rewrite `PhaserGame.tsx` — world scene

**Files:**
- Modify: `app/src/components/PhaserGame.tsx` (full rewrite of the scene; keep the exported component signature `PhaserGame({ onPositionChange })`)

**Interfaces:**
- Consumes:
  - `getWorldTile(tx, ty): Tile`, `findSpawn(seed)` , `WORLD_SEED` (Tasks 3/5)
  - `TERRAIN_SPEED`, `FatigueTracker` (Task 4)
  - `chunkKey`, `tileToChunk`, `planChunkUpdates` (Task 6)
  - `TILE_SIZE`, `CHUNK_SIZE`, `CHUNK_PX`, `VIEW_RADIUS`, `MAX_CHUNK_CREATES_PER_FRAME`, `CLIMB_DELTA` (config)
  - `/tiles/atlas.png` + `/tiles/atlas.json` (Task 8)
- Produces: the playable world. `onPositionChange` keeps reporting player pixel coordinates (unchanged contract with `game.tsx`).

No unit test (Phaser scene); verified by running the dev server in Task 10.

- [ ] **Step 1: Rewrite `PhaserGame.tsx`**

```tsx
// app/src/components/PhaserGame.tsx
import { useEffect, useRef } from "react";
import Phaser from "phaser";
import {
  CHUNK_PX,
  CHUNK_SIZE,
  CLIMB_DELTA,
  MAX_CHUNK_CREATES_PER_FRAME,
  TILE_SIZE,
  VIEW_RADIUS,
  WORLD_SEED,
} from "@/lib/world/world-config";
import { findSpawn, getWorldTile } from "@/lib/world/world-gen";
import { FatigueTracker, TERRAIN_SPEED } from "@/lib/world/movement";
import { chunkKey, planChunkUpdates, tileToChunk } from "@/lib/world/chunk-manager";

interface PhaserGameProps {
  onPositionChange?: (x: number, y: number) => void;
}

interface AtlasManifest {
  tileSize: number;
  columns: number;
  frames: string[];
  terrain: Record<string, number[]>;
  waterFrames: Record<string, number[]>;
}

interface LoadedChunk {
  map: Phaser.Tilemaps.Tilemap;
  layer: Phaser.GameObjects.GameObject;
}

/** Deterministic per-tile hash for picking texture variants. */
function tileHash(tx: number, ty: number): number {
  let h = (Math.imul(tx, 73856093) ^ Math.imul(ty, 19349663)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
  return h;
}

class WorldScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private cursors!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  private onMove?: (x: number, y: number) => void;
  private lastEmit = 0;
  private manifest!: AtlasManifest;
  private chunks = new Map<string, LoadedChunk>();
  private fatigue = new FatigueTracker();

  constructor(onMove?: (x: number, y: number) => void) {
    super("WorldScene");
    this.onMove = onMove;
  }

  preload() {
    this.load.spritesheet("tiles", "/tiles/atlas.png", {
      frameWidth: TILE_SIZE,
      frameHeight: TILE_SIZE,
    });
    this.load.json("tiles-manifest", "/tiles/atlas.json");
  }

  create() {
    this.manifest = this.cache.json.get("tiles-manifest") as AtlasManifest;

    const spawn = findSpawn(WORLD_SEED);
    const px = spawn.tx * TILE_SIZE + TILE_SIZE / 2;
    const py = spawn.ty * TILE_SIZE + TILE_SIZE / 2;

    this.player = this.add.rectangle(px, py, 24, 24, 0xf5c542);
    this.player.setStrokeStyle(2, 0x000000);
    this.player.setDepth(10);

    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);

    this.cursors = this.input.keyboard!.addKeys("W,A,S,D") as typeof this.cursors;

    this.updateChunks(true);
  }

  private frameFor(terrain: string, tx: number, ty: number): number {
    const frames = this.manifest.terrain[terrain] ?? this.manifest.terrain["grass"]!;
    return frames[tileHash(tx, ty) % frames.length]!;
  }

  private createChunk(cx: number, cy: number) {
    const data: number[][] = [];
    for (let y = 0; y < CHUNK_SIZE; y++) {
      const row: number[] = [];
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const tx = cx * CHUNK_SIZE + x;
        const ty = cy * CHUNK_SIZE + y;
        row.push(this.frameFor(getWorldTile(tx, ty).terrain, tx, ty));
      }
      data.push(row);
    }

    const map = this.make.tilemap({ data, tileWidth: TILE_SIZE, tileHeight: TILE_SIZE });
    const tileset = map.addTilesetImage("tiles", "tiles", TILE_SIZE, TILE_SIZE, 0, 0)!;

    let layer: Phaser.GameObjects.GameObject;
    const GPULayer = (Phaser.Tilemaps as unknown as Record<string, unknown>)["TilemapGPULayer"] as
      | (new (
          scene: Phaser.Scene,
          tilemap: Phaser.Tilemaps.Tilemap,
          layerIndex: number,
          tileset: Phaser.Tilemaps.Tileset,
          x?: number,
          y?: number,
        ) => Phaser.GameObjects.GameObject)
      | undefined;
    try {
      if (!GPULayer) throw new Error("TilemapGPULayer unavailable");
      const gpu = new GPULayer(this, map, 0, tileset, cx * CHUNK_PX, cy * CHUNK_PX);
      this.add.existing(gpu);
      layer = gpu;
    } catch {
      // Fallback (canvas renderer or API change): classic layer, still correct.
      layer = map.createLayer(0, tileset, cx * CHUNK_PX, cy * CHUNK_PX)!;
    }
    this.chunks.set(chunkKey(cx, cy), { map, layer });
  }

  private updateChunks(force = false) {
    const center = {
      cx: tileToChunk(Math.floor(this.player.x / TILE_SIZE)),
      cy: tileToChunk(Math.floor(this.player.y / TILE_SIZE)),
    };
    const plan = planChunkUpdates(
      new Set(this.chunks.keys()),
      center,
      VIEW_RADIUS,
      force ? (VIEW_RADIUS * 2 + 1) ** 2 : MAX_CHUNK_CREATES_PER_FRAME,
    );
    for (const key of plan.destroy) {
      const chunk = this.chunks.get(key)!;
      chunk.layer.destroy();
      chunk.map.destroy();
      this.chunks.delete(key);
    }
    for (const c of plan.create) this.createChunk(c.cx, c.cy);
  }

  update(_time: number, delta: number) {
    let dx = 0;
    let dy = 0;
    if (this.cursors.W.isDown) dy -= 1;
    if (this.cursors.S.isDown) dy += 1;
    if (this.cursors.A.isDown) dx -= 1;
    if (this.cursors.D.isDown) dx += 1;

    const tx = Math.floor(this.player.x / TILE_SIZE);
    const ty = Math.floor(this.player.y / TILE_SIZE);
    const here = getWorldTile(tx, ty);

    let climbing = false;
    if (dx !== 0 || dy !== 0) {
      const ahead = getWorldTile(tx + Math.sign(dx), ty + Math.sign(dy));
      climbing = ahead.elevation - here.elevation > CLIMB_DELTA;
    }
    this.fatigue.update(delta, climbing && (dx !== 0 || dy !== 0));

    if (dx !== 0 || dy !== 0) {
      const norm = Math.hypot(dx, dy);
      const speed = 0.2 * delta * TERRAIN_SPEED[here.terrain] * this.fatigue.multiplier;
      this.player.x += (dx / norm) * speed;
      this.player.y += (dy / norm) * speed;

      const now = performance.now();
      if (this.onMove && now - this.lastEmit > 50) {
        this.lastEmit = now;
        this.onMove(this.player.x, this.player.y);
      }
    }

    this.updateChunks();
  }
}

export function PhaserGame({ onPositionChange }: PhaserGameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    const game = new Phaser.Game({
      type: Phaser.WEBGL,
      parent: containerRef.current,
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      backgroundColor: "#1a2a1a",
      scene: new WorldScene(onPositionChange),
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
    });

    gameRef.current = game;

    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
  }, [onPositionChange]);

  return <div ref={containerRef} className="w-full h-full" />;
}
```

Notes for the implementer:
- If `@/` path alias is not configured in this repo, use relative imports (`../lib/world/...`) — check how `game.tsx` imports `lib` modules and follow that pattern.
- `Phaser.WEBGL` (not `AUTO`) per spec; the GPU layer is WebGL-only. The try/catch fallback still protects against API drift.
- Deliberate simplification vs the spec: no layer pool / tile-data LRU in v1. Creation is budgeted to 1 chunk/frame and generation costs ~ms, so churn is negligible; add pooling only if profiling shows hitches.

- [ ] **Step 2: Typecheck and test suite**

Run: `cd app && bunx tsc --noEmit && bun test`
Expected: no type errors, all tests pass. Fix import alias/typing issues now.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/PhaserGame.tsx
git commit -m "Render infinite procedural world in Phaser scene"
```

---

### Task 10: Visual verification — world map render + live run

**Files:**
- Create: `app/scripts/render-world-map.ts` (throwaway-style but committed — it is the world's visual test harness, like the portrait rule in AGENTS.md §7.5)

- [ ] **Step 1: Write the map renderer (bun runs TS directly)**

```ts
// app/scripts/render-world-map.ts
// Renders a biome-colored PNG of the real generator output for visual
// inspection (AGENTS.md §7.5 applied to the world system).
// Usage: bun scripts/render-world-map.ts [sizeTiles=1024] [step=2]

import sharp from "sharp";
import { getWorldTile, type Terrain } from "../src/lib/world/world-gen";

const COLORS: Record<Terrain, [number, number, number]> = {
  deep_water: [42, 79, 158],
  water: [63, 118, 228],
  river: [79, 134, 232],
  beach: [219, 203, 158],
  grass: [145, 189, 89],
  forest: [95, 156, 74],
  jungle: [64, 165, 50],
  swamp: [106, 112, 57],
  desert: [229, 216, 172],
  savanna: [191, 183, 85],
  tundra: [128, 180, 151],
  snow: [240, 244, 248],
  taiga: [134, 183, 131],
  rock: [130, 130, 130],
  snow_rock: [210, 215, 222],
};

const size = Number(process.argv[2] ?? 1024);
const step = Number(process.argv[3] ?? 2);
const px = Math.floor(size / step);
const buf = Buffer.alloc(px * px * 3);

for (let y = 0; y < px; y++) {
  for (let x = 0; x < px; x++) {
    const t = getWorldTile((x - px / 2) * step, (y - px / 2) * step);
    const [r, g, b] = COLORS[t.terrain];
    // Shade land by elevation so mountains/valleys read at a glance.
    const shade = t.terrain.includes("water") ? 1 : 0.75 + 0.25 * Math.max(0, t.elevation);
    const i = (y * px + x) * 3;
    buf[i] = Math.round(r * shade);
    buf[i + 1] = Math.round(g * shade);
    buf[i + 2] = Math.round(b * shade);
  }
}

await sharp(buf, { raw: { width: px, height: px, channels: 3 } })
  .png()
  .toFile("world-map.png");
console.log(`world-map.png: ${px}x${px} px, ${size}x${size} tiles centered on (0,0)`);
```

- [ ] **Step 2: Render and LOOK at the map**

Run: `cd app && bun scripts/render-world-map.ts 2048 2`
Then **open/Read `app/world-map.png` and inspect it** against this checklist:
- Continents and oceans exist (not all-land, not all-sea) with organic, warped coastlines.
- Mountain chains read as ridges (not round blobs), snow-capped where high.
- Rivers: thin connected bands crossing land toward low elevation.
- Biome patches on the order of ~500 tiles (≈ a quarter of a 2048 map), no checkerboard noise, compatible neighbors mostly (no desert glued to snow everywhere — some contact is fine on mountains).

(The spec's "biome scale ~500 tiles" check is done here visually instead of as a statistical unit test — a patch-size estimator is flaky by nature; the map makes the scale obvious at a glance.)

If something is off, tune `GEN` constants (`continentScale`, `hotAbove`/`coldBelow`, `riverWidth`, ridge weight) and re-render until it looks like a plausible world map. Commit the tuned constants. Do not commit `world-map.png` (add to `.gitignore` in `app/` if needed).

- [ ] **Step 3: Run the real game**

Run: `cd app && bun run dev` and open http://localhost:3000.
Auth against Supabase does not work in dev (AGENTS.md §4) — if the game route requires a session, temporarily verify via a standalone check instead: confirm the route renders the Phaser canvas, chunks appear as you move (WASD), water slows you down, climbing a mountain slows you progressively, and no gaps/flicker at chunk borders. State explicitly in the task report what could and could not be exercised.

- [ ] **Step 4: Commit**

```bash
git add app/scripts/render-world-map.ts app/.gitignore
git commit -m "Add world map visual verification script"
```

---

### Task 11: Water animation on the GPU layer (bounded attempt)

**Files:**
- Modify: `app/src/components/PhaserGame.tsx`

Timebox: if the Phaser 4 tileset animation API does not work as documented within ~30 min of effort, revert this task's changes, keep static water, and record a follow-up note in the PR description. Static water is the accepted fallback — do not fight the API.

- [ ] **Step 1: Add animation data to the tileset before creating the GPU layer**

In `createChunk`, after `map.addTilesetImage(...)`, set tile animation data for the three water frame sets (per docs.phaser.io TilemapGPULayer: "Define animations through your tileset's animation data before creating the layer"):

```ts
const wf = this.manifest.waterFrames;
for (const frames of [wf["water"]!, wf["deep_water"]!, wf["river"]!]) {
  const tsData = (tileset as unknown as { tileData: Record<number, unknown> }).tileData;
  tsData[frames[0]!] = {
    animation: frames.map((f) => ({ tileid: f, duration: 400 })),
  };
}
```

- [ ] **Step 2: Verify in the browser**

Run: `cd app && bun run dev` — water tiles must cycle frames (~0.4 s each). If they do not, check the Phaser 4 examples for `TilemapGPULayer` animation; adjust the data shape once. If still broken, revert (`git checkout -- app/src/components/PhaserGame.tsx`) and move on.

- [ ] **Step 3: Commit (only if working)**

```bash
git add app/src/components/PhaserGame.tsx
git commit -m "Animate water tiles on the GPU tilemap layer"
```

---

### Task 12: Final verification, docs, and wrap-up

**Files:**
- Modify: `AGENTS.md` (§3 structure, §9 history)

- [ ] **Step 1: Full quality gate (AGENTS.md §7.2)**

Run: `cd app && bunx tsc --noEmit && bun test && bun run build`
Expected: all three pass. Paste actual output in the task report.

- [ ] **Step 2: Update `AGENTS.md`**

In §3, inside the `src/lib/` listing, add after the `security-headers.ts` line:

```
│   │   │   ├── world/                  # mundo procedural (ruído, geração, chunks, movimento)
```

In §3, after the `scripts/build-portraits.mjs` line, add:

```
│   │   └── build-tiles.mjs       # sharp: Classic Faithful subset -> atlas de tiles
```

In §3 `assets/` section, extend to:

```
├── assets/portraits/
│   ├── source/               # subset CURADO dos PNGs do mod (versionado)
│   └── CREDITS.md            # atribuição + licença dos assets (ver §5.4)
├── assets/tiles/
│   ├── source/               # subset CURADO do Classic Faithful 32x (versionado)
│   └── CREDITS.md            # Faithful License v3 — atribuição, não-comercial
```

In §9, append:

```
12. **Mundo procedural** — geração determinística infinita (seed "Esperança"),
    biomas Whittaker com erosão/warp/rios, chunks TilemapGPULayer, atlas
    Classic Faithful 32x, movimento sem colisão (nado + fadiga de subida).
```

- [ ] **Step 3: Commit docs**

```bash
git add AGENTS.md
git commit -m "Document procedural world system in project guide"
```

- [ ] **Step 4: Finish the branch**

Use the superpowers:finishing-a-development-branch skill — push `feat/procedural-world`, open a PR to `main` (PR body in English, ends with the standard generated-with footer per harness rules; no co-author trailer in commits). Include the visual verification results (world map screenshot + what was/wasn't exercised in dev) in the PR description.
