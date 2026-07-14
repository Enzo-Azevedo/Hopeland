# Portrait System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the geometric placeholder portrait with layered art from Portraits of the Rim (credit: TwoPenny), derived deterministically from creation choices + a random seed, with a mood-driven expression layer.

**Architecture:** Curated PNG subset lives in `assets/portraits/source/`; a bun+sharp script converts it to 320×320 WebP in `app/public/portraits/` and generates `manifest.json`. A pure selection module (`mulberry32` PRNG over `appearance.seed`) picks one variant per layer; `CharacterPortrait` composites the layers on canvas with multiply tinting (mod art is white by design), falling back to the existing geometric drawing.

**Tech Stack:** TanStack Start (React 19), bun (runtime, package manager, test runner via `bun test`), sharp (build-time only), Canvas 2D.

**Spec:** `docs/superpowers/specs/2026-07-14-portrait-system-design.md`

## Global Constraints

- Branch: `feat/portrait-system`. Commits: short English subject, NO `Co-Authored-By` trailer (repo rule).
- User-facing copy in PT-BR; code identifiers in English.
- Portrait output: 320×320 WebP quality 80, each file ≤ 60 KB.
- Layer z-order (bottom→top): `neck, clothes, head, face, beard, hair`.
- PRNG draw order (always consume ALL draws regardless of gender): gender, headShape, hairVariant, hairColor, beardChance, beardVariant, faceLow, faceMid, faceHigh.
- Extracted mod path (read-only source):
  `C:\Users\ADMINI~1\AppData\Local\Temp\claude\c--Users-Administrator-Documents-Obsidian-Projetos-Hopeland\6fc8191f-54fd-4b70-82f3-7e740eeacd99\scratchpad\potr\2937991425\Mods\Vanilla\Textures`
  (in bash: `$SRC` below). If missing, re-extract: `7z x -y "<repo>/Portaits of the Rim-425-1-0-1677267997.7z" -o<scratchpad>/potr`.
- `CharacterPortrait` public interface must not change: `{ appearance, mood, size?, className? }`.

---

### Task 1: Curate and organize source assets + credits

**Files:**
- Create: `assets/portraits/CREDITS.md`
- Create: `assets/portraits/source/{head,face,hair,beard,neck,clothes}/*.png` (curated copies, renamed to stable keys)

**Interfaces:**
- Produces: directory layout consumed by Task 2's build script. Variant key = filename without extension. Genders encoded as `f`/`m` prefix where applicable.

- [ ] **Step 1: Create layout and copy fixed picks**

```bash
SRC="/c/Users/ADMINI~1/AppData/Local/Temp/claude/c--Users-Administrator-Documents-Obsidian-Projetos-Hopeland/6fc8191f-54fd-4b70-82f3-7e740eeacd99/scratchpad/potr/2937991425/Mods/Vanilla/Textures"
cd /c/Users/Administrator/Documents/Obsidian/Projetos/Hopeland
mkdir -p assets/portraits/source/{head,face,hair,beard,neck,clothes}

# Heads: young adult (yf/ym), 6 shapes each. Mod names are lowercase "vanilla-".
for g in f m; do
  for s in averagenormal averagepointy averagewide narrownormal narrowpointy narrowwide; do
    cp "$SRC/Head/vanilla-y$g-$s.png" "assets/portraits/source/head/$g-$s.png"
  done
done

# Necks: adult (af/am), one per build tier. Mod names "Vanilla-a?-<tier>".
for g in f m; do
  for t in thin average heavy hulk; do
    cp "$SRC/Neck/Vanilla-a$g-$t.png" "assets/portraits/source/neck/$g-$t.png"
  done
done

# Hair (gender-neutral an-*), 10 picks:
for h in afro bob bowlcut curly long messy mohawk ponytails wavy tuft; do
  cp "$SRC/OuterHair/Vanilla-an-$h.png" "assets/portraits/source/hair/$h.png"
done

# Beards, 5 picks:
for b in anchor bushy circle classy french; do
  cp "$SRC/Beard/Vanilla-an-$b.png" "assets/portraits/source/beard/$b.png"
done
```

If any `cp` fails, `ls` the folder and adjust the filename case/prefix — the mod mixes `vanilla-` and `Vanilla-`.

