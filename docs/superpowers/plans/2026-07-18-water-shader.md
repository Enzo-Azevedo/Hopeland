# Water Flow-Map Shader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all current water rendering with one full-screen flow-map shader: per-pixel flow aligned with the real `currentFor` field, pixelated waves, smooth depth gradient and shore foam.

**Architecture:** A pure `flow-field.ts` module encodes per-tile water kind + flow vector (permanent cache — the world is static) into a toroidal 160×160 CanvasTexture (5×5 chunk ring, slot = chunk mod 5, shader addresses worldTile mod 160). A Phaser 4 `Shader` GameObject draws one camera-fixed quad under the chunks; its GLSL reconstructs world position from `uScroll`, snaps to a 4px grid, samples the field (NEAREST for kind, manual bilinear for depth/foam) and animates a two-phase flow-map over procedural value noise, posterized to 4 tones. `uTime` accumulates only rendered frames, so the sleep economy survives.

**Tech Stack:** Phaser 4.2 Shader GameObject (`fragmentSource` + `setupUniforms` + `textures` — see `node_modules/phaser/docs/Phaser 4 Shader Guide/` if present, else `src/gameobjects/shader/Shader.js` and `ShaderFactory.js`), CanvasTexture, GLSL ES 1.0, bun.

**Spec:** `docs/superpowers/specs/2026-07-18-water-shader-design.md`

## Global Constraints

- Branch `feat/water-shader`. Never commit to `main`. No `Co-Authored-By`. English imperative commits.
- Commands in `app/` with bun; tests co-located; single-argument `expect` only.
- Exact values: field = **160×160** texels (`FIELD_TILES = 160`, 5×5 chunks × 32); kinds land=0, deep=1, coast=2, river=3 encoded in B as kind×85; flow encode `round(v / MAX_CURRENT * 127) + 128` per component; alpha A = 0 for land, 255 for water; flow refinement budget **256 tiles/frame**; pixel snap **4px**; **4 tones** posterization; two flow phases offset **0.5**.
- The visual field MUST come from `currentFor` (gameplay alignment). Kind pass is synchronous in the chunk bake; flow pass is budgeted.
- `uTime` = accumulated rendered delta (freezes during sleep). The 400ms interval stays as a pure wake pulse.
- Frozen: terrain bake (tops/walls/occlusion/brightness), gameplay current, movement, anti-trap, chunk planner.
- Removals are part of the job: global TileSprite + drift/tide code, river sprites + `river-flow` anim, deep veil stamp, `water-N.png` loading AND generation AND committed files.

---

### Task 1: `flow-field.ts` (pure encode/cache module)

**Files:**
- Create: `app/src/lib/world/flow-field.ts`
- Test: `app/src/lib/world/flow-field.test.ts`

**Interfaces:**
- Consumes: `currentFor`, `MAX_CURRENT` from `./current`; `getTile` from `./world-gen`.
- Produces:
  - `FIELD_TILES = 160`
  - `type FlowKind = 0 | 1 | 2 | 3` (land, deep, coast, river)
  - `interface FlowSample { vx: number; vy: number; kind: FlowKind }`
  - `kindOf(terrain: string): FlowKind`
  - `flowAt(seed: string, tx: number, ty: number): FlowSample` — permanent per-seed cache
  - `encodeFlow(s: FlowSample): [number, number, number, number]` — [R, G, B, A] bytes
  - `decodeFlow(r: number, g: number, b: number): FlowSample`
  - `fieldTexel(t: number): number` — euclidean `mod FIELD_TILES` (negatives safe)

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/world/flow-field.test.ts
import { describe, expect, test } from "bun:test";
import {
  decodeFlow, encodeFlow, FIELD_TILES, fieldTexel, flowAt, kindOf,
} from "./flow-field";
import { MAX_CURRENT } from "./current";
import { getWorldTile } from "./world-gen";
import { WORLD_SEED } from "./world-config";

