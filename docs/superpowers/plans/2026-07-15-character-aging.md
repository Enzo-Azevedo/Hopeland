# Character Aging Implementation Plan (Spec B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Characters start as children, age through c/t/y/m/e stages from accumulated playtime, keep the same identity across stages, and die of old age at 284h.

**Architecture:** A pure `age-stage` module maps `played_seconds` to stages. Portrait sources gain stage-prefixed variants (heads all 5 stages; faces/necks c/t/a; hair c/a); the selection engine takes an `ageStage` parameter that only changes key prefixes — the PRNG draw contract is untouched, so the same seed is the same person at any age. A second migration folds death-by-age into `heartbeat_tick()`; the game route shows a DeathView and releases creation.

**Tech Stack:** bun test, sharp pipeline (unchanged), Supabase migration, TanStack server fns.

**Spec:** `docs/superpowers/specs/2026-07-15-character-aging-design.md`

## Global Constraints

- Branch `feat/character-aging` (from current `main`). Commits: short English subject, NO Co-Authored-By trailer.
- User-facing copy PT-BR.
- Stage thresholds (active play, cumulative): child < 8h; teen < 24h; young < 84h; middle < 234h; elder < 284h; dead at ≥ 284h (`1_022_400` seconds). Age is DERIVED from `played_seconds`, never stored.
- PRNG draw order contract unchanged (9 draws). `ageStage` only changes variant-key prefixes.
- Plan-level refinement of the spec (document in the commit): `clothes` and `beard` layers do NOT get stage prefixes — clothing art is age-agnostic in the mod (`s/m/l/xl` sizes already encode PawnBodyType incl. children/teens), so the child stage re-adds the `s` files and size selection handles age; beards are adult-only. All other age-varying layers (head, face-inner/outer, neck, hair) get stage-prefixed keys, including the existing adult files (one-time rename).
- Mod source (read-only): `C:\Users\ADMINI~1\AppData\Local\Temp\claude\c--Users-Administrator-Documents-Obsidian-Projetos-Hopeland\6fc8191f-54fd-4b70-82f3-7e740eeacd99\scratchpad\potr\2937991425\Mods` (`$SRC` below; if missing, re-extract the repo-root `Portaits of the Rim-425-1-0-1677267997.7z` with `7z x`).
- Expected manifest total after rebuild: 259 variants (neck 18, clothes 48, head 60, face-inner 54, face-outer 54, beard 5, hair 20).
- Executor cannot apply the DB migration; Task 5 reports the gate to the owner.

---

### Task 1: Age-stage module

**Files:**
- Create: `app/src/lib/age-stage.ts`
- Test: `app/src/lib/age-stage.test.ts`

**Interfaces:**
- Produces:

```ts
export type AgeStage = "c" | "t" | "y" | "m" | "e";
export const DEATH_SECONDS = 1_022_400; // 284h
export function ageStage(playedSeconds: number): AgeStage;
export function isDeadByAge(playedSeconds: number): boolean;
export function stageLabel(stage: AgeStage): string; // PT-BR
```

- [ ] **Step 1: Write the failing tests**

```ts
// app/src/lib/age-stage.test.ts
import { describe, expect, test } from "bun:test";
import { ageStage, isDeadByAge, stageLabel, DEATH_SECONDS } from "./age-stage";

const H = 3600;

describe("ageStage", () => {
  test("boundaries", () => {
    expect(ageStage(0)).toBe("c");
    expect(ageStage(8 * H - 1)).toBe("c");
    expect(ageStage(8 * H)).toBe("t");
    expect(ageStage(24 * H - 1)).toBe("t");
    expect(ageStage(24 * H)).toBe("y");
    expect(ageStage(84 * H - 1)).toBe("y");
    expect(ageStage(84 * H)).toBe("m");
    expect(ageStage(234 * H - 1)).toBe("m");
    expect(ageStage(234 * H)).toBe("e");
    expect(ageStage(284 * H - 1)).toBe("e");
    expect(ageStage(284 * H)).toBe("e"); // stage caps at elder even past death
  });

  test("death threshold", () => {
    expect(DEATH_SECONDS).toBe(284 * H);
    expect(isDeadByAge(DEATH_SECONDS - 1)).toBe(false);
    expect(isDeadByAge(DEATH_SECONDS)).toBe(true);
  });

  test("labels are PT-BR", () => {
    expect(stageLabel("c")).toBe("Criança");
    expect(stageLabel("t")).toBe("Adolescente");
    expect(stageLabel("y")).toBe("Jovem adulto");
    expect(stageLabel("m")).toBe("Meia-idade");
    expect(stageLabel("e")).toBe("Idoso");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app && bun test age-stage`