- [ ] **Step 2: Verify Inner/Outer face pair, then copy faces**

View (with the Read tool) `$SRC/InnerFace/af/Vanilla-af-optimist.png` and `$SRC/OuterFace/af/Vanilla-af-optimist.png`. Expected: visually identical or near-identical (Inner/Outer = under/over headgear; we use no headgear). Use **InnerFace** as the single face source. If they differ meaningfully (e.g. one is a skin base, the other detail), copy BOTH into `face-inner/` and `face-outer/` instead and carry the two-layer face through Tasks 2-4 with `tint: "skin"` on inner only.

Mood buckets — primary picks (verify each visually; a low face should read sad/tense, high should read bright/warm; swap within the same folder if a pick reads wrong):

```bash
for g in f m; do
  cp "$SRC/InnerFace/a$g/Vanilla-a$g-depressive.png"  "assets/portraits/source/face/$g-low-1.png"
  cp "$SRC/InnerFace/a$g/Vanilla-a$g-pessimist.png"   "assets/portraits/source/face/$g-low-2.png"
  cp "$SRC/InnerFace/a$g/Vanilla-a$g-nervous.png"     "assets/portraits/source/face/$g-low-3.png"
  cp "$SRC/InnerFace/a$g/Vanilla-a$g-ascetic.png"     "assets/portraits/source/face/$g-mid-1.png"
  cp "$SRC/InnerFace/a$g/Vanilla-a$g-steadfast.png"   "assets/portraits/source/face/$g-mid-2.png"
  cp "$SRC/InnerFace/a$g/Vanilla-a$g-ironwilled.png"  "assets/portraits/source/face/$g-mid-3.png"
  cp "$SRC/InnerFace/a$g/Vanilla-a$g-optimist.png"    "assets/portraits/source/face/$g-high-1.png"
  cp "$SRC/InnerFace/a$g/Vanilla-a$g-sanguine.png"    "assets/portraits/source/face/$g-high-2.png"
  cp "$SRC/InnerFace/a$g/Vanilla-a$g-kind.png"        "assets/portraits/source/face/$g-high-3.png"
done
```

- [ ] **Step 3: Map professions to clothes**

List available torso clothing across all mod packs:

```bash
find "$SRC/.." -ipath "*ClothingTorso*" -name "*.png" | sed 's/.*\///' | sort -u | head -80
find "$SRC/../../"*/Textures -ipath "*ClothingTorso*" -name "*.png" 2>/dev/null | sed 's/.*\///' | sort -u | head -80
```

Pick ONE file per profession, criteria = closest visual match to the trade
(view candidates with Read when unsure). Copy as `clothes/<profession>.png` for all
12 professions: `ferreiro, lenhador, estivador, bibliotecario, contador, alquimista,
pescador, mensageiro, equilibrista, comerciante, menestrel, taberneiro`.
Fallback when nothing fits: `Vanilla-l-jacket.png`. Every profession MUST have a file.

- [ ] **Step 4: Write CREDITS.md**

```markdown
# Portrait assets — credits

Portrait artwork in `source/` (and its processed copies in
`app/public/portraits/`) comes from **Portraits of the Rim** by
**TwoPenny** (TwoPennyDoodle).

- Nexus Mods: https://www.nexusmods.com/rimworld/mods/425
- Author page: https://twopennydoodle.com/portraits

Assets are used with attribution, as permitted by the mod page's
permissions. Originals are 600×600 PNG; processed copies (320×320 WebP)
are generated by `app/scripts/build-portraits.mjs`.
```

- [ ] **Step 5: Verify counts and commit**

```bash
find assets/portraits/source -name "*.png" | wc -l   # expected: 12+8+10+5+18+12 = 65 (or 83 with face-inner/outer split)
git add assets/portraits && git commit -m "Add curated portrait source assets from Portraits of the Rim"
```

---

### Task 2: Build pipeline (sharp → WebP + manifest)

**Files:**
- Create: `app/scripts/build-portraits.mjs`
- Modify: `app/package.json` (add `build:portraits` script; add `sharp` devDependency)
- Create (generated, committed): `app/public/portraits/**/*.webp`, `app/public/portraits/manifest.json`

