# Oblique 2.5D Block Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat top-down renderer with a straight-grid oblique 2.5D view: elevation becomes visible block height (raised tops + south-facing walls), water sits recessed, and the player shows a silhouette when terrain hides it.

**Architecture:** A pure projection module (`projection.ts`) maps elevation to 14 half-block levels and computes screen offsets and wall heights. Each chunk is baked **once** into a `RenderTexture` (tops shifted up by level, wall strips where the south neighbor is lower), drawn with `depth = cy` so southern rows paint over hanging walls. The player renders always-on-top and switches to a translucent silhouette style when an analytic test says terrain covers it. Generation, chunk planning, movement, spawn and render-on-demand are untouched.

**Tech Stack:** TypeScript, Phaser 4.2 `RenderTexture` (batching is automatic in v4 — the old `beginDraw/batchDraw` API was removed; do NOT use it), sharp (wall strip assets), bun.

**Spec:** `docs/superpowers/specs/2026-07-17-oblique-block-renderer-design.md`

## Global Constraints

- Work on branch `feat/oblique-renderer`. Never commit to `main`. No `Co-Authored-By` trailer. Commit messages in English, imperative.
- All commands inside `app/` with bun: `bun test`, `bunx tsc --noEmit`, `bun run build`.
- Tests co-located `app/src/lib/world/*.test.ts`. The repo's bun:test types reject `expect(value, message)` — always single-argument `expect`.
- `@/` path alias works in `app/src` (e.g. `@/lib/world/projection`).
- Projection values (from spec, exact): tile 32px; half-block `HALF_STEP_PX = 16`; levels 0..13 (`MAX_LEVEL = 13`); water = level 0; land = 1..13; max height 208px; RT pad 208px top and bottom (RT 1024×1440 at `(cx*1024, cy*1024 - 208)`).
- No masks inside the bake (open Phaser 4 issues #7306/#7000 involve masks; our path must stay off it).
- Atlas outputs in `app/public/tiles/` are committed; Cloudflare never runs the pipeline.
- `pickVariant` (from `@/lib/world/tile-variants`) keeps choosing top frames — do not reintroduce raw modulo hashing.
- Mechanic invariants must not change: `TERRAIN_SPEED`, `FatigueTracker`, `findSpawn`, `planChunkUpdates`, `getWorldTile` signatures and behavior are frozen.

---

### Task 1: Projection module (`projection.ts`)

**Files:**
- Create: `app/src/lib/world/projection.ts`
- Modify: `app/src/lib/world/world-config.ts` (append constants)
- Test: `app/src/lib/world/projection.test.ts`

**Interfaces:**
- Consumes: `Tile` from `./world-gen`, `GEN` from `./world-config`.
- Produces (exact, later tasks import these):
  - Constants in `world-config.ts`: `HALF_STEP_PX = 16`, `MAX_LEVEL = 13`, `RT_PAD_PX = 208`, `CHUNK_RT_HEIGHT_PX = CHUNK_PX + 2 * RT_PAD_PX`.
  - `levelFor(tile: Pick<Tile, "terrain" | "elevation">): number` — 0 for the three water terrains, 1..13 for land, monotonic in elevation.
  - `projectY(tyPx: number, level: number): number` — `tyPx - level * HALF_STEP_PX` (input already in pixels).
  - `wallStripsFor(level: number, southLevel: number): number` — `Math.max(0, level - southLevel)`.
  - `isOccluded(playerLevel: number, southLevels: number[][]): boolean` — `southLevels[d]` holds the levels of the tile columns the player overlaps at row offset `d+1` (d = 0..2); occluded iff any `lvl - playerLevel >= 2 * (d + 1)`.

- [ ] **Step 1: Append constants to `world-config.ts`**

```ts
// append to app/src/lib/world/world-config.ts

// Oblique 2.5D projection (spec 2026-07-17): straight grid, square tops,
// elevation as block height. Half a block per level, south walls only.
export const HALF_STEP_PX = 16;
export const MAX_LEVEL = 13; // land levels 1..13; water is 0
export const RT_PAD_PX = MAX_LEVEL * HALF_STEP_PX; // 208
export const CHUNK_RT_HEIGHT_PX = CHUNK_PX + 2 * RT_PAD_PX; // 1440
```

- [ ] **Step 2: Write the failing test**

```ts
// app/src/lib/world/projection.test.ts
import { describe, expect, test } from "bun:test";
import { isOccluded, levelFor, projectY, wallStripsFor } from "./projection";
import { getWorldTile } from "./world-gen";
import { CHUNK_SIZE, GEN, HALF_STEP_PX, MAX_LEVEL } from "./world-config";

describe("levelFor", () => {
  test("water terrains are always level 0", () => {
    expect(levelFor({ terrain: "deep_water", elevation: -0.5 })).toBe(0);
    expect(levelFor({ terrain: "water", elevation: -0.02 })).toBe(0);
    expect(levelFor({ terrain: "river", elevation: 0.3 })).toBe(0);
  });

  test("land is in [1, 13], beach at level 1, peak at 13", () => {
    expect(levelFor({ terrain: "beach", elevation: GEN.beach })).toBe(1);
    expect(levelFor({ terrain: "grass", elevation: GEN.beach + 0.001 })).toBe(1);
    expect(levelFor({ terrain: "snow_rock", elevation: 1 })).toBe(MAX_LEVEL);
    for (let e = GEN.beach; e <= 1; e += 0.01) {
      const l = levelFor({ terrain: "grass", elevation: e });
      expect(l).toBeGreaterThanOrEqual(1);
      expect(l).toBeLessThanOrEqual(MAX_LEVEL);
    }
  });

  test("is monotonic in elevation", () => {
    let prev = 0;
    for (let e = GEN.beach; e <= 1; e += 0.005) {
      const l = levelFor({ terrain: "grass", elevation: e });
      expect(l).toBeGreaterThanOrEqual(prev);
      prev = l;
    }
  });

  test("real world tiles all produce valid levels", () => {
    for (let y = -200; y <= 200; y += 13) {
      for (let x = -200; x <= 200; x += 13) {
        const t = getWorldTile(x, y);
        const l = levelFor(t);
        expect(l).toBeGreaterThanOrEqual(0);
        expect(l).toBeLessThanOrEqual(MAX_LEVEL);
        if (t.terrain === "deep_water" || t.terrain === "water" || t.terrain === "river") {
          expect(l).toBe(0);
        } else {
          expect(l).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });
});

describe("projectY / wallStripsFor", () => {
  test("projectY lifts by level in half steps", () => {
    expect(projectY(320, 0)).toBe(320);
    expect(projectY(320, 4)).toBe(320 - 4 * HALF_STEP_PX);
    expect(projectY(-64, 13)).toBe(-64 - 208);
  });

  test("walls only where the south neighbor is lower", () => {
    expect(wallStripsFor(5, 2)).toBe(3);
    expect(wallStripsFor(2, 5)).toBe(0);
    expect(wallStripsFor(3, 3)).toBe(0);
    expect(wallStripsFor(1, 0)).toBe(1); // shoreline ledge
  });

  test("wall computation is consistent across a chunk border", () => {
    // Row 31 of chunk (0,0) borders row 0 of chunk (0,1). The wall count
    // computed from getWorldTile must not care about the chunk boundary.
    for (let tx = 0; tx < CHUNK_SIZE; tx += 3) {
      const north = getWorldTile(tx, CHUNK_SIZE - 1);
      const south = getWorldTile(tx, CHUNK_SIZE);
      const strips = wallStripsFor(levelFor(north), levelFor(south));
      expect(strips).toBeGreaterThanOrEqual(0);
      expect(strips).toBe(Math.max(0, levelFor(north) - levelFor(south)));
    }
  });
});

describe("isOccluded", () => {
  test("deep spot behind a high wall is occluded", () => {
    // player level 2; one row south there is a level-6 ridge: 6-2 >= 2*1
    expect(isOccluded(2, [[6], [6, 5], [3]])).toBe(true);
  });

  test("flat ground never occludes", () => {
    expect(isOccluded(3, [[3, 3], [3], [3]])).toBe(false);
  });

  test("gentle slope south does not occlude", () => {
    // +1 per row is a normal hillside, not an occluder
    expect(isOccluded(4, [[5], [6], [7]])).toBe(false);
  });

  test("far ridge needs to be proportionally taller", () => {
    expect(isOccluded(1, [[2], [3], [7]])).toBe(true); // 7-1 >= 2*3
    expect(isOccluded(1, [[2], [3], [6]])).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd app && bun test src/lib/world/projection.test.ts`
Expected: FAIL — cannot resolve `./projection`.

- [ ] **Step 4: Implement `projection.ts`**

```ts
// app/src/lib/world/projection.ts
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd app && bun test src/lib/world/projection.test.ts`
Expected: PASS (all describes).

- [ ] **Step 6: Typecheck and commit**

```bash
cd app && bunx tsc --noEmit
git add src/lib/world/projection.ts src/lib/world/projection.test.ts src/lib/world/world-config.ts
git commit -m "Add oblique projection module with block levels"
```

---

### Task 2: Wall strip assets (`walls.png` + `walls.json`)

**Files:**
- Modify: `app/scripts/build-tiles.mjs` (append wall generation)
- Create (generated, committed): `app/public/tiles/walls.png`, `app/public/tiles/walls.json`
- Test: `app/src/lib/world/atlas.test.ts` (append)

**Interfaces:**
- Produces `app/public/tiles/walls.json`:
  ```json
  {
    "stripWidth": 32,
    "stripHeight": 16,
    "frames": ["dirt", "sand", "stone", "snow"],
    "terrain": { "<land Terrain>": <frameIndex> }
  }
  ```
  Every **land** terrain (grass, forest, jungle, swamp, desert, savanna, tundra, snow, taiga, rock, snow_rock, beach) maps to a frame index. Water terrains (deep_water, water, river) are deliberately absent — level 0 never has a south wall.
- `walls.png` is a vertical spritesheet of 32×16 strips in `frames` order (32×64 total).

- [ ] **Step 1: Append the failing manifest test**

```ts
// append to app/src/lib/world/atlas.test.ts
import walls from "../../../public/tiles/walls.json";

const LAND_TERRAINS = [
  "beach", "grass", "forest", "jungle", "swamp", "desert", "savanna",
  "tundra", "snow", "taiga", "rock", "snow_rock",
] as const;

describe("wall strips manifest", () => {
  test("covers every land terrain with a valid frame", () => {
    expect(walls.stripWidth).toBe(32);
    expect(walls.stripHeight).toBe(16);
    for (const t of LAND_TERRAINS) {
      const f = (walls.terrain as Record<string, number>)[t];
      expect(f).toBeDefined();
      expect(f!).toBeGreaterThanOrEqual(0);
      expect(f!).toBeLessThan(walls.frames.length);
    }
  });

  test("water terrains have no wall entry", () => {
    for (const t of ["deep_water", "water", "river"]) {
      expect((walls.terrain as Record<string, number>)[t]).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && bun test src/lib/world/atlas.test.ts`
Expected: FAIL — cannot resolve `../../../public/tiles/walls.json`.

- [ ] **Step 3: Append wall generation to `build-tiles.mjs`**

Append after the existing atlas write (reuse the existing `SRC`/`OUT`/`TILE` constants and `sharp` import):

```js
// ---- South wall strips (oblique 2.5D renderer) --------------------------
// One 32x16 strip per material, darkened so walls read as shaded faces.
// Faithful to Minecraft: grass-family sides are dirt, desert/beach sand,
// mountain stone, snow snow.

const WALL_SOURCES = [
  ["dirt", "dirt.png"],
  ["sand", "sand.png"],
  ["stone", "stone.png"],
  ["snow", "snow.png"],
];

const WALL_TERRAIN = {
  beach: "sand",
  grass: "dirt",
  forest: "dirt",
  jungle: "dirt",
  swamp: "dirt",
  desert: "sand",
  savanna: "dirt",
  tundra: "dirt",
  snow: "snow",
  taiga: "dirt",
  rock: "stone",
  snow_rock: "snow",
};

const STRIP_H = 16;
const wallBuffers = [];
for (const [, file] of WALL_SOURCES) {
  wallBuffers.push(
    await sharp(path.join(SRC, file))
      .extract({ left: 0, top: 0, width: TILE, height: STRIP_H })
      .composite([
        // Uniform darkening so the face reads as shadowed…
        { input: { create: { width: TILE, height: STRIP_H, channels: 4, background: "#8f8f8f" } }, blend: "multiply" },
        // …plus a darker foot for depth.
        { input: Buffer.from(
            `<svg width="${TILE}" height="${STRIP_H}"><rect y="${STRIP_H - 4}" width="${TILE}" height="4" fill="rgba(0,0,0,0.35)"/></svg>`,
          ), blend: "over" },
      ])
      .png()
      .toBuffer(),
  );
}

await sharp({
  create: { width: TILE, height: STRIP_H * WALL_SOURCES.length, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite(wallBuffers.map((input, i) => ({ input, left: 0, top: i * STRIP_H })))
  .png()
  .toFile(path.join(OUT, "walls.png"));

const wallFrameIndex = Object.fromEntries(WALL_SOURCES.map(([name], i) => [name, i]));
await writeFile(
  path.join(OUT, "walls.json"),
  JSON.stringify(
    {
      stripWidth: TILE,
      stripHeight: STRIP_H,
      frames: WALL_SOURCES.map(([name]) => name),
      terrain: Object.fromEntries(
        Object.entries(WALL_TERRAIN).map(([t, mat]) => [t, wallFrameIndex[mat]]),
      ),
    },
    null,
    2,
  ),
);

console.log(`walls: ${WALL_SOURCES.length} strips`);
```

- [ ] **Step 4: Run the build and LOOK at the output**

Run: `cd app && bun run build:tiles`
Expected: previous atlas log line plus `walls: 4 strips`. Read `app/public/tiles/walls.png` as an image: four 32×16 strips (dirt, sand, stone, snow), clearly darker than the tops, with a darker foot line. Not black, not neon.

- [ ] **Step 5: Run the manifest tests**

Run: `cd app && bun test src/lib/world/atlas.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit (script + outputs together)**

```bash
git add app/scripts/build-tiles.mjs app/public/tiles/walls.png app/public/tiles/walls.json app/src/lib/world/atlas.test.ts
git commit -m "Add south wall strip assets for the oblique renderer"
```

---

### Task 3: Chunk bake — RenderTexture terrain

**Files:**
- Modify: `app/src/components/PhaserGame.tsx` (chunk creation/destroy path only; player untouched in this task)

**Interfaces:**
- Consumes: `levelFor`, `projectY`, `wallStripsFor` from `@/lib/world/projection`; `HALF_STEP_PX`, `RT_PAD_PX`, `CHUNK_RT_HEIGHT_PX` from `@/lib/world/world-config`; `walls.json` shape from Task 2; existing `pickVariant`, `getWorldTile`, chunk planner.
- Produces: `LoadedChunk` becomes `{ rt: Phaser.GameObjects.RenderTexture }`; `createChunk(cx, cy)` bakes terrain; chunk `depth = cy`. Later tasks rely on the scene fields staying named `chunks`, `manifest`, and on a new field `wallsManifest`.

No unit test (Phaser scene) — gate is `bunx tsc --noEmit && bun test && bun run build`.

- [ ] **Step 1: Replace the chunk rendering path in `PhaserGame.tsx`**

Preload additions (inside `preload()`, keep the existing two loads):

```ts
    this.load.spritesheet("walls", "/tiles/walls.png", {
      frameWidth: TILE_SIZE,
      frameHeight: 16,
    });
    this.load.json("walls-manifest", "/tiles/walls.json");
```

New interface/fields (replace `LoadedChunk` and add the manifest field):

```ts
interface WallsManifest {
  stripWidth: number;
  stripHeight: number;
  frames: string[];
  terrain: Record<string, number>;
}

interface LoadedChunk {
  rt: Phaser.GameObjects.RenderTexture;
}
```

Scene field (add next to `manifest`):

```ts
  private wallsManifest!: WallsManifest;
```

In `create()`, right after reading `tiles-manifest`:

```ts
    this.wallsManifest = this.cache.json.get("walls-manifest") as WallsManifest;
```

Replace the whole `createChunk` body (the tilemap/GPULayer/container code goes away — imports of the removed pieces too):

```ts
  private createChunk(cx: number, cy: number) {
    const rt = this.add.renderTexture(
      cx * CHUNK_PX,
      cy * CHUNK_PX - RT_PAD_PX,
      CHUNK_PX,
      CHUNK_RT_HEIGHT_PX,
    );
    rt.setOrigin(0, 0);
    // Southern rows must paint over walls hanging from northern chunks.
    rt.setDepth(cy);

    for (let y = 0; y < CHUNK_SIZE; y++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const tx = cx * CHUNK_SIZE + x;
        const ty = cy * CHUNK_SIZE + y;
        const tile = getWorldTile(tx, ty);
        const level = levelFor(tile);
        const south = getWorldTile(tx, ty + 1);
        const strips = wallStripsFor(level, levelFor(south));

        const localX = x * TILE_SIZE;
        const topY = RT_PAD_PX + projectY(y * TILE_SIZE, level);

        const wallFrame = this.wallsManifest.terrain[tile.terrain];
        if (strips > 0 && wallFrame !== undefined) {
          for (let s = 0; s < strips; s++) {
            rt.drawFrame("walls", wallFrame, localX, topY + TILE_SIZE + s * HALF_STEP_PX);
          }
        }
        rt.drawFrame("tiles", this.frameFor(tile.terrain, tx, ty), localX, topY);
      }
    }
    this.chunks.set(chunkKey(cx, cy), { rt });
  }