Expected: FAIL — `Cannot find module './age-stage'`.

- [ ] **Step 3: Implement**

```ts
// app/src/lib/age-stage.ts
// Age is derived from accumulated active playtime; never stored.
export type AgeStage = "c" | "t" | "y" | "m" | "e";

const H = 3600;
const TEEN_AT = 8 * H;
const YOUNG_AT = 24 * H;
const MIDDLE_AT = 84 * H;
const ELDER_AT = 234 * H;
export const DEATH_SECONDS = 284 * H;

export function ageStage(playedSeconds: number): AgeStage {
  if (playedSeconds < TEEN_AT) return "c";
  if (playedSeconds < YOUNG_AT) return "t";
  if (playedSeconds < MIDDLE_AT) return "y";
  if (playedSeconds < ELDER_AT) return "m";
  return "e";
}

export function isDeadByAge(playedSeconds: number): boolean {
  return playedSeconds >= DEATH_SECONDS;
}

const LABELS: Record<AgeStage, string> = {
  c: "Criança", t: "Adolescente", y: "Jovem adulto", m: "Meia-idade", e: "Idoso",
};

export function stageLabel(stage: AgeStage): string {
  return LABELS[stage];
}
```

- [ ] **Step 4: Verify green**

Run: `cd app && bun test age-stage && bunx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/age-stage.ts app/src/lib/age-stage.test.ts
git commit -m "Add age stage derivation from playtime"
```

---

### Task 2: Stage-prefixed asset curation + rebuild

**Files:**
- Rename/Create: `assets/portraits/source/{head,face-inner,face-outer,neck,hair,clothes}/*` (see steps)
- Modify: `assets/portraits/CREDITS.md` (stage note)
- Regenerate: `app/public/portraits/**` via `bun run build:portraits`

**Interfaces:**
- Produces manifest variant keys consumed by Task 3:
  head `{c|t|y|m|e}-{f|m}-<shape>`; face-inner/outer `{c|t|a}-{f|m}-{low|mid|high}-{1..3}`;
  neck `c-{f|m}-child`, `{t|a}-{f|m}-{thin|average|heavy|hulk}`; hair `{c|a}-<name>`;
  clothes `<profession>-{s|m|l|xl}` (s re-added); beard unchanged.

- [ ] **Step 1: Rename existing adult sources to stage-prefixed names**

```bash
cd /c/Users/Administrator/Documents/Obsidian/Projetos/Hopeland/assets/portraits/source
for f in head/*.png;        do git mv "$f" "head/y-$(basename "$f")"; done
for d in face-inner face-outer; do for f in $d/*.png; do git mv "$f" "$d/a-$(basename "$f")"; done; done
for f in neck/*.png;        do git mv "$f" "neck/a-$(basename "$f")"; done
for f in hair/*.png;        do git mv "$f" "hair/a-$(basename "$f")"; done
# beard and clothes keep their names
```

- [ ] **Step 2: Copy the new age tiers from the mod**