**Interfaces:**
- Consumes: `assets/portraits/source/<layer>/<variantKey>.png` (Task 1).
- Produces: `manifest.json` matching the `PortraitManifest` type in Task 3:
  `{ version: 1, size: 320, credit: string, layers: Record<layerKey, { tint: "skin"|"hair"|null, variants: Record<variantKey, relativePath> }> }`
  with layer keys exactly `neck, clothes, head, face, beard, hair` in z-order.

- [ ] **Step 1: Add sharp**

```bash
cd app && bun add -d sharp
```

- [ ] **Step 2: Write the script**

```js
// app/scripts/build-portraits.mjs
// Converts curated portrait sources (assets/portraits/source) into
// 320x320 WebP layers + manifest.json under app/public/portraits.
// Run manually when curation changes: bun run build:portraits
import sharp from "sharp";
import { mkdir, readdir, rm, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(ROOT, "assets", "portraits", "source");
const OUT = path.join(ROOT, "app", "public", "portraits");
const SIZE = 320;
const MAX_BYTES = 60 * 1024;

// z-order bottom -> top; tint: which derived color multiplies the layer
const LAYERS = [
  { key: "neck",    tint: "skin" },
  { key: "clothes", tint: null  },
  { key: "head",    tint: "skin" },
  { key: "face",    tint: null  },
  { key: "beard",   tint: "hair" },
  { key: "hair",    tint: "hair" },
];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const manifest = {
  version: 1,
  size: SIZE,
  credit: "Portrait assets by TwoPenny — Portraits of the Rim (Nexus 425)",
  layers: {},
};

let failures = 0;
for (const { key, tint } of LAYERS) {
  const dir = path.join(SRC, key);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".png")).sort();
  if (files.length === 0) { console.error(`EMPTY layer dir: ${dir}`); failures++; continue; }
  await mkdir(path.join(OUT, key), { recursive: true });
  const variants = {};
  for (const file of files) {
    const variant = file.replace(/\.png$/, "");
    const rel = `${key}/${variant}.webp`;
    const outFile = path.join(OUT, key, `${variant}.webp`);
    await sharp(path.join(dir, file))
      .resize(SIZE, SIZE, { fit: "contain" })
      .webp({ quality: 80 })
      .toFile(outFile);
    const { size } = await stat(outFile);
    if (size > MAX_BYTES) { console.error(`TOO BIG (${size}B): ${rel}`); failures++; }
    variants[variant] = rel;
  }
  manifest.layers[key] = { tint, variants };
}

await writeFile(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`portraits: ${Object.values(manifest.layers).reduce((n, l) => n + Object.keys(l.variants).length, 0)} variants -> ${OUT}`);
if (failures > 0) { console.error(`${failures} validation failure(s)`); process.exit(1); }
```

If Task 1 ended with the `face-inner`/`face-outer` split, replace the single
`face` entry in `LAYERS` with `{ key: "face-inner", tint: "skin" }` and
`{ key: "face-outer", tint: null }` (keeping this order).

- [ ] **Step 3: Add the npm script**

In `app/package.json` `"scripts"`, add:

```json
"build:portraits": "bun scripts/build-portraits.mjs"
```

- [ ] **Step 4: Run and verify**

```bash
cd app && bun run build:portraits
```

Expected: `portraits: 65 variants -> ...` (count matches Task 1), exit 0, and
`app/public/portraits/manifest.json` exists. Spot-check one WebP by viewing it
with the Read tool — it must look like the source PNG, centered, transparent
background.

- [ ] **Step 5: Commit**

```bash
git add app/scripts/build-portraits.mjs app/package.json app/bun.lock app/public/portraits
git commit -m "Add portrait build pipeline (sharp -> 320px WebP + manifest)"
```

---

### Task 3: Seed + gender in schema, deterministic selection engine

**Files:**
- Modify: `app/src/lib/character-schema.ts` (Appearance gains `seed`, `gender`; `buildCharacter` fills them; delete the unused `APPEARANCE_ASSET_MAP` stub at the bottom of the file)
- Create: `app/src/lib/portrait-selection.ts`
- Test: `app/src/lib/portrait-selection.test.ts`

**Interfaces:**
- Consumes: `manifest.json` (Task 2) — in tests, imported directly via `import manifest from "../../public/portraits/manifest.json"`.
- Produces (used by Task 4):

