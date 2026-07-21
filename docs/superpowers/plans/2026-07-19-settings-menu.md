# Settings Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In-game ⚙ menu (Gráficos / Jogabilidade) with localStorage persistence and live effect: always-animate, baked elevation numbers, and flow-direction arrows.

**Architecture:** A pure `settings.ts` module (typed settings, injectable storage, merge-over-defaults load, mini pub/sub) is the single source of truth; React (`game.tsx` + a minimal shadcn-style `Switch`) writes it, the Phaser scene subscribes and reacts: the sleep block short-circuits under `alwaysAnimate`, `showElevation` re-bakes the chunk ring through the normal streaming path, and `showFlowArrows` drives a pooled arrow overlay fed by the **cached** `flowAt` channel + the frame's `windNow` (never per-arrow `currentFor` — that would recreate the INP spike PR #39 fixed).

**Tech Stack:** TypeScript, React 19 + Tailwind (existing shadcn pattern), Phaser 4.2 (Container/Image pool, `rt.draw` of a reusable Text), bun tests.

**Spec:** `docs/superpowers/specs/2026-07-19-settings-menu-design.md`

## Global Constraints

- Branch `feat/settings-menu`. Never commit to `main`. No `Co-Authored-By`. English imperative commits; UI copy in PT-BR.
- Commands in `app/` with bun; single-argument `expect`; `set -o pipefail` before piped `bun test` in gates.
- Exact values (spec): storage key `hopeland-settings-v1`; defaults all `false`; arrow texture key `flow-arrow` (~12px); arrows depth **600_000**; arrow refresh cadence **400ms** or camera tile crossing; elevation text mono **10px** white, stroke black, drawn only on LAND tiles (level ≥ 1), before `rt.render()`; ring re-bake on `showElevation` toggle goes through the NORMAL budgeted path (destroy all chunks, let `update()` recreate 1/frame — no forced full-ring bake in one frame).
- **Performance guard:** arrows MUST use `flowAt` (permanent cache, already warmed by the flow-refinement queue) + `windNow` composed in the scene with influence deep 1.0 / coast 0.5 / river 0.1 — never `currentFor` per arrow per refresh.
- Any settings change resets `cleanFrames` (counts as dirty).
- Frozen: gameplay mechanics, shaders, bake stamps from visual v3, flow-refinement queue.

---

### Task 1: `settings.ts` (pure module)

**Files:**
- Create: `app/src/lib/settings.ts`
- Test: `app/src/lib/settings.test.ts`

**Interfaces:**
- Produces:
  - `interface GameSettings { alwaysAnimate: boolean; showElevation: boolean; showFlowArrows: boolean }`
  - `DEFAULT_SETTINGS: GameSettings` (all false)
  - `loadSettings(storage?): GameSettings` — merge over defaults, corrupt-safe
  - `getSettings(): GameSettings` — snapshot (copy)
  - `saveSettings(patch: Partial<GameSettings>, storage?): GameSettings` — persists + notifies
  - `subscribe(fn: (s: GameSettings) => void): () => void`
  - `resetSettingsForTests(): void`

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/settings.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_SETTINGS, getSettings, loadSettings, resetSettingsForTests,
  saveSettings, subscribe,
} from "./settings";

function fakeStorage(initial?: Record<string, string>) {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    dump: () => Object.fromEntries(map),
  };
}

beforeEach(() => resetSettingsForTests());