```bash
SRC="/c/Users/ADMINI~1/AppData/Local/Temp/claude/c--Users-Administrator-Documents-Obsidian-Projetos-Hopeland/6fc8191f-54fd-4b70-82f3-7e740eeacd99/scratchpad/potr/2937991425/Mods/Vanilla/Textures"
cd /c/Users/Administrator/Documents/Obsidian/Projetos/Hopeland/assets/portraits/source

# Heads: child/teen/middle/elder (young already renamed above)
for a in c t m e; do for g in f m; do
  for s in averagenormal averagepointy averagewide narrownormal narrowpointy narrowwide; do
    cp "$SRC/Head/vanilla-$a$g-$s.png" "head/$a-$g-$s.png"
  done
done; done

# Faces: child + teen, same 9 trait picks per mood bucket as the adult set
declare -A PICK=( [low-1]=depressive [low-2]=pessimist [low-3]=nervous
                  [mid-1]=ascetic [mid-2]=steadfast [mid-3]=ironwilled
                  [high-1]=optimist [high-2]=sanguine [high-3]=kind )
for a in c t; do for g in f m; do for k in "${!PICK[@]}"; do
  cp "$SRC/InnerFace/$a$g/Vanilla-$a$g-${PICK[$k]}.png" "face-inner/$a-$g-$k.png"
  cp "$SRC/OuterFace/$a$g/Vanilla-$a$g-${PICK[$k]}.png" "face-outer/$a-$g-$k.png"
done; done; done

# Necks: child (single) + teen (4 tiers)
for g in f m; do
  cp "$SRC/Neck/Vanilla-c$g-child.png" "neck/c-$g-child.png"
  for t in thin average heavy hulk; do
    cp "$SRC/Neck/Vanilla-t$g-$t.png" "neck/t-$g-$t.png"
  done
done

# Child hair: same 10 names, cn- variants
for h in afro bob bowlcut curly long messy mohawk ponytails wavy tuft; do
  cp "$SRC/OuterHair/Vanilla-cn-$h.png" "hair/c-$h.png"
done
```

If a `cp` fails, `ls` the folder for case differences (`vanilla-` vs `Vanilla-`) and adjust.

- [ ] **Step 3: Re-add child clothing sizes (s)**

Same garment sources as CREDITS.md's mapping table, `s` variant this time
(search across ALL packs, style variants excluded):

```bash
SRCM="/c/Users/ADMINI~1/AppData/Local/Temp/claude/c--Users-Administrator-Documents-Obsidian-Projetos-Hopeland/6fc8191f-54fd-4b70-82f3-7e740eeacd99/scratchpad/potr/2937991425/Mods"
cd /c/Users/Administrator/Documents/Obsidian/Projetos/Hopeland/assets/portraits/source/clothes
declare -A MAP=( [ferreiro]=Quiltedvest [lenhador]=Buildersjacket [estivador]=overalls
  [bibliotecario]=Tunic [contador]=Shirtandtie [alquimista]=labcoat [pescador]=parka
  [mensageiro]=jacket [equilibrista]=Jesteroutfit [comerciante]=vest [menestrel]=Blouse
  [taberneiro]=Chefsuniform )
for prof in "${!MAP[@]}"; do
  src=$(find "$SRCM" -name "*-s-${MAP[$prof]}.png" | grep -vi style | head -1)
  if [ -z "$src" ]; then echo "MISSING: $prof"; else cp "$src" "./$prof-s.png"; fi
done
ls *-s.png | wc -l   # expected: 12
```

- [ ] **Step 4: Update CREDITS.md**

In `assets/portraits/CREDITS.md`, in the "Notes on curation" area, add:

```markdown
### Age stages

Head/face/neck/hair sources are stage-prefixed: heads carry the full
`c/t/y/m/e` mod tiers; faces and necks use art stages `c/t/a` (adult art
covers young/middle/elder); hair uses `c/a`. Face trait picks and hair names
are identical across stages, so a character's identity persists as they age.
Clothes are age-agnostic (`s` is worn by children per the mod's PawnBodyType
rules); beards are adult-only.
```

Also update the clothes-sizes sentence ("three adult size variants") to
mention `s/m/l/xl` with `s` = children.

- [ ] **Step 5: Rebuild and verify counts**