```ts
// portrait-selection.ts exports
export type TintKind = "skin" | "hair" | null;
export interface PortraitManifest {
  version: number;
  size: number;
  credit: string;
  layers: Record<string, { tint: TintKind; variants: Record<string, string> }>;
}
export interface SelectedLayer { layer: string; url: string; tint: string | null }
export function mulberry32(seed: number): () => number;
export function genderFromSeed(seed: number): "f" | "m";
export function selectPortraitLayers(
  appearance: Appearance, mood: number, manifest: PortraitManifest,
): SelectedLayer[];
export const SKIN_COLOR: Record<SkinTone, string>;  // moved from CharacterPortrait.tsx
export const HAIR_COLORS: string[];
```

- `character-schema.ts`: `Appearance` gains `seed: number` and `gender: "f" | "m"`; `buildCharacter` sets `seed = crypto.getRandomValues(new Uint32Array(1))[0]` and `gender = genderFromSeed(seed)`.

- [ ] **Step 1: Write the failing tests**

```ts
// app/src/lib/portrait-selection.test.ts
import { describe, expect, test } from "bun:test";
import manifest from "../../public/portraits/manifest.json";
import {
  genderFromSeed, mulberry32, selectPortraitLayers,
  type PortraitManifest,
} from "./portrait-selection";
import { buildCharacter } from "./character-schema";

const m = manifest as PortraitManifest;

function appearanceWithSeed(seed: number) {
  const c = buildCharacter({ category: "fisica", profession: "ferreiro", origin: "praia" });
  return { ...c.appearance, seed, gender: genderFromSeed(seed) };
}

describe("mulberry32", () => {
  test("same seed produces same sequence", () => {
    const a = mulberry32(42), b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("selectPortraitLayers", () => {
  test("deterministic: same appearance+mood -> same selection", () => {
    const app = appearanceWithSeed(123456);
    expect(selectPortraitLayers(app, 50, m)).toEqual(selectPortraitLayers(app, 50, m));
  });

  test("every selected variant exists in the manifest", () => {
    for (const seed of [0, 1, 999, 2 ** 31, 4294967295]) {
      for (const mood of [0, 50, 100]) {
        for (const sel of selectPortraitLayers(appearanceWithSeed(seed), mood, m)) {
          expect(sel.url.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("mood buckets swap only the face layer", () => {
    const app = appearanceWithSeed(777);
    const low = selectPortraitLayers(app, 10, m);
    const high = selectPortraitLayers(app, 90, m);
    const diff = low.filter((l, i) => l.url !== high[i]?.url).map((l) => l.layer);
    expect(diff.every((k) => k.startsWith("face"))).toBe(true);
    expect(diff.length).toBeGreaterThan(0);
  });

  test("clothes follow profession, skin follows origin", () => {
    const c = buildCharacter({ category: "social", profession: "menestrel", origin: "deserto" });
    const sel = selectPortraitLayers(c.appearance, 50, m);
    expect(sel.find((l) => l.layer === "clothes")!.url).toContain("menestrel");
  });

  test("beard only for m, hair layer always present", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const app = appearanceWithSeed(seed);
      const layers = selectPortraitLayers(app, 50, m).map((l) => l.layer);
      expect(layers).toContain("hair");
      if (app.gender === "f") expect(layers).not.toContain("beard");
    }
  });
});

describe("buildCharacter appearance", () => {
  test("fills seed and matching gender", () => {
    const c = buildCharacter({ category: "agil", profession: "pescador", origin: "mar" });
    expect(Number.isInteger(c.appearance.seed)).toBe(true);
    expect(c.appearance.gender).toBe(genderFromSeed(c.appearance.seed));
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd app && bun test portrait-selection
```

Expected: FAIL — `Cannot find module './portrait-selection'`.

- [ ] **Step 3: Implement**