describe("settings", () => {
  test("defaults when storage is empty or corrupted", () => {
    expect(loadSettings(fakeStorage())).toEqual(DEFAULT_SETTINGS);
    resetSettingsForTests();
    expect(
      loadSettings(fakeStorage({ "hopeland-settings-v1": "{not json" })),
    ).toEqual(DEFAULT_SETTINGS);
  });

  test("merges partial/unknown keys over defaults", () => {
    const s = loadSettings(
      fakeStorage({
        "hopeland-settings-v1": JSON.stringify({ showElevation: true, legacy: 1 }),
      }),
    );
    expect(s).toEqual({ ...DEFAULT_SETTINGS, showElevation: true });
  });

  test("saveSettings persists round-trip and notifies subscribers", () => {
    const storage = fakeStorage();
    loadSettings(storage);
    const seen: boolean[] = [];
    const off = subscribe((s) => seen.push(s.alwaysAnimate));
    saveSettings({ alwaysAnimate: true }, storage);
    expect(seen).toEqual([true]);
    expect(JSON.parse(storage.dump()["hopeland-settings-v1"]!)).toEqual({
      ...DEFAULT_SETTINGS,
      alwaysAnimate: true,
    });
    off();
    saveSettings({ alwaysAnimate: false }, storage);
    expect(seen).toEqual([true]); // unsubscribed
  });

  test("getSettings returns isolated snapshots", () => {
    loadSettings(fakeStorage());
    const a = getSettings();
    a.showFlowArrows = true;
    expect(getSettings().showFlowArrows).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd app && bun test src/lib/settings.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// app/src/lib/settings.ts
// Configurações do jogador: fonte única da verdade, persistidas em
// localStorage e propagadas ao vivo (React escreve, a cena Phaser assina).
// Storage injetável para testes; seguro em SSR.

export interface GameSettings {
  alwaysAnimate: boolean;
  showElevation: boolean;
  showFlowArrows: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  alwaysAnimate: false,
  showElevation: false,
  showFlowArrows: false,
};

const KEY = "hopeland-settings-v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

let current: GameSettings | null = null;
const listeners = new Set<(s: GameSettings) => void>();

function defaultStorage(): StorageLike | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function loadSettings(storage: StorageLike | null = defaultStorage()): GameSettings {
  let parsed: unknown = null;
  try {
    const raw = storage?.getItem(KEY);
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  const merged = { ...DEFAULT_SETTINGS };
  if (parsed && typeof parsed === "object") {
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof GameSettings)[]) {
      const v = (parsed as Record<string, unknown>)[k];
      if (typeof v === "boolean") merged[k] = v;
    }
  }
  current = merged;
  return { ...merged };
}

export function getSettings(): GameSettings {
  return { ...(current ?? loadSettings()) };
}

export function saveSettings(
  patch: Partial<GameSettings>,
  storage: StorageLike | null = defaultStorage(),
): GameSettings {
  const next = { ...getSettings(), ...patch };
  current = next;
  try {
    storage?.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage indisponível/cheio: segue valendo em memória
  }
  for (const fn of listeners) fn({ ...next });
  return { ...next };
}

export function subscribe(fn: (s: GameSettings) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function resetSettingsForTests(): void {
  current = null;
  listeners.clear();
}
```

- [ ] **Step 4: Run tests** — PASS. **Step 5:** `bunx tsc --noEmit`; commit:

```bash
git add app/src/lib/settings.ts app/src/lib/settings.test.ts
git commit -m "Add persisted game settings with live subscription"
```

---

### Task 2: Switch component + ⚙ menu in `game.tsx`

**Files:**
- Create: `app/src/components/ui/switch.tsx`
- Modify: `app/src/routes/game.tsx` (top-right controls area)

**Interfaces:**
- Consumes: Task 1's `getSettings`, `saveSettings`, `subscribe`, `GameSettings`.
- Produces: `<Switch checked onCheckedChange id? aria-label? />`.

No unit test (UI) — gate tsc/test/build + browser.

- [ ] **Step 1: `ui/switch.tsx`**

First check whether `@/lib/utils` with `cn` exists (`ls app/src/lib/utils.ts` / grep the button component's import). If it exists, use it; the code below assumes it does (the existing `button.tsx` will confirm the exact import path — mirror it).

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
}

export function Switch({ checked, onCheckedChange, className, ...props }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 rounded-full bg-background shadow transition-transform",
          checked ? "translate-x-4" : "translate-x-1",
        )}
      />
    </button>
  );
}
```

- [ ] **Step 2: Menu in `game.tsx`**

Imports:

```tsx
import { Switch } from "@/components/ui/switch";
import { getSettings, saveSettings, subscribe, type GameSettings } from "@/lib/settings";
```

State + subscription inside `GamePage` (next to the other `useState`s):

```tsx
  const [settings, setSettings] = useState<GameSettings>(() => getSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => subscribe(setSettings), []);
```

Replace the existing top-right `Sair` div with:

```tsx
      <div className="absolute top-4 right-4 flex flex-col items-end gap-2">
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            aria-label="Configurações"
            onClick={() => setSettingsOpen((v) => !v)}
          >
            ⚙
          </Button>
          <Button size="sm" variant="secondary" onClick={handleSignOut}>Sair</Button>
        </div>
        {settingsOpen && (
          <Card className="w-64 p-4 space-y-3 bg-background/90 backdrop-blur text-sm">
            <div>
              <p className="mb-2 font-medium text-muted-foreground uppercase text-[11px] tracking-wider">Gráficos</p>
              <label className="flex items-center justify-between gap-3">
                <span>Tiles sempre animados</span>
                <Switch
                  checked={settings.alwaysAnimate}
                  onCheckedChange={(v) => saveSettings({ alwaysAnimate: v })}
                  aria-label="Tiles sempre animados"
                />
              </label>
            </div>
            <div>
              <p className="mb-2 font-medium text-muted-foreground uppercase text-[11px] tracking-wider">Jogabilidade</p>
              <div className="space-y-2">
                <label className="flex items-center justify-between gap-3">
                  <span>Números de elevação</span>
                  <Switch
                    checked={settings.showElevation}
                    onCheckedChange={(v) => saveSettings({ showElevation: v })}
                    aria-label="Números de elevação"
                  />
                </label>
                <label className="flex items-center justify-between gap-3">
                  <span>Setas de fluxo</span>
                  <Switch
                    checked={settings.showFlowArrows}
                    onCheckedChange={(v) => saveSettings({ showFlowArrows: v })}
                    aria-label="Setas de fluxo"
                  />
                </label>
              </div>
            </div>
          </Card>
        )}
      </div>
```

- [ ] **Step 3: Gate + commit**

```bash
cd app && bunx tsc --noEmit && (set -o pipefail; bun test 2>&1 | tail -2) && bun run build
git add app/src/components/ui/switch.tsx app/src/routes/game.tsx
git commit -m "Add settings gear menu with graphics and gameplay toggles"
```

---

### Task 3: Scene reactions (always-animate, elevation bake, arrow pool)

**Files:**
- Modify: `app/src/components/PhaserGame.tsx`

**Interfaces:**
- Consumes: Task 1's module; existing scene internals (`chunks`, `flowQueue`, `cleanFrames`, `sleepAfterSettle`, `windNow`, bake loop, `rt.render()`); `flowAt` + `MAX_CURRENT`.
- Produces: new fields `settings`, `unsubscribeSettings`, `flowArrows`, `arrowPool`, `elevText`, `lastArrowRefresh`, `lastArrowCamKey`; methods `rebakeAllChunks()`, `refreshFlowArrows()`, `hideFlowArrows()`.

No unit test (scene) — gate tsc/test/build; behavior verified by owner.

- [ ] **Step 1: Fields, imports, subscription**

Imports: `import { getSettings, subscribe as subscribeSettings } from "@/lib/settings";` and add `flowAt` to the existing flow-field import if absent.

Fields:

```ts
  private settings = getSettings();
  private unsubscribeSettings?: () => void;
  private flowArrows?: Phaser.GameObjects.Container;
  private arrowPool: Phaser.GameObjects.Image[] = [];
  private elevText?: Phaser.GameObjects.Text;
  private lastArrowRefresh = 0;
  private lastArrowCamKey = "";
```

In `create()` (after the wake-listeners block):

```ts
    // Textura da seta de fluxo (runtime, 12px, aponta +x).
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.fillTriangle(12, 6, 2, 1, 2, 11);
    g.generateTexture("flow-arrow", 12, 12);
    g.destroy();

    // Configurações ao vivo: React escreve, a cena reage.
    this.unsubscribeSettings = subscribeSettings((next) => {
      const prev = this.settings;
      this.settings = next;
      if (next.alwaysAnimate && !this.game.loop.running) this.game.loop.wake();
      if (prev.showElevation !== next.showElevation) this.rebakeAllChunks();
      if (!next.showFlowArrows) this.hideFlowArrows();
      this.cleanFrames = 0;
      this.sleepAfterSettle = false;
      if (!this.game.loop.running) this.game.loop.wake();
    });
    this.events.once(Phaser.Scenes.Events.DESTROY, () => {
      this.unsubscribeSettings?.();
    });
```

- [ ] **Step 2: Elevation numbers in the bake**

In `createChunk`, right AFTER the relief-overlay block (light line/AO) and still inside the land branch of the tile loop, add:

```ts
        if (this.settings.showElevation) {
          if (!this.elevText) {
            this.elevText = this.make.text({
              add: false,
              style: {
                fontFamily: "monospace",
                fontSize: "10px",
                color: "#ffffff",
                stroke: "#000000",
                strokeThickness: 2,
              },
            });
          }
          this.elevText.setText(String(level));
          rt.draw(this.elevText, localX + 3, topY + 3);
        }
```

And the re-bake helper (next to `updateChunks`):

```ts
  /** Destrói o anel; o caminho normal de streaming re-assa 1 chunk/frame. */
  private rebakeAllChunks() {
    for (const [key, chunk] of this.chunks) {
      chunk.rt.destroy();
      this.chunks.delete(key);
    }
    this.flowQueue.length = 0;
  }
```

- [ ] **Step 3: Arrow pool**

Methods:

```ts
  private hideFlowArrows() {
    for (const a of this.arrowPool) a.setVisible(false);
  }

  /**
   * Setas do fluxo REAL sobre a água visível. Usa flowAt (cache permanente,
   * já aquecido pela fila de refinamento) + windNow composto aqui — nunca
   * currentFor por seta (isso recriaria o custo de INP corrigido no #39).
   */
  private refreshFlowArrows() {
    if (!this.flowArrows) {
      this.flowArrows = this.add.container(0, 0).setDepth(600_000);
    }
    const cam = this.cameras.main;
    const x0 = Math.floor(cam.scrollX / TILE_SIZE) - 1;
    const y0 = Math.floor(cam.scrollY / TILE_SIZE) - 1;
    const x1 = Math.ceil((cam.scrollX + cam.width) / TILE_SIZE) + 1;
    const y1 = Math.ceil((cam.scrollY + cam.height) / TILE_SIZE) + 1;
    let used = 0;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const s = flowAt(WORLD_SEED, tx, ty);
        if (s.kind === 0) continue;
        const infl = s.kind === 1 ? 1 : s.kind === 2 ? 0.5 : 0.1;
        const vx = s.vx + this.windNow.vx * infl;
        const vy = s.vy + this.windNow.vy * infl;
        const mag = Math.hypot(vx, vy);
        if (mag < 1e-4) continue;
        let img = this.arrowPool[used];
        if (!img) {
          img = this.add.image(0, 0, "flow-arrow");
          this.flowArrows.add(img);
          this.arrowPool.push(img);
        }
        img
          .setVisible(true)
          .setPosition(tx * TILE_SIZE + TILE_SIZE / 2, ty * TILE_SIZE + TILE_SIZE / 2)
          .setRotation(Math.atan2(vy, vx))
          .setAlpha(0.25 + 0.6 * Math.min(1, mag / MAX_CURRENT));
        used++;
      }
    }
    for (let i = used; i < this.arrowPool.length; i++) {
      this.arrowPool[i]!.setVisible(false);
    }
  }
```

In `update()`, after the chunk/flow-queue section:

```ts
    // Setas de fluxo: recarrega a cada 400ms ou ao cruzar tile de câmera.
    let arrowsDirty = false;
    if (this.settings.showFlowArrows) {
      const camKey = `${Math.floor(this.cameras.main.scrollX / TILE_SIZE)},${Math.floor(this.cameras.main.scrollY / TILE_SIZE)}`;
      const now = performance.now();
      if (now - this.lastArrowRefresh > 400 || camKey !== this.lastArrowCamKey) {
        this.lastArrowRefresh = now;
        this.lastArrowCamKey = camKey;
        this.refreshFlowArrows();
        arrowsDirty = true;
      }
    }
```

- [ ] **Step 4: Sleep-block guard**

Replace the start of the dirty-tracking block so `alwaysAnimate` short-circuits and `arrowsDirty` counts:

```ts
    const levelSettling = this.renderLevel !== targetLevel;
    if (this.settings.alwaysAnimate) {
      this.cleanFrames = 0;
      this.sleepAfterSettle = false;
    } else if (dx !== 0 || dy !== 0 || chunksChanged || levelSettling || inWater || flowDirty || arrowsDirty) {
      ...
```

(Keep the rest of the existing chain untouched; `flowDirty` already exists from the flow queue.)

- [ ] **Step 5: Gate + commit**

```bash
cd app && bunx tsc --noEmit && (set -o pipefail; bun test 2>&1 | tail -2) && bun run build
git add app/src/components/PhaserGame.tsx
git commit -m "React to settings in the scene: animate, elevation, arrows"
```

---

### Task 4: Final gate, review and PR

- [ ] **Step 1: Full gate** — `cd app && bunx tsc --noEmit && (set -o pipefail; bun test 2>&1 | tail -3) && bun run build`.
- [ ] **Step 2: Dev smoke** — `/game` 200; menu markup present in SSR output is NOT expected (client-only interactions); state what needs the owner.
- [ ] **Step 3: Final whole-branch review** (most capable model): settings module hygiene, React re-render behavior, scene subscription lifecycle (double-wake, unsubscribe on destroy), arrow pool growth bounds, elevation text draw cost, sleep guard correctness.
- [ ] **Step 4: Push + PR** — English body; owner checklist (persistência após F5; água contínua com sempre-animados; números após re-bake progressivo; setas seguindo rio/vento; economia intacta com tudo OFF). Standard footer.