```bash
cd /c/Users/Administrator/Documents/Obsidian/Projetos/Hopeland/app && bun run build:portraits
```

Expected output: `portraits: 259 variants -> ...`, exit 0.
Spot-check with the Read tool: one child head (`app/public/portraits/head/c-f-averagenormal.webp`)
and one child face (`face-inner/c-f-high-1.webp`) — must look like child-proportioned art.

- [ ] **Step 6: Commit**

```bash
git add assets/portraits app/public/portraits
git commit -m "Curate age-tier portrait assets with stage-prefixed keys"
```

Note: Task 3's selection tests will fail between this commit and the next —
the manifest keys changed shape. That is expected mid-branch; do not "fix"
by reverting.

---

### Task 3: Selection engine ageStage parameter

**Files:**
- Modify: `app/src/lib/portrait-selection.ts`
- Test: `app/src/lib/portrait-selection.test.ts` (update + extend)

**Interfaces:**
- Consumes: `AgeStage`, `ageStage` from Task 1; Task 2 manifest keys.
- Produces (Task 4 relies on): `selectPortraitLayers(appearance, mood, manifest, stage: AgeStage = "y")` — 4th param optional.

- [ ] **Step 1: Update the test file**

Replace the whole `portrait-selection.test.ts` content:

```ts
import { describe, expect, test } from "bun:test";
import manifest from "../../public/portraits/manifest.json";
import {
  genderFromSeed, mulberry32, selectPortraitLayers,
  type PortraitManifest,
} from "./portrait-selection";
import { buildCharacter, type Category, type Profession } from "./character-schema";
import type { AgeStage } from "./age-stage";

const m = manifest as PortraitManifest;
const STAGES: AgeStage[] = ["c", "t", "y", "m", "e"];

const BASE_INPUT = {
  category: "fisica", profession: "ferreiro", origin: "praia",
  name: "Teste", gender: "f",
} as const;

function appearanceWithSeed(seed: number, gender: "f" | "m" = genderFromSeed(seed)) {
  const c = buildCharacter({ ...BASE_INPUT, gender });
  return { ...c.appearance, seed, gender };
}

describe("mulberry32", () => {
  test("same seed produces same sequence", () => {
    const a = mulberry32(42), b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("selectPortraitLayers", () => {
  test("deterministic and defaults to young adult", () => {
    const app = appearanceWithSeed(123456);
    expect(selectPortraitLayers(app, 50, m)).toEqual(selectPortraitLayers(app, 50, m, "y"));
  });

  test("exhaustive: every stage x gender x build x mood resolves", () => {
    const builds = ["slim", "average", "sturdy", "robust"] as const;
    for (const stage of STAGES) {
      for (const gender of ["f", "m"] as const) {
        for (const build of builds) {
          for (const mood of [0, 50, 100]) {
            const app = { ...appearanceWithSeed(97, gender), build };
            const sel = selectPortraitLayers(app, mood, m, stage);
            expect(sel.length).toBeGreaterThanOrEqual(5);
          }
        }
      }
    }
  });

  test("identity persists across stages: same hair name and face trait slot", () => {
    const app = appearanceWithSeed(2024, "m");
    const variantOf = (stage: AgeStage, layer: string) =>
      selectPortraitLayers(app, 50, m, stage).find((l) => l.layer === layer)?.url ?? "";
    // hair: c-<name> as child, a-<name> otherwise — same <name>
    const childHair = variantOf("c", "hair").split("/").pop()!;
    const adultHair = variantOf("e", "hair").split("/").pop()!;
    expect(childHair.replace(/^c-/, "")).toBe(adultHair.replace(/^a-/, ""));
    // face: same bucket-slot across stages
    const childFace = variantOf("c", "face-inner").split("/").pop()!;
    const elderFace = variantOf("e", "face-inner").split("/").pop()!;
    expect(childFace.replace(/^c-/, "")).toBe(elderFace.replace(/^a-/, ""));
    // head follows the exact stage
    expect(variantOf("m", "head").split("/").pop()!.startsWith("m-m-")).toBe(true);
  });

  test("children: no beard, single neck, size s clothes", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const app = { ...appearanceWithSeed(seed, "m"), build: "robust" as const };
      const sel = selectPortraitLayers(app, 50, m, "c");
      expect(sel.map((l) => l.layer)).not.toContain("beard");
      expect(sel.find((l) => l.layer === "neck")!.url).toContain("c-m-child");
      expect(sel.find((l) => l.layer === "clothes")!.url).toContain("-s.webp");
    }
  });

  test("teens: neck has build tiers, clothes m (or l for heavy male)", () => {
    const slim = { ...appearanceWithSeed(7, "m"), build: "slim" as const };
    expect(selectPortraitLayers(slim, 50, m, "t").find((l) => l.layer === "neck")!.url)
      .toContain("t-m-thin");
    expect(selectPortraitLayers(slim, 50, m, "t").find((l) => l.layer === "clothes")!.url)
      .toContain("-m.webp");
    const heavy = { ...appearanceWithSeed(7, "m"), build: "robust" as const };
    expect(selectPortraitLayers(heavy, 50, m, "t").find((l) => l.layer === "clothes")!.url)
      .toContain("-l.webp");
  });

  test("adult clothes mapping unchanged by stage y/m/e", () => {
    const app = { ...appearanceWithSeed(11, "m"), build: "robust" as const, clothes: "estivador" as const };
    for (const stage of ["y", "m", "e"] as const) {
      expect(selectPortraitLayers(app, 50, m, stage).find((l) => l.layer === "clothes")!.url)
        .toContain("estivador-xl");
    }
  });

  test("mood buckets swap only face layers at any stage", () => {
    for (const stage of STAGES) {
      const app = appearanceWithSeed(777);
      const low = selectPortraitLayers(app, 10, m, stage);
      const high = selectPortraitLayers(app, 90, m, stage);
      const diff = low.filter((l, i) => l.url !== high[i]?.url).map((l) => l.layer);
      expect(diff.every((k) => k.startsWith("face"))).toBe(true);
      expect(diff.length).toBeGreaterThan(0);
    }
  });
});

describe("buildCharacter", () => {
  test("fills seed, stores explicit gender and validated name", () => {
    const c = buildCharacter({ ...BASE_INPUT, gender: "m", name: "  Kael  da Praia " });
    expect(Number.isInteger(c.appearance.seed)).toBe(true);
    expect(c.appearance.gender).toBe("m");
    expect(c.name).toBe("Kael da Praia");
  });

  test("rejects invalid names", () => {
    expect(() => buildCharacter({ ...BASE_INPUT, name: "x" })).toThrow();
    expect(() => buildCharacter({ ...BASE_INPUT, name: "nome_com_underscore" })).toThrow();
  });
});
```