```ts
// app/src/lib/portrait-selection.ts
// Deterministic portrait layer selection. All randomness comes from
// appearance.seed via mulberry32; the draw order below is a stable
// contract — append new draws at the end, never reorder.
import { moodExpression, type Appearance, type SkinTone } from "./character-schema";

export type TintKind = "skin" | "hair" | null;

export interface PortraitManifest {
  version: number;
  size: number;
  credit: string;
  layers: Record<string, { tint: TintKind; variants: Record<string, string> }>;
}

export interface SelectedLayer { layer: string; url: string; tint: string | null }

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function genderFromSeed(seed: number): "f" | "m" {
  return mulberry32(seed)() < 0.5 ? "f" : "m";
}

export const SKIN_COLOR: Record<SkinTone, string> = {
  warm_tan:     "#d2a074",
  pale_flushed: "#f0d3c4",
  earth_deep:   "#8b5a3c",
  light_brown:  "#b98764",
  very_pale:    "#f4e0d3",
  gray_tan:     "#b39683",
  neutral:      "#c99b7a",
};

export const HAIR_COLORS = [
  "#2b2118", "#4a3222", "#6b4a2f", "#8a4b32", "#c9a55c", "#9b9184",
];

const HEAD_SHAPES = [
  "averagenormal", "averagepointy", "averagewide",
  "narrownormal", "narrowpointy", "narrowwide",
];

const NECK_BY_BUILD: Record<Appearance["build"], string> = {
  slim: "thin", average: "average", sturdy: "heavy", robust: "hulk",
};

function pick<T>(rand: () => number, arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

export function selectPortraitLayers(
  appearance: Appearance,
  mood: number,
  manifest: PortraitManifest,
): SelectedLayer[] {
  const rand = mulberry32(appearance.seed);
  // Draw order contract (see header). Gender is draw #1 so it always
  // matches genderFromSeed(seed).
  const gender = rand() < 0.5 ? "f" : "m";
  const headShape = pick(rand, HEAD_SHAPES);
  const hairVariant = pick(rand, Object.keys(manifest.layers.hair.variants));
  const hairColor = pick(rand, HAIR_COLORS);
  const hasBeard = rand() < 0.5;
  const beardVariant = pick(rand, Object.keys(manifest.layers.beard.variants));
  const faceBucketVariant = { low: 1 + Math.floor(rand() * 3), mid: 1 + Math.floor(rand() * 3), high: 1 + Math.floor(rand() * 3) };

  const skin = SKIN_COLOR[appearance.skinTone];
  const bucket = moodExpression(mood);

  const wanted: Record<string, string | null> = {
    neck: `${gender}-${NECK_BY_BUILD[appearance.build]}`,
    clothes: appearance.clothes,
    head: `${gender}-${headShape}`,
    face: `${gender}-${bucket}-${faceBucketVariant[bucket]}`,
    "face-inner": `${gender}-${bucket}-${faceBucketVariant[bucket]}`,
    "face-outer": `${gender}-${bucket}-${faceBucketVariant[bucket]}`,
    beard: gender === "m" && hasBeard ? beardVariant : null,
    hair: hairVariant,
  };

  const out: SelectedLayer[] = [];
  for (const [layer, def] of Object.entries(manifest.layers)) {
    const variant = wanted[layer];
    if (variant == null) continue;
    const file = def.variants[variant];
    if (!file) {
      throw new Error(`portrait manifest: layer "${layer}" has no variant "${variant}"`);
    }
    out.push({
      layer,
      url: `/portraits/${file}`,
      tint: def.tint === "skin" ? skin : def.tint === "hair" ? hairColor : null,
    });
  }
  return out;
}
```

In `app/src/lib/character-schema.ts`:

1. Change the `Appearance` interface: replace the three placeholder fields with

```ts
export interface Appearance {
  skinTone: SkinTone;
  facialMark: FacialMark;
  build: Build;
  seed: number;          // u32; sole randomness source for portrait layers
  gender: "f" | "m";     // = genderFromSeed(seed); stored for future explicit choice
  clothes: Profession;   // 1:1 with profession, resolved via the portrait manifest
  hair: "placeholder_default";
  scars: "placeholder_none";
}
```

2. In `buildCharacter`, replace the `appearance` construction with:

```ts
import { genderFromSeed } from "./portrait-selection";
// ...
const seed = crypto.getRandomValues(new Uint32Array(1))[0];
const appearance: Appearance = {
  skinTone: appearanceBase.skinTone,
  facialMark: appearanceBase.facialMark,
  build: buildFromPhysical(skills.fisica),
  seed,
  gender: genderFromSeed(seed),
  clothes: input.profession,
  hair: "placeholder_default",
  scars: "placeholder_none",
};
```