```

Destroy path in `updateChunks` becomes:

```ts
    for (const key of plan.destroy) {
      this.chunks.get(key)!.rt.destroy();
      this.chunks.delete(key);
    }
```

Implementer notes:
- Delete the now-unused imports/types: the `GPULayer` lookup block, `Phaser.Tilemaps` casts, container creation, `map`/`tileset` locals, and the `LoadedChunk.map/container` fields. `tileToChunk`, `planChunkUpdates`, `chunkKey`, `pickVariant` all stay.
- If `rt.drawFrame(key, frame, x, y)` does not exist in the installed Phaser 4 types, use `rt.draw(this.textures.getFrame("walls", wallFrame), x, y)`-style equivalent from the v4 API — check `node_modules/phaser/types/phaser.d.ts` for the `RenderTexture#drawFrame` signature first and keep whichever compiles WITHOUT `any` casts. Do not use masks. Do not use `beginDraw/batchDraw` (removed in v4).
- Player still uses its old un-projected `y` in this task — that is expected and fixed in Task 4.

- [ ] **Step 2: Gate**

Run: `cd app && bunx tsc --noEmit && bun test && bun run build`
Expected: all pass (55+ tests from earlier tasks included).

- [ ] **Step 3: Commit**

```bash
git add app/src/components/PhaserGame.tsx
git commit -m "Bake chunks as oblique block RenderTextures"
```