(The old per-profession gender-size cases are superseded by
"adult clothes mapping unchanged by stage" + the exhaustive sweep.)

- [ ] **Step 2: Run to verify failure**

Run: `cd app && bun test portrait-selection`
Expected: FAIL — key mismatches (old un-prefixed keys) and unknown 4th argument.

- [ ] **Step 3: Update the selection engine**

In `app/src/lib/portrait-selection.ts`:

Add the import:

```ts
import type { AgeStage } from "./age-stage";
```

Replace the signature and the `wanted` construction:

```ts
export function selectPortraitLayers(
  appearance: Appearance,
  mood: number,
  manifest: PortraitManifest,
  stage: AgeStage = "y",
): SelectedLayer[] {
```

After the existing draws (unchanged) and `bucket`, compute:

```ts
  // Art stages: faces/necks share child/teen/adult art (adult covers y/m/e);
  // hair has child/adult variants; heads are unique per stage.
  const artStage = stage === "c" ? "c" : stage === "t" ? "t" : "a";
  const hairStage = stage === "c" ? "c" : "a";

  const clothesSize =
    stage === "c" ? "s"
    : stage === "t"
      ? (gender === "m" && (appearance.build === "sturdy" || appearance.build === "robust") ? "l" : "m")
      : CLOTHES_SIZE_BY_GENDER_BUILD[gender][appearance.build];

  const wanted: Record<string, string | null> = {
    neck: stage === "c"
      ? `c-${gender}-child`
      : `${artStage}-${gender}-${NECK_BY_BUILD[appearance.build]}`,
    clothes: `${appearance.clothes}-${clothesSize}`,
    head: `${stage}-${gender}-${headShape}`,
    "face-inner": `${artStage}-${gender}-${bucket}-${faceBucketVariant[bucket]}`,
    "face-outer": `${artStage}-${gender}-${bucket}-${faceBucketVariant[bucket]}`,
    beard: artStage === "a" && gender === "m" && hasBeard ? beardVariant : null,
    hair: `${hairStage}-${hairVariant}`,
  };
```