3. Delete the `APPEARANCE_ASSET_MAP` export at the bottom of the file (replaced by the manifest). `grep -rn "APPEARANCE_ASSET_MAP" app/src` first; the only other reference is a comment in `CharacterPortrait.tsx`, removed in Task 4.

Note the import direction: `portrait-selection.ts` imports types from `character-schema.ts`, and `character-schema.ts` imports `genderFromSeed` from `portrait-selection.ts`. This cycle is type-safe here (both are ESM live bindings and neither calls the other at module top level), but if bun or vite complains, move `mulberry32`+`genderFromSeed` into a tiny `app/src/lib/prng.ts` imported by both.

- [ ] **Step 4: Run tests, verify they pass**

```bash
cd app && bun test portrait-selection
```

Expected: all tests PASS. If `clothes follow profession` fails because Task 1 named a clothes file differently, fix the source filename (it must be exactly the profession id) and re-run `bun run build:portraits`.

- [ ] **Step 5: Typecheck and commit**

```bash
cd app && bunx tsc --noEmit
git add src/lib/portrait-selection.ts src/lib/portrait-selection.test.ts src/lib/character-schema.ts
git commit -m "Add seeded portrait layer selection engine"
```

---

### Task 4: Canvas compositing renderer + component rewrite + credit footer

**Files:**
- Create: `app/src/components/portrait/composite.ts`
- Create: `app/src/components/portrait/fallback.ts` (existing geometric drawing moved verbatim)
- Modify: `app/src/components/CharacterPortrait.tsx` (slim orchestrator, same public props)
- Modify: `app/src/routes/character-creation.tsx` (credit footer)

**Interfaces:**
- Consumes: `selectPortraitLayers`, `SelectedLayer`, `PortraitManifest` from Task 3; `manifest.json` served at `/portraits/manifest.json`.
- Produces: same `CharacterPortrait` component contract as today: `{ appearance: Appearance; mood: number; size?: number; className?: string }`.

- [ ] **Step 1: Write composite.ts**

```ts
// app/src/components/portrait/composite.ts
// Loads and composites portrait layers on a canvas. White mod art is
// tinted via multiply + destination-in (preserves the layer's alpha).
import type { PortraitManifest, SelectedLayer } from "@/lib/portrait-selection";

let manifestPromise: Promise<PortraitManifest> | null = null;

export function loadManifest(): Promise<PortraitManifest> {
  if (!manifestPromise) {
    manifestPromise = fetch("/portraits/manifest.json").then((r) => {
      if (!r.ok) throw new Error(`manifest fetch failed: ${r.status}`);
      return r.json() as Promise<PortraitManifest>;
    });
    // Allow retry after a transient failure instead of caching the rejection.
    manifestPromise.catch(() => { manifestPromise = null; });
  }
  return manifestPromise;
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  let p = imageCache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`portrait layer failed to load: ${url}`));
      img.src = url;
    });
    p.catch(() => { imageCache.delete(url); });
    imageCache.set(url, p);
  }
  return p;
}

function tinted(img: HTMLImageElement, color: string): HTMLCanvasElement {
  const off = document.createElement("canvas");
  off.width = img.naturalWidth;
  off.height = img.naturalHeight;
  const ctx = off.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, off.width, off.height);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(img, 0, 0);
  return off;
}

export async function compositePortrait(
  canvas: HTMLCanvasElement,
  layers: SelectedLayer[],
): Promise<void> {
  const images = await Promise.all(layers.map((l) => loadImage(l.url)));
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  layers.forEach((layer, i) => {
    const source = layer.tint ? tinted(images[i], layer.tint) : images[i];
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  });
}
```

- [ ] **Step 2: Extract the geometric fallback**

Move ALL drawing code currently in `CharacterPortrait.tsx` (the `SKIN_COLOR` map,
`BUILD_WIDTH`, `draw`, `drawHead`, `drawShoulders`, `drawMarks`, `freckles`, `dot`,
`drawExpression`, and any helpers) verbatim into
`app/src/components/portrait/fallback.ts`, exporting a single entry point:

```ts
export function drawFallbackPortrait(
  canvas: HTMLCanvasElement,
  appearance: Appearance,
  mood: number,
): void { /* existing draw(...) body, adapted to take the canvas */ }
```