---

### Task 4: Player projection, level lerp and silhouette

**Files:**
- Modify: `app/src/components/PhaserGame.tsx` (player/update path)

**Interfaces:**
- Consumes: `levelFor`, `projectY`, `isOccluded` from `@/lib/world/projection`; `HALF_STEP_PX` from config; scene fields from Task 3.
- Produces: player world position lives in scene fields `worldX`/`worldY`; the rectangle displays at the projected position; silhouette style toggles via `isOccluded`. `onPositionChange` keeps emitting **world** coordinates (HUD contract unchanged).

No unit test (occlusion math already covered in Task 1) — gate is tsc/test/build.

- [ ] **Step 1: Rework the player in `PhaserGame.tsx`**

Fields (add; the `player` rectangle stays):

```ts
  private worldX = 0;
  private worldY = 0;
  private renderLevel = 0;
```

In `create()`, replace the spawn placement so world coords live in the fields:

```ts
    const spawn = findSpawn(WORLD_SEED);
    this.worldX = spawn.tx * TILE_SIZE + TILE_SIZE / 2;
    this.worldY = spawn.ty * TILE_SIZE + TILE_SIZE / 2;
    this.renderLevel = levelFor(getWorldTile(spawn.tx, spawn.ty));

    this.player = this.add.rectangle(
      this.worldX,
      projectY(this.worldY, this.renderLevel),
      24,
      24,
      0xf5c542,
    );
    this.player.setStrokeStyle(2, 0x000000);
    this.player.setDepth(1_000_000); // always above terrain; occlusion is a style
```

