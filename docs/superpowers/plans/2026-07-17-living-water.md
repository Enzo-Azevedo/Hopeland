# Living Water and Ambient Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Animate the water, add shallow→deep visual depth, level-based world shading, cliff-base ambient occlusion, and a water current that pushes anyone standing in it.

**Architecture:** Water is a flat level-0 plane, so it leaves the chunk bake entirely: a camera-fixed `TileSprite` under all chunks animates 4 frames every 400ms (waking the sleeping loop and letting it re-sleep immediately). The bake stamps a translucent dark veil over deep ocean, brightness-tints tops by level, and shades the base of tall walls. A pure `currentFor(seed, tx, ty)` vector field (downhill elevation gradient; noise drift where flat) pushes the player, capped strictly below swim speed (anti-trap).

**Tech Stack:** TypeScript, Phaser 4.2 (`TileSprite`, `RenderTexture.stamp` tint/alpha), bun, sharp.

**Spec:** `docs/superpowers/specs/2026-07-17-living-water-depth-design.md`

## Global Constraints

- Branch `feat/living-water`. Never commit to `main`. No `Co-Authored-By` trailer. English imperative commits.
- Commands inside `app/` with bun; tests co-located; single-argument `expect` only.
- Exact values (spec): water tick **400ms**; deep-water veil tint `0x0a1a3a` alpha `0.45`; `brightnessFor` range vales ≈0.82 → picos 1.0 (`0.82 + 0.18 * level / MAX_LEVEL`); occlusion alpha `min(0.35, 0.08 + strips * 0.03)`; current strengths (px/ms) river `0.05`, water `0.03`, deep_water `0.02`, land `0`; anti-trap bound: max current < `0.2 * TERRAIN_SPEED.deep_water` (= 0.07).
- `stamp()` queues commands — every bake change stays before the existing `rt.render()` call.
- Frozen: `TERRAIN_SPEED` values, fatigue, spawn, chunk planner, `getTile`/`getElevation` signatures.
- Water animation must not break render-on-demand: loop may wake ~2.5x/s and must be able to re-sleep on the next clean frame (no 30-frame wait after a water tick).

---

### Task 1: `brightnessFor` (projection.ts)

**Files:**
- Modify: `app/src/lib/world/projection.ts` (append)
- Test: `app/src/lib/world/projection.test.ts` (append)

**Interfaces:**
- Produces: `brightnessFor(level: number): number` — `0.82 + 0.18 * (level / MAX_LEVEL)`, clamped input to [0, MAX_LEVEL].

- [ ] **Step 1: Append failing tests**

```ts
// append to app/src/lib/world/projection.test.ts
import { brightnessFor } from "./projection";

describe("brightnessFor", () => {
  test("stays in [0.8, 1.0] with peak exactly 1.0", () => {
    for (let l = 0; l <= MAX_LEVEL; l++) {
      const b = brightnessFor(l);
      expect(b).toBeGreaterThanOrEqual(0.8);
      expect(b).toBeLessThanOrEqual(1.0);
    }
    expect(brightnessFor(MAX_LEVEL)).toBe(1.0);
  });

  test("is monotonic in level and clamps out-of-range input", () => {
    for (let l = 1; l <= MAX_LEVEL; l++) {
      expect(brightnessFor(l)).toBeGreaterThan(brightnessFor(l - 1));
    }
    expect(brightnessFor(-5)).toBe(brightnessFor(0));
    expect(brightnessFor(99)).toBe(1.0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app && bun test src/lib/world/projection.test.ts`
Expected: FAIL — `brightnessFor` not exported.

- [ ] **Step 3: Append implementation**

```ts
// append to app/src/lib/world/projection.ts

/** Bake-time top shading: valleys darker, peaks full brightness. */
export function brightnessFor(level: number): number {
  const l = Math.min(MAX_LEVEL, Math.max(0, level));
  return 0.82 + 0.18 * (l / MAX_LEVEL);
}
```