describe("flow-field", () => {
  test("kindOf maps terrains to kinds", () => {
    expect(kindOf("grass")).toBe(0);
    expect(kindOf("rock")).toBe(0);
    expect(kindOf("deep_water")).toBe(1);
    expect(kindOf("water")).toBe(2);
    expect(kindOf("river")).toBe(3);
  });

  test("encode/decode roundtrip within one quantization step", () => {
    const step = MAX_CURRENT / 127;
    for (const s of [
      { vx: 0, vy: 0, kind: 1 as const },
      { vx: MAX_CURRENT, vy: -MAX_CURRENT, kind: 3 as const },
      { vx: 0.013, vy: -0.027, kind: 2 as const },
    ]) {
      const [r, g, b, a] = encodeFlow(s);
      expect(a).toBe(255);
      const d = decodeFlow(r, g, b);
      expect(Math.abs(d.vx - s.vx)).toBeLessThanOrEqual(step);
      expect(Math.abs(d.vy - s.vy)).toBeLessThanOrEqual(step);
      expect(d.kind).toBe(s.kind);
    }
    expect(encodeFlow({ vx: 0, vy: 0, kind: 0 })[3]).toBe(0); // land alpha
  });

  test("fieldTexel wraps negatives euclidean", () => {
    expect(fieldTexel(0)).toBe(0);
    expect(fieldTexel(159)).toBe(159);
    expect(fieldTexel(160)).toBe(0);
    expect(fieldTexel(-1)).toBe(FIELD_TILES - 1);
    expect(fieldTexel(-160)).toBe(0);
    expect(fieldTexel(-161)).toBe(FIELD_TILES - 1);
  });

  test("flowAt matches terrain kind, is cached-deterministic, land is zero", () => {
    let water = 0;
    let land = 0;
    for (let y = -200; y <= 200 && (water < 40 || land < 40); y += 7) {
      for (let x = -200; x <= 200 && (water < 40 || land < 40); x += 7) {
        const t = getWorldTile(x, y).terrain;
        const s = flowAt(WORLD_SEED, x, y);
        expect(flowAt(WORLD_SEED, x, y)).toEqual(s);
        expect(s.kind).toBe(kindOf(t));
        if (s.kind === 0) {
          expect(s.vx).toBe(0);
          expect(s.vy).toBe(0);
          land++;
        } else {
          water++;
        }
      }
    }
    expect(water).toBeGreaterThanOrEqual(40);
    expect(land).toBeGreaterThanOrEqual(40);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app && bun test src/lib/world/flow-field.test.ts`
Expected: FAIL — cannot resolve `./flow-field`.

- [ ] **Step 3: Implement**

```ts
// app/src/lib/world/flow-field.ts
// Per-tile water flow samples for the water shader, encoded for a toroidal
// data texture. Uses the REAL gameplay current (currentFor) so what the
// player sees is exactly what pushes them. The world is static, so samples
// cache permanently.

import { currentFor, MAX_CURRENT } from "./current";
import { getTile } from "./world-gen";

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

const cache = new Map<string, FlowSample>();

export function flowAt(seed: string, tx: number, ty: number): FlowSample {
  const key = `${seed}:${tx},${ty}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const kind = kindOf(getTile(seed, tx, ty).terrain);
  const sample: FlowSample =
    kind === 0
      ? { vx: 0, vy: 0, kind }
      : { ...currentFor(seed, tx, ty), kind };
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
```

- [ ] **Step 4: Run tests** — Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
cd app && bunx tsc --noEmit
git add src/lib/world/flow-field.ts src/lib/world/flow-field.test.ts
git commit -m "Add cached flow-field encoding for the water shader"
```

---

### Task 2: GLSL source module (`water-shader.ts`)

**Files:**
- Create: `app/src/lib/world/water-shader.ts`

No unit test (GLSL string) — gate is tsc + the scene integration in Task 3. Keep the source EXACTLY as below (it is the reviewed shader).

**Interfaces:**
- Produces: `WATER_FRAG: string` (GLSL ES 1.0 fragment shader) with uniforms `uTime` (ms, rendered time), `uScroll` (vec2 px), `uResolution` (vec2 px), `uFlowTex` (sampler2D, unit 0). Constants inside match Task 1's encoding and the 32px tile / 160-tile field.

- [ ] **Step 1: Write the module**

```ts
// app/src/lib/world/water-shader.ts
// Fragment shader da água: flow-map de duas fases sobre value noise
// procedural, pixelado (grade 4px, 4 tons), profundidade e espuma via
// amostragem bilinear manual do campo toroidal. GLSL ES 1.0.

export const WATER_FRAG = `
precision mediump float;

uniform float uTime;       // ms de tempo RENDERIZADO (congela dormindo)
uniform vec2  uScroll;     // scroll da câmera em px de mundo
uniform vec2  uResolution; // tamanho do quad/viewport em px
uniform sampler2D uFlowTex;

const float TILE = 32.0;
const float FIELD = 160.0;
const float SNAP = 4.0;
const float FLOW_REACH = 14.0;  // px de arrasto visual por ciclo
const float NOISE_FREQ = 0.55;  // oitava base por tile

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec4 fieldTexelAt(vec2 tile) {
  vec2 wrapped = mod(mod(tile, FIELD) + FIELD, FIELD);
  return texture2D(uFlowTex, (wrapped + 0.5) / FIELD);
}

void main(void) {
  // gl_FragCoord é bottom-left; o mundo é top-left.
  vec2 screenPx = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  vec2 worldPx = screenPx + uScroll;
  // Estética pixelada: tudo calculado no centro de células de 4px.
  vec2 snapped = floor(worldPx / SNAP) * SNAP + SNAP * 0.5;
  vec2 tile = floor(snapped / TILE);

  vec4 texel = fieldTexelAt(tile);
  vec2 flow = (texel.rg * 255.0 - 128.0) / 127.0; // [-1,1] por componente

  // Bilinear manual do campo para profundidade (B) e máscara de água (A).
  vec2 tpos = snapped / TILE - 0.5;
  vec2 base = floor(tpos);
  vec2 frac2 = tpos - base;
  vec4 t00 = fieldTexelAt(base);
  vec4 t10 = fieldTexelAt(base + vec2(1.0, 0.0));
  vec4 t01 = fieldTexelAt(base + vec2(0.0, 1.0));
  vec4 t11 = fieldTexelAt(base + vec2(1.0, 1.0));
  vec2 smoothBA = mix(
    mix(t00.ba, t10.ba, frac2.x),
    mix(t01.ba, t11.ba, frac2.x),
    frac2.y
  );
  float depthRamp = smoothBA.x; // 0 terra .. 1 rio (via kind*85/255)
  float waterness = smoothBA.y; // 0 terra .. 1 água (máscara bilinear)

  // Flow-map: duas fases dente-de-serra defasadas 0.5, cross-fade triangular.
  float ph0 = fract(uTime * 0.00045);
  float ph1 = fract(ph0 + 0.5);
  vec2 uv0 = (snapped - flow * ph0 * FLOW_REACH) / TILE * NOISE_FREQ;
  vec2 uv1 = (snapped - flow * ph1 * FLOW_REACH) / TILE * NOISE_FREQ;
  float n0 = vnoise(uv0) * 0.7 + vnoise(uv0 * 2.7) * 0.3;
  float n1 = vnoise(uv1) * 0.7 + vnoise(uv1 * 2.7) * 0.3;
  float w0 = 1.0 - abs(ph0 * 2.0 - 1.0);
  float w1 = 1.0 - w0;
  float wave = n0 * w0 + n1 * w1;

  // Cor por profundidade (deep escuro -> rio claro), posterizada em 4 tons.
  vec3 deep = vec3(0.075, 0.16, 0.36);
  vec3 shallow = vec3(0.19, 0.38, 0.72);
  vec3 riverc = vec3(0.30, 0.53, 0.89);
  vec3 baseColor = depthRamp < 0.55
    ? mix(deep, shallow, depthRamp / 0.55)
    : mix(shallow, riverc, (depthRamp - 0.55) / 0.45);
  float tone = floor(wave * 4.0) / 4.0;
  vec3 color = baseColor * (0.82 + tone * 0.30);

  // Espuma pixelada na fronteira água/terra, pulsando devagar.
  float pulse = 0.7 + 0.3 * sin(uTime * 0.002 + snapped.x * 0.08 + snapped.y * 0.05);
  if (waterness > 0.15 && waterness < 0.62) {
    float foam = step(0.35, wave * pulse);
    color = mix(color, vec3(0.88, 0.94, 0.98), foam * 0.85);
  }

  gl_FragColor = vec4(color, 1.0);
}
`;
```

- [ ] **Step 2: Typecheck and commit**

```bash
cd app && bunx tsc --noEmit
git add src/lib/world/water-shader.ts
git commit -m "Add water flow-map fragment shader source"
```

---

### Task 3: Scene integration — field texture, shader quad, removals

**Files:**
- Modify: `app/src/components/PhaserGame.tsx`
- Modify: `app/scripts/build-tiles.mjs` (delete the standalone water frame section)
- Delete: `app/public/tiles/water-0.png` … `water-3.png`

**Interfaces:**
- Consumes: `flowAt`, `encodeFlow`, `fieldTexel`, `FIELD_TILES`, `kindOf` (Task 1); `WATER_FRAG` (Task 2); existing scene internals.
- Produces: the finished water. New scene fields: `flowCanvas` (CanvasTexture), `flowQueue` (chunks pending flow refinement), `renderedTime`, `waterQuad`.

No unit test (Phaser scene) — gate: `bunx tsc --noEmit && bun test && bun run build`, plus grep-proofs of removals (below).

- [ ] **Step 1: Field texture + shader quad in `create()`; remove old water layer**

DELETE from the scene: the `waterLayer` TileSprite creation + its RESIZE handler + `setTexture` in the interval + the drift/tide `setTilePosition` block in `update()` + the `water-${i}` preloads + `waterFrameIdx` field. KEEP the 400ms interval itself, reduced to a pure wake pulse:

```ts
    this.waterInterval = window.setInterval(() => {
      if (!this.game.loop.running) {
        this.sleepAfterSettle = true;
        this.game.loop.wake();
      }
    }, 400);
```

ADD fields:

```ts
  private flowCanvas!: Phaser.Textures.CanvasTexture;
  private flowQueue: { cx: number; cy: number; row: number }[] = [];
  private renderedTime = 0;
  private waterQuad!: Phaser.GameObjects.Shader;
```

ADD in `create()` (before chunk creation; imports at top of file):

```ts
    // Campo de fluxo toroidal 160x160: cada chunk escreve seu bloco 32x32
    // no slot (cx mod 5, cy mod 5); o shader endereça worldTile mod 160.
    this.flowCanvas = this.textures.createCanvas("flow-field", FIELD_TILES, FIELD_TILES)!;
    this.flowCanvas.setFilter(Phaser.Textures.FilterMode.NEAREST);

    this.waterQuad = this.add.shader(
      {
        name: "water",
        fragmentSource: WATER_FRAG,
        setupUniforms: (setUniform: (name: string, value: unknown) => void) => {
          setUniform("uTime", this.renderedTime);
          setUniform("uScroll", [this.cameras.main.scrollX, this.cameras.main.scrollY]);
          setUniform("uResolution", [this.scale.width, this.scale.height]);
          setUniform("uFlowTex", 0);
        },
      } as Phaser.Types.GameObjects.Shader.ShaderConfig,
      0,
      0,
      this.scale.width,
      this.scale.height,
      ["flow-field"],
    );
    this.waterQuad.setOrigin(0, 0).setScrollFactor(0).setDepth(-1_000_000_000);
    this.scale.on(Phaser.Scale.Events.RESIZE, (size: Phaser.Structs.Size) => {
      this.waterQuad.setSize(size.width, size.height);
    });
```

Implementer note: verify the exact `add.shader` signature and config type against `node_modules/phaser/src/gameobjects/shader/ShaderFactory.js` and `Shader.js` (constructor: scene, config/key, x, y, width, height, textures[]). Adjust argument placement to what the installed 4.2.1 actually takes — WITHOUT `any`; if the config type name differs, use the typed shape the d.ts exposes. If `setSize` doesn't resize the quad geometry, use `setDisplaySize`.

- [ ] **Step 2: Kind pass in the bake + flow refinement queue**

In `createChunk`, accumulate the kind pass while the existing tile loop runs (the loop already calls `getWorldTile` per tile — reuse `tile`, don't refetch). Before the loop:

```ts
    const block = this.flowCanvas.context.createImageData(CHUNK_SIZE, CHUNK_SIZE);
```

Inside the loop (top of the per-tile body, right after `const tile = ...` / `const level = ...`):

```ts
        const k = kindOf(tile.terrain);
        const px4 = (y * CHUNK_SIZE + x) * 4;
        block.data[px4] = 128; // fluxo 0 provisório
        block.data[px4 + 1] = 128;
        block.data[px4 + 2] = k * 85;
        block.data[px4 + 3] = k === 0 ? 0 : 255;
```

After the loop (next to `rt.render()`):

```ts
    const slotX = fieldTexel(cx * CHUNK_SIZE);
    const slotY = fieldTexel(cy * CHUNK_SIZE);
    this.flowCanvas.context.putImageData(block, slotX, slotY);
    this.flowCanvas.refresh();
    // Refinamento do fluxo (caro nos rios) em fila orçada, linha a linha.
    this.flowQueue = this.flowQueue.filter((q) => q.cx !== cx || q.cy !== cy);
    this.flowQueue.push({ cx, cy, row: 0 });
```

In `update()`, after `const chunksChanged = this.updateChunks();` add:

```ts
    // Orçamento de 256 tiles/frame para refinar o fluxo do shader.
    let flowBudget = 256;
    let flowDirty = false;
    while (flowBudget > 0 && this.flowQueue.length > 0) {
      const job = this.flowQueue[0]!;
      if (!this.chunks.has(chunkKey(job.cx, job.cy))) {
        this.flowQueue.shift();
        continue;
      }
      const rowsNow = Math.min(
        Math.ceil(flowBudget / CHUNK_SIZE),
        CHUNK_SIZE - job.row,
      );
      const strip = this.flowCanvas.context.createImageData(CHUNK_SIZE, rowsNow);
      for (let ry = 0; ry < rowsNow; ry++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const s = flowAt(
            WORLD_SEED,
            job.cx * CHUNK_SIZE + x,
            job.cy * CHUNK_SIZE + job.row + ry,
          );
          const [r, g, b, a] = encodeFlow(s);
          const p = (ry * CHUNK_SIZE + x) * 4;
          strip.data[p] = r;
          strip.data[p + 1] = g;
          strip.data[p + 2] = b;
          strip.data[p + 3] = a;
        }
      }
      this.flowCanvas.context.putImageData(
        strip,
        fieldTexel(job.cx * CHUNK_SIZE),
        fieldTexel(job.cy * CHUNK_SIZE) + job.row,
      );
      flowDirty = true;
      job.row += rowsNow;
      flowBudget -= rowsNow * CHUNK_SIZE;
      if (job.row >= CHUNK_SIZE) this.flowQueue.shift();
    }
    if (flowDirty) this.flowCanvas.refresh();
```

And accumulate rendered time as the FIRST line of `update()`:

```ts
    this.renderedTime += delta;
```

Include `flowDirty` in the dirty-tracking OR-chain (a refreshed field must be shown before sleeping).

- [ ] **Step 3: Remove river sprites, veil, and pipeline leftovers**

- Delete the `rivers` container logic in `createChunk` (declaration, the `else if (tile.terrain === "river")` branch, the `rivers` member of `LoadedChunk`, the destroy call) and the `river-flow` anim creation in `create()`. The `level === 0 / deep_water` veil stamp block also goes — the `if (level === 0)` branch now only writes the kind pass and `continue`s.
- Delete the "Standalone water frame textures" section from `app/scripts/build-tiles.mjs`, run `bun run build:tiles`, then `git rm app/public/tiles/water-0.png app/public/tiles/water-1.png app/public/tiles/water-2.png app/public/tiles/water-3.png`.
- Grep-proofs (all must return nothing): `grep -rn "water-" app/src/components/PhaserGame.tsx`; `grep -n "river-flow\|rivers\|tilePosition\|TileSprite" app/src/components/PhaserGame.tsx`; `grep -n "Standalone water" app/scripts/build-tiles.mjs`.

- [ ] **Step 4: Gate**

Run: `cd app && bunx tsc --noEmit && bun test && bun run build`
Expected: all green (80+ tests incl. Task 1's).

- [ ] **Step 5: Commit**

```bash
git add -A app/src/components/PhaserGame.tsx app/src/lib/world app/scripts/build-tiles.mjs app/public/tiles
git commit -m "Render water with a flow-map shader quad"
```

---

### Task 4: Verification, gate and PR

- [ ] **Step 1: Dev smoke**

`cd app && bun run dev`; confirm `/game` returns 200 and the browser console (if reachable) shows no shader compile errors. GLSL cannot be exercised headless — state that explicitly; the owner's browser pass is the visual gate (checklist below goes in the PR).

- [ ] **Step 2: Full gate**

Run: `cd app && bunx tsc --noEmit && bun test && bun run build` — paste real output.

- [ ] **Step 3: Push and PR**

Push `feat/water-shader`; `gh pr create` (base `main`, English). PR body summarizes architecture + removals + owner checklist: river arms each flowing their own direction matching the push; smooth shallow→deep gradient; pixelated foam on shorelines; water frozen-in-steps while idle (economy intact); no seams. Standard generated-with footer.