In `update()`, replace every `this.player.x/y` read/write in the movement block with `this.worldX/this.worldY` (the tile lookup, the `ahead` check, the speed application and the `onMove` emit all use world coords). Then, after the movement block and before `updateChunks`, add:

```ts
    const targetLevel = levelFor(here);
    // ~100ms visual lerp between levels so climbing a step doesn't teleport.
    this.renderLevel += (targetLevel - this.renderLevel) * Math.min(1, delta / 100);
    if (Math.abs(targetLevel - this.renderLevel) < 0.01) this.renderLevel = targetLevel;
    this.player.setPosition(this.worldX, projectY(this.worldY, this.renderLevel));

    // Silhouette when terrain south of the player would cover it.
    const colA = Math.floor((this.worldX - 12) / TILE_SIZE);
    const colB = Math.floor((this.worldX + 12) / TILE_SIZE);
    const southLevels: number[][] = [];
    for (let d = 1; d <= 3; d++) {
      const row: number[] = [];
      for (let c = colA; c <= colB; c++) row.push(levelFor(getWorldTile(c, ty + d)));
      southLevels.push(row);
    }
    const hidden = isOccluded(targetLevel, southLevels);
    this.player.setFillStyle(0xf5c542, hidden ? 0.35 : 1);
    this.player.setStrokeStyle(2, 0x000000, hidden ? 0.2 : 1);
```