Import `SKIN_COLOR` from `@/lib/portrait-selection` instead of keeping a local
copy (delete the duplicated map). Do not otherwise change the drawing logic.

- [ ] **Step 3: Rewrite CharacterPortrait.tsx**

```tsx
// app/src/components/CharacterPortrait.tsx
import { useEffect, useRef } from "react";
import type { Appearance } from "@/lib/character-schema";
import { selectPortraitLayers } from "@/lib/portrait-selection";
import { compositePortrait, loadManifest } from "./portrait/composite";
import { drawFallbackPortrait } from "./portrait/fallback";

export interface CharacterPortraitProps {
  appearance: Appearance;
  mood: number;
  size?: number;
  className?: string;
}

export function CharacterPortrait({ appearance, mood, size = 192, className }: CharacterPortraitProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    // Legacy characters created before the seed field exist in
    // sessionStorage; they keep the geometric portrait.
    if (typeof appearance.seed !== "number") {
      drawFallbackPortrait(canvas, appearance, mood);
      return;
    }

    drawFallbackPortrait(canvas, appearance, mood); // placeholder while layers load
    loadManifest()
      .then((manifest) => {
        if (cancelled) return;
        return compositePortrait(canvas, selectPortraitLayers(appearance, mood, manifest));
      })
      .catch((error) => {
        console.error("[portrait] falling back to geometric render:", error);
        if (!cancelled && canvasRef.current) drawFallbackPortrait(canvasRef.current, appearance, mood);
      });

    return () => { cancelled = true; };
  }, [appearance, mood, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Retrato do personagem"
    />
  );
}
```

Remove the old `APPEARANCE_ASSET_MAP` comment references. Note the effect keys on
`mood`, not the bucket — re-running composite inside the same bucket redraws the
same cached images (cheap); crossing a bucket swaps the face layer.

- [ ] **Step 4: Add the credit footer**

In `app/src/routes/character-creation.tsx`, directly after the step content
`</div>` that closes `<div key={step} ...>` (inside the `max-w-3xl` container), add:

```tsx
<p className="mt-16 text-center text-xs text-muted-foreground">
  Arte do retrato:{" "}
  <a
    href="https://www.nexusmods.com/rimworld/mods/425"
    target="_blank"
    rel="noreferrer"
    className="underline underline-offset-2 hover:text-foreground"
  >
    TwoPenny — Portraits of the Rim
  </a>
</p>
```

- [ ] **Step 5: Typecheck, test, visual verification**

```bash
cd app && bunx tsc --noEmit && bun test
bun run dev
```

In the browser (dev server URL): complete the creation flow (any three answers)
and confirm on the naming step: layered portrait renders (not the geometric one),
skin tone varies with origin (try `deserto` = dark vs `cavernas` = very pale),
male characters sometimes have beards across page reloads, and the credit footer
link is present. **Check the tint question from Task 1:** with a dark-skinned
origin, confirm the face layer doesn't show jarring white patches; if it does,
change the face entry in `build-portraits.mjs` `LAYERS` to `tint: "skin"`,
re-run `bun run build:portraits`, and re-check (eyes will tint slightly — accept
whichever reads better).

- [ ] **Step 6: Commit**

```bash
git add src/components/CharacterPortrait.tsx src/components/portrait src/routes/character-creation.tsx
git commit -m "Render layered portraits with canvas tint compositing"
```

---

### Task 5: Full verification + PR

**Files:** none new.

- [ ] **Step 1: Full check battery**

```bash
cd app && bun test && bunx tsc --noEmit && bun run lint && bun run build
```

Expected: all pass; build emits `.output/server/index.mjs` and `.output/public/portraits/manifest.json` (confirm with `ls .output/public/portraits | head`).

- [ ] **Step 2: Push and open PR**

```bash
git push -u origin feat/portrait-system
```

PR link: `https://github.com/Enzo-Azevedo/Hopeland/pull/new/feat/portrait-system`.
PR body summarizes: layered portraits from Portraits of the Rim (credit TwoPenny),
seeded deterministic selection, mood-driven expression, sharp build pipeline,
geometric fallback kept. Reminder: verify Nexus page permissions text is quoted
in `assets/portraits/CREDITS.md`.