`hairVariant` comes from the manifest's hair variants which are now prefixed
(`a-afro`, `c-afro`); change its draw to pick from UNPREFIXED names so the
same name maps across stages:

```ts
  const hairNames = [...new Set(
    Object.keys(manifest.layers.hair.variants).map((k) => k.replace(/^[ca]-/, "")),
  )].sort();
  const hairVariant = pick(rand, hairNames);
```

(Keep this draw in the SAME position in the draw order as before — it replaces
the old `pick(rand, Object.keys(manifest.layers.hair.variants))` line.)

- [ ] **Step 4: Verify green**

Run: `cd app && bun test && bunx tsc --noEmit`
Expected: all PASS (including character-row and age-stage suites), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/portrait-selection.ts app/src/lib/portrait-selection.test.ts
git commit -m "Select portrait layers by age stage"
```

---

### Task 4: Death in heartbeat + component/route wiring + DeathView

**Files:**
- Create: `app/supabase/migrations/20260716000000_death_by_age.sql`
- Modify: `app/src/integrations/supabase/types.ts` (heartbeat_tick Returns)
- Modify: `app/src/lib/character.functions.ts` (heartbeat return; add setPlayedSecondsDebug)
- Modify: `app/src/lib/use-heartbeat.ts` (onDeath callback)
- Modify: `app/src/components/CharacterPortrait.tsx` + `app/src/components/portrait/composite.ts` (ageStage prop / preload param)
- Modify: `app/src/routes/game.tsx` (ageStage, DeathView, debug stage setter)
- Modify: `app/src/routes/character-creation.tsx` (reveal shows child portrait)
- Test: `app/src/lib/character-row.test.ts` (extend migration sanity)

- [ ] **Step 1: Extend migration sanity test (failing first)**

Append to the `characters migration` describe block in
`app/src/lib/character-row.test.ts`:

```ts
  test("death-by-age migration folds death into heartbeat_tick", () => {
    const death = readFileSync(
      new URL("../../supabase/migrations/20260716000000_death_by_age.sql", import.meta.url),
      "utf8",
    );
    expect(death).toContain("create or replace function public.heartbeat_tick()");
    expect(death).toContain("returns table (played_seconds int, died boolean)");
    expect(death).toContain("1022400");
    expect(death).toContain("died_at");
  });
```

Run: `cd app && bun test character-row` — expected FAIL (ENOENT).

- [ ] **Step 2: Write the migration**

```sql
-- app/supabase/migrations/20260716000000_death_by_age.sql
-- Death by old age: the same throttled tick marks died_at when total
-- playtime crosses 284h (1022400s). RETURNING evaluates post-update values.
drop function if exists public.heartbeat_tick();

create or replace function public.heartbeat_tick()
returns table (played_seconds int, died boolean)
language sql
security invoker
as $$
  update public.characters
     set played_seconds = characters.played_seconds + 60,
         last_tick_at = now(),
         died_at = case
           when characters.played_seconds + 60 >= 1022400 then now()
           else characters.died_at
         end
   where user_id = auth.uid()
     and died_at is null
     and (last_tick_at is null or last_tick_at <= now() - interval '55 seconds')
  returning characters.played_seconds, (characters.died_at is not null) as died;