Also update the dirty-tracking block at the end of `update()` — the render level lerp is a new dirt source:

```ts
    const levelSettling = this.renderLevel !== targetLevel;
    if (dx !== 0 || dy !== 0 || chunksChanged || levelSettling) {
      this.cleanFrames = 0;
    } else if (++this.cleanFrames >= 30) {
      this.cleanFrames = 0;
      this.game.loop.sleep();
    }
```

Camera: `startFollow(this.player, ...)` stays as-is — it now follows the projected position automatically.

- [ ] **Step 2: Gate**

Run: `cd app && bunx tsc --noEmit && bun test && bun run build`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/PhaserGame.tsx
git commit -m "Project player by block level with occlusion silhouette"
```

---

### Task 5: Visual verification of the relief

**Files:**
- Create: `app/scripts/render-relief.ts`

- [ ] **Step 1: Write the relief renderer (real engine, AGENTS §7.5)**

```ts
// app/scripts/render-relief.ts
// Renders an oblique-projected patch of the real world (tops shaded by
// level + dark south walls) so the relief can be eyeballed before commit.
// Usage: bun scripts/render-relief.ts [sizeTiles=64] [originX=0] [originY=0]

import sharp from "sharp";
import { getWorldTile, type Terrain } from "../src/lib/world/world-gen";
import { levelFor, wallStripsFor } from "../src/lib/world/projection";

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