- [ ] **Step 4: Run tests** — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/world/projection.ts app/src/lib/world/projection.test.ts
git commit -m "Add level-based brightness for bake shading"
```

---

### Task 2: Water current field (`current.ts`)

**Files:**
- Create: `app/src/lib/world/current.ts`
- Test: `app/src/lib/world/current.test.ts`

**Interfaces:**
- Consumes: `getElevation`, `getTile` from `./world-gen`; `Simplex2`, `hashString` from `./noise`; `TERRAIN_SPEED` from `./movement` (test only).
- Produces:
  - `interface CurrentVector { vx: number; vy: number }` (px/ms)
  - `currentFor(seed: string, tx: number, ty: number): CurrentVector` — zero on land; on water, downhill unit direction × per-terrain strength; noise drift where the gradient is ~flat.
  - `MAX_CURRENT = 0.05` (largest strength).

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/world/current.test.ts
import { describe, expect, test } from "bun:test";
import { currentFor, MAX_CURRENT } from "./current";
import { getWorldTile } from "./world-gen";
import { TERRAIN_SPEED } from "./movement";
import { WORLD_SEED } from "./world-config";

const WATER = new Set(["deep_water", "water", "river"]);

describe("currentFor", () => {
  test("is deterministic", () => {
    expect(currentFor(WORLD_SEED, 37, -122)).toEqual(currentFor(WORLD_SEED, 37, -122));
  });

  test("land tiles have zero current", () => {
    let landChecked = 0;
    for (let y = -300; y <= 300 && landChecked < 50; y += 7) {
      for (let x = -300; x <= 300 && landChecked < 50; x += 7) {
        if (!WATER.has(getWorldTile(x, y).terrain)) {
          expect(currentFor(WORLD_SEED, x, y)).toEqual({ vx: 0, vy: 0 });
          landChecked++;
        }
      }
    }
    expect(landChecked).toBe(50);
  });

  test("anti-trap: every water current is strictly weaker than swimming", () => {
    const minSwim = 0.2 * TERRAIN_SPEED.deep_water; // 0.07 px/ms
    expect(MAX_CURRENT).toBeLessThan(minSwim);
    let waterChecked = 0;
    for (let y = -400; y <= 400 && waterChecked < 300; y += 5) {
      for (let x = -400; x <= 400 && waterChecked < 300; x += 5) {
        if (WATER.has(getWorldTile(x, y).terrain)) {
          const c = currentFor(WORLD_SEED, x, y);
          expect(Math.hypot(c.vx, c.vy)).toBeLessThanOrEqual(MAX_CURRENT + 1e-9);
          waterChecked++;
        }
      }
    }
    expect(waterChecked).toBe(300);
  });

  test("water currents are non-zero and normalized to their strength", () => {
    let checked = 0;
    for (let y = -400; y <= 400 && checked < 100; y += 5) {
      for (let x = -400; x <= 400 && checked < 100; x += 5) {
        if (WATER.has(getWorldTile(x, y).terrain)) {
          const c = currentFor(WORLD_SEED, x, y);
          expect(Math.hypot(c.vx, c.vy)).toBeGreaterThan(0);
          checked++;
        }
      }
    }
    expect(checked).toBe(100);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app && bun test src/lib/world/current.test.ts`
Expected: FAIL — cannot resolve `./current`.

- [ ] **Step 3: Implement `current.ts`**

```ts
// app/src/lib/world/current.ts
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
```