$$;
```

Update `types.ts` Functions block:

```ts
    Functions: {
      heartbeat_tick: {
        Args: Record<PropertyKey, never>
        Returns: { played_seconds: number; died: boolean }[]
      }
    }
```

Run: `cd app && bun test character-row` — expected PASS.

- [ ] **Step 3: Server fns**

In `app/src/lib/character.functions.ts`, replace the `heartbeat` handler body's
return with:

```ts
    const row = data?.[0];
    return row ? { playedSeconds: row.played_seconds, dead: row.died } : null;
```

Add after `heartbeat` (DEV tooling to jump between stages):

```ts
export const setPlayedSecondsDebug = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { seconds: number }) => {
    const n = Number(input?.seconds);
    if (!Number.isFinite(n) || n < 0) throw new Error("Segundos inválidos.");
    return { seconds: Math.round(n) };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("characters")
      .update({ played_seconds: data.seconds })
      .is("died_at", null);
    if (error) console.error("[characters] debug playtime failed:", error);
    return { playedSeconds: data.seconds };
  });
```

- [ ] **Step 4: Heartbeat hook onDeath**

Replace `app/src/lib/use-heartbeat.ts` content:

```ts
// Sends a playtime tick every 60s while the tab is visible. Server-side
// throttling makes duplicate/racy ticks harmless; missed ticks are fine.
import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { heartbeat } from "./character.functions";
import { updateActiveCharacter } from "./character-store";

const TICK_MS = 60_000;

export function useHeartbeat(enabled: boolean, onDeath?: () => void): void {
  const tick = useServerFn(heartbeat);
  const onDeathRef = useRef(onDeath);
  onDeathRef.current = onDeath;

  useEffect(() => {
    if (!enabled) return;
    const send = () => {
      if (document.visibilityState !== "visible") return;
      tick()
        .then((result) => {
          if (!result) return;
          updateActiveCharacter({ playedSeconds: result.playedSeconds });
          if (result.dead) onDeathRef.current?.();
        })
        .catch(() => { /* falha de rede: tenta no próximo tick */ });
    };
    const id = setInterval(send, TICK_MS);
    return () => clearInterval(id);
  }, [enabled, tick]);
}
```

- [ ] **Step 5: Portrait component + preload**

`app/src/components/CharacterPortrait.tsx`:
- add `import type { AgeStage } from "@/lib/age-stage";`
- add prop `ageStage?: AgeStage` (default `"y"`) to the interface and destructuring;
- pass it: `selectPortraitLayers(appearance, mood, manifest, ageStage)`;
- add `ageStage` to the effect dependency array.

`app/src/components/portrait/composite.ts` — `preloadPortrait` gains the stage:

```ts
export function preloadPortrait(appearance: Appearance, stage: AgeStage = "y"): void {
  if (typeof window === "undefined" || typeof appearance.seed !== "number") return;
  loadManifest()
    .then((manifest) => {
      for (const mood of [10, 50, 90]) {
        for (const layer of selectPortraitLayers(appearance, mood, manifest, stage)) {
          loadImage(layer.url).catch(() => {});
        }
      }
    })
    .catch(() => {});
}
```

(import `AgeStage` type there too.)

- [ ] **Step 6: Routes**

`app/src/routes/character-creation.tsx` — the character is born a child:
- `preloadPortrait((c as PersistedCharacter).appearance, "c")` in submit;
- in `RevealView`'s `CharacterPortrait`, add `ageStage="c"`.

`app/src/routes/game.tsx`:
- imports: `ageStage`, `stageLabel`, `isDeadByAge` from `@/lib/age-stage`;
  `clearActiveCharacter` from `@/lib/character-store`; `setPlayedSecondsDebug`
  from `@/lib/character.functions`;
- state: `const [dead, setDead] = useState(false);`
- after character load resolves, `if (fresh && isDeadByAge(fresh.playedSeconds)) setDead(true);`
  (defensive: `getActiveCharacter` only returns alive rows, but a stale cache
  might not reflect a death that happened at the very last tick of a previous session);
- heartbeat: `useHeartbeat(character !== null && !dead, () => setDead(true));`
- stage for the HUD portrait:

```tsx
const stage = character ? ageStage(character.playedSeconds) : "y";
// ...
<CharacterPortrait appearance={character.appearance} mood={character.mood}
  size={96} ageStage={stage} label={`Retrato de ${character.name ?? "personagem"}`} />