const size = Number(process.argv[2] ?? 64);
const ox = Number(process.argv[3] ?? 0);
const oy = Number(process.argv[4] ?? 0);
const CELL = 8; // px per tile
const STEP = CELL / 2; // px per level (half-block feel)
const PAD = 13 * STEP;
const W = size * CELL;
const H = size * CELL + 2 * PAD;
const buf = Buffer.alloc(W * H * 3);

function px(x: number, y: number, r: number, g: number, b: number) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
}

// North to south so southern tiles paint over hanging walls.
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const t = getWorldTile(ox + x, oy + y);
    const level = levelFor(t);
    const south = levelFor(getWorldTile(ox + x, oy + y + 1));
    const strips = wallStripsFor(level, south);
    const [r, g, b] = COLORS[t.terrain];
    const shade = 0.78 + 0.22 * (level / 13);
    const topY = PAD + y * CELL - level * STEP;
    // wall first
    for (let wy = 0; wy < strips * STEP; wy++) {
      for (let wx = 0; wx < CELL; wx++) {
        px(x * CELL + wx, topY + CELL + wy, 74, 53, 39);
      }
    }
    // top
    for (let ty2 = 0; ty2 < CELL; ty2++) {
      for (let tx2 = 0; tx2 < CELL; tx2++) {
        px(x * CELL + tx2, topY + ty2, Math.round(r * shade), Math.round(g * shade), Math.round(b * shade));
      }
    }
  }
}