- [ ] **Step 4: Run tests** — Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
cd app && bunx tsc --noEmit
git add src/lib/world/current.ts src/lib/world/current.test.ts
git commit -m "Add deterministic water current field"
```

---

### Task 3: `white` frame in the atlas

**Files:**
- Modify: `app/scripts/build-tiles.mjs`
- Modify (generated, committed): `app/public/tiles/atlas.png`, `app/public/tiles/atlas.json`
- Test: `app/src/lib/world/atlas.test.ts` (append)

**Interfaces:**
- Produces: `atlas.json` gains top-level `"white": <frameIndex>` — a solid white 32×32 frame appended at the END of the frame list (existing indices unchanged). Used by the scene for the deep veil and wall occlusion stamps.

- [ ] **Step 1: Append failing test**

```ts
// append to app/src/lib/world/atlas.test.ts (inside or after the existing describes)
describe("white utility frame", () => {
  test("exists at a valid index named white", () => {
    const w = (manifest as unknown as { white: number }).white;
    expect(w).toBeDefined();
    expect(w).toBeGreaterThanOrEqual(0);
    expect(w).toBeLessThan(manifest.frames.length);
    expect(manifest.frames[w]).toBe("white");
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL (`white` undefined).

- [ ] **Step 3: Modify `build-tiles.mjs`**

In the atlas section, AFTER the water-frames loop and BEFORE `const buffers = []`, append the white frame def:

```js
// Solid white utility frame (tinted at stamp time: deep-water veil,
// wall-base occlusion). Appended last so existing indices never shift.
FRAME_DEFS.push({
  name: "white",
  file: null,
  make: async () =>
    sharp({ create: { width: TILE, height: TILE, channels: 4, background: "#ffffff" } })
      .png()
      .toBuffer(),
});
const WHITE_INDEX = FRAME_DEFS.length - 1;
```

And add `white: WHITE_INDEX,` to the JSON.stringify object in the atlas.json write (next to `terrain`/`waterFrames`).

- [ ] **Step 4: Rebuild and verify**

Run: `cd app && bun run build:tiles && bun test src/lib/world/atlas.test.ts`
Expected: `atlas: 35 frames, 8x5`, walls line unchanged, tests PASS. Confirm in `atlas.json` that all pre-existing indices are unchanged (frames 0-33 same names as before, `white` = 34).

- [ ] **Step 5: Commit**

```bash
git add app/scripts/build-tiles.mjs app/public/tiles/atlas.png app/public/tiles/atlas.json app/src/lib/world/atlas.test.ts
git commit -m "Add white utility frame to the tile atlas"
```

---

### Task 4: Scene — water layer, tick/wake, bake depth, current push

**Files:**
- Modify: `app/src/components/PhaserGame.tsx`

**Interfaces:**
- Consumes: `brightnessFor` (Task 1), `currentFor` (Task 2), `manifest.white` (Task 3), existing `levelFor`/`projectY`/`wallStripsFor`, `manifest.waterFrames`.
- Produces: the finished feature. New scene fields: `waterLayer`, `waterFrameIdx`, `waterInterval`, `sleepAfterSettle`.

No unit test (Phaser scene) — gate: `bunx tsc --noEmit && bun test && bun run build`.

- [ ] **Step 1: Add imports and fields**

Imports: add `brightnessFor` to the projection import; add `import { currentFor } from "@/lib/world/current";`. Extend `AtlasManifest` with `white: number;`.

Fields (next to the existing ones):

```ts
  private waterLayer!: Phaser.GameObjects.TileSprite;
  private waterFrameIdx = 0;
  private waterInterval = 0;
  private sleepAfterSettle = false;
```

- [ ] **Step 2: Water layer + tick in `create()`**

After reading the manifests, before the spawn block:

```ts
    // Água é sempre plana no nível 0: uma única camada animada sob todos os
    // chunks; tiles de água ficam transparentes no bake e a revelam.
    const waterFrames = this.manifest.waterFrames["water"]!;
    this.waterLayer = this.add
      .tileSprite(0, 0, this.scale.width, this.scale.height, "tiles", waterFrames[0])
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(-1_000_000_000);
    this.scale.on(Phaser.Scale.Events.RESIZE, (size: Phaser.Structs.Size) => {
      this.waterLayer.setSize(size.width, size.height);
    });

    // Timer JS puro: os timers do Phaser não correm com o loop dormindo.
    this.waterInterval = window.setInterval(() => {
      this.waterFrameIdx = (this.waterFrameIdx + 1) % waterFrames.length;
      this.waterLayer.setFrame(waterFrames[this.waterFrameIdx]!);
      if (!this.game.loop.running) {
        // Acorda para mostrar o novo frame e permite voltar a dormir já no
        // próximo frame limpo (sem esperar os 30 frames do contador).
        this.sleepAfterSettle = true;
        this.game.loop.wake();
      }
    }, 400);
    this.events.once(Phaser.Scenes.Events.DESTROY, () => {
      window.clearInterval(this.waterInterval);
    });
```

- [ ] **Step 3: Bake changes in `createChunk()`**

Replace the per-tile stamping body (keep the loops and the final `rt.render()`):

```ts
        const tile = getWorldTile(tx, ty);
        const level = levelFor(tile);
        const localX = x * TILE_SIZE;

        if (level === 0) {
          // Água: transparente (camada animada por baixo). Oceano profundo
          // ganha um véu escuro — raso claro -> fundo escuro, sem shader.
          if (tile.terrain === "deep_water") {
            rt.stamp("tiles", this.manifest.white, localX, RT_PAD_PX + y * TILE_SIZE, {
              originX: 0,
              originY: 0,
              tint: 0x0a1a3a,
              alpha: 0.45,
            });
          }
          continue;
        }

        const south = getWorldTile(tx, ty + 1);
        const strips = wallStripsFor(level, levelFor(south));
        const topY = RT_PAD_PX + projectY(y * TILE_SIZE, level);

        const wallFrame = this.wallsManifest.terrain[tile.terrain];
        if (strips > 0 && wallFrame !== undefined) {
          for (let s = 0; s < strips; s++) {
            rt.stamp("walls", wallFrame, localX, topY + TILE_SIZE + s * HALF_STEP_PX, {
              originX: 0,
              originY: 0,
            });
          }
          // Oclusão ambiente na base do paredão: quanto mais alto, mais escuro.
          rt.stamp("tiles", this.manifest.white, localX, topY + TILE_SIZE + (strips - 1) * HALF_STEP_PX, {
            originX: 0,
            originY: 0,
            scaleY: 0.5,
            tint: 0x000000,
            alpha: Math.min(0.35, 0.08 + strips * 0.03),
          });
        }

        const b = Math.round(255 * brightnessFor(level));
        rt.stamp("tiles", this.frameFor(tile.terrain, tx, ty), localX, topY, {
          originX: 0,
          originY: 0,
          tint: (b << 16) | (b << 8) | b,
        });
```

Note: the `for (let x...)` loop body must use `continue` as shown — if the current structure doesn't allow it directly, restructure minimally. Everything still happens before `rt.render()`.

- [ ] **Step 4: Current push + water-awake + fast re-sleep in `update()`**

After the movement block (after `this.fatigue.update(...)` / position integration) and before the level-lerp block, add:

```ts
    // Correnteza: a água empurra quem está nela (jogador hoje; NPCs futuros
    // usam a mesma currentFor). Sempre mais fraca que nadar — anti-trava.
    const cur = currentFor(WORLD_SEED, tx, ty);
    const inWater = cur.vx !== 0 || cur.vy !== 0;
    if (inWater) {
      this.worldX += cur.vx * delta;
      this.worldY += cur.vy * delta;
      const now = performance.now();
      if (this.onMove && now - this.lastEmit > 50) {
        this.lastEmit = now;
        this.onMove(this.worldX, this.worldY);
      }
    }
```

Replace the dirty-tracking block at the end of `update()` with:

```ts
    const levelSettling = this.renderLevel !== targetLevel;
    if (dx !== 0 || dy !== 0 || chunksChanged || levelSettling || inWater) {
      this.cleanFrames = 0;
      this.sleepAfterSettle = false;
    } else if (this.sleepAfterSettle) {
      // Frame limpo logo após um tick de água: mostrou o frame novo, dorme já.
      this.sleepAfterSettle = false;
      this.cleanFrames = 0;
      this.game.loop.sleep();
    } else if (++this.cleanFrames >= 30) {
      this.cleanFrames = 0;
      this.game.loop.sleep();
    }
```

Also add the water-plane scroll sync at the top of `update()` (first line):

```ts
    this.waterLayer.setTilePosition(this.cameras.main.scrollX, this.cameras.main.scrollY);
```

- [ ] **Step 5: Gate**

Run: `cd app && bunx tsc --noEmit && bun test && bun run build`
Expected: all green. If `setFrame` on TileSprite rejects a numeric frame in the types, pass it as `waterFrames[this.waterFrameIdx]!` via `setFrame(String(...))`-free numeric overload — check the TileSprite typings and keep whichever compiles without casts.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/PhaserGame.tsx
git commit -m "Animate water layer with depth veil, bake shading and current push"
```

---

### Task 5: Visual verification, gate and PR

**Files:**
- Modify: `app/scripts/render-relief.ts` (apply brightnessFor so the debug view matches the game)

- [ ] **Step 1: Sync the relief renderer**

In `render-relief.ts`, add `brightnessFor` to the projection import and replace the `shade` line:

```ts
    const shade = t.terrain.includes("water") ? 1 : brightnessFor(level);
```

(Delete the old `0.78 + 0.22 * (level / 13)` formula.)

- [ ] **Step 2: Render and LOOK**

Run: `cd app && bun scripts/render-relief.ts 96 380 20` (mountains) and `96 0 0` (coast).
Check: valleys visibly darker than ridges; the map reads as relief at a glance; no banding artifacts.

- [ ] **Step 3: Full gate**

Run: `cd app && bunx tsc --noEmit && bun test && bun run build`
Expected: all green (paste output).

- [ ] **Step 4: Browser checklist (owner or dev-smoke)**

`bun run dev` → http://localhost:3000/game (guest access on): water animates while standing still; ocean visibly darker than the coast; standing in a river drifts the player downstream but swimming upstream wins; GPU idles near zero on land, small periodic blips from the 400ms water tick; no flicker when the loop wakes. Report what was and wasn't verifiable headless.

- [ ] **Step 5: Commit, push, PR**

```bash
git add app/scripts/render-relief.ts
git commit -m "Use brightnessFor in relief verification script"
git push -u origin feat/living-water
```

Then `gh pr create` (base `main`, English body: separate animated water layer, deep veil, level shading, cliff occlusion, current push with anti-trap bound, idle cost ~2.5 wakes/s; verification results; generated-with footer). No co-author trailer.