```

- HUD session card gains one line under the character name:

```tsx
{character && (
  <div><span className="text-muted-foreground">Idade:</span> {stageLabel(stage)}</div>
)}
```

- DEV debug card gains stage jump buttons (below the mood slider):

```tsx
{DEV && character && (
  <div className="flex flex-wrap gap-1 pt-1">
    {([["c", 0], ["t", 8 * 3600], ["y", 24 * 3600], ["m", 84 * 3600], ["e", 234 * 3600], ["morte", 284 * 3600 - 60]] as const).map(([label, secs]) => (
      <button key={label} className="rounded border px-1 text-[10px] hover:bg-primary/10"
        onClick={() => handleStageJump(secs)}>{label}</button>
    ))}
  </div>
)}
```

with the handler (inside `GamePage`, next to `handleMoodChange`):

```tsx
const setPlayedFn = useServerFn(setPlayedSecondsDebug);
const handleStageJump = async (seconds: number) => {
  try {
    const { playedSeconds } = await setPlayedFn({ data: { seconds } });
    const next = updateActiveCharacter({ playedSeconds });
    if (next) setCharacter(next);
  } catch { /* debug only */ }
};
```

- DeathView rendered INSTEAD of the HUD overlays when `dead` (keep PhaserGame
  behind or not — replace the whole return content):

```tsx
if (dead && character) {
  const hours = Math.floor(character.playedSeconds / 3600);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="max-w-md p-8 text-center space-y-4">
        <p className="text-sm uppercase tracking-widest text-primary">O tempo venceu</p>
        <h1 className="font-display text-3xl font-bold">{character.name}</h1>
        <p className="text-sm text-muted-foreground">
          Viveu {hours} horas em Hopeland, de criança a idoso. Sua história termina aqui —
          mas outra pode começar.
        </p>
        <Button size="lg" onClick={() => { clearActiveCharacter(); navigate({ to: "/character-creation" }); }}>
          Criar novo personagem
        </Button>
      </Card>
    </div>
  );
}
```

Place this `if` right before the main `return` of `GamePage`.

- [ ] **Step 7: Verify**

Run: `cd app && bun test && bunx tsc --noEmit && bun run build`
Expected: all green/clean.

- [ ] **Step 8: Commit**

```bash
git add app/supabase app/src
git commit -m "Age portraits by playtime and die of old age at 284h"
```

---

### Task 5: Verification + migration gate + PR

- [ ] **Step 1: Full battery**

Run: `cd app && bun test && bunx tsc --noEmit && bun run build`
Expected: pass (lint skipped — known repo-wide CRLF noise).

- [ ] **Step 2: Visual verification (controller)**

Compose with the sharp harness pattern (real `selectPortraitLayers` + manifest,
stages c/t/y/m/e, same seed) and view: identity must persist (same hair/face
slot), child must be child-proportioned with `s` clothes and no beard.

- [ ] **Step 3: Push + report gates**

```bash
git push -u origin feat/character-aging
```

Report: (1) migration `20260716000000_death_by_age.sql` must be applied to
Supabase before merge (replaces `heartbeat_tick`); (2) PR link
`https://github.com/Enzo-Azevedo/Hopeland/pull/new/feat/character-aging`;
(3) manual e2e: create character (reveal shows child), stage-jump buttons in
DEV HUD walk through ages, "morte" preset + next heartbeat (~60s) shows the
death screen, and creating a new character works afterwards.