await sharp(buf, { raw: { width: W, height: H, channels: 3 } })
  .png()
  .toFile("world-relief.png");
console.log(`world-relief.png: ${W}x${H}, ${size}x${size} tiles from (${ox},${oy})`);
```

- [ ] **Step 2: Render and LOOK**

Run (three views): `cd app && bun scripts/render-relief.ts 96 0 0`, then a mountain area and a coast (pick coordinates from world-map.png; e.g. `bun scripts/render-relief.ts 96 400 -300`).
Open each `world-relief.png` and check:
- Hills read as smooth staircases (many small ledges), not giant cliffs everywhere.
- Walls appear ONLY on south-facing drops; coastlines show a single ledge strip into flat water.
- No holes, no misaligned rows (a row shifted by one level = projection bug).
If the relief is too flat or too spiky, adjust ONLY the `levelFor` mapping curve in `projection.ts` (e.g. gamma on `clamped`) — never the generator. Re-run Task 1 tests after any change.

Add `world-relief.png` to `app/.gitignore` (next to `world-map.png`).

- [ ] **Step 3: Live check in the browser (guest access is still on)**

Run: `cd app && bun run dev`, open http://localhost:3000/game (no login needed).
Checklist: relief visible while walking (WASD); climbing shows the player lifting with a smooth ~100ms settle; walking north behind a tall ridge fades the player to the translucent silhouette; water sits visibly lower than the beach ledge; no seams between chunks standing or moving; standing still ~1s still sleeps the loop (GPU drops); measure a chunk bake hitch by eye (no visible stutter while walking in a straight line). Report explicitly what was and wasn't verifiable, then stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/scripts/render-relief.ts app/.gitignore
git commit -m "Add oblique relief visual verification script"
```

---

### Task 6: Final gate and PR

- [ ] **Step 1: Full quality gate**

Run: `cd app && bunx tsc --noEmit && bun test && bun run build`
Expected: all green. Paste real output in the report.

- [ ] **Step 2: Update the local project guide**

`AGENT.md` is intentionally gitignored (owner keeps it local-only) — update it in place, no commit: in §3 add `render-relief.ts` next to the other scripts and note in §9 item 12 that the renderer is now oblique 2.5D (blocks, walls, silhouette).

- [ ] **Step 3: Finish the branch**

Use superpowers:finishing-a-development-branch: push `feat/oblique-renderer`, open the PR with `gh pr create` (base `main`), PR body in English summarizing: straight-grid oblique renderer, 14 half-block levels, wall strips, RT bake per chunk (1 draw call/chunk kept), player silhouette, TilemapGPULayer retired (Phaser patch kept), plus the visual verification results and screenshots if available. End the body with the standard generated-with footer. No co-author trailer in commits.
