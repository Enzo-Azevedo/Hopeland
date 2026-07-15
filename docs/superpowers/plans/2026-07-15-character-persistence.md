# Character Persistence Implementation Plan (Spec A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist characters in Supabase (one alive per user) and accumulate active playtime via a server-throttled heartbeat.

**Architecture:** A versioned SQL migration creates `public.characters` (RLS, unique-alive index, `heartbeat_tick()` RPC). Server functions use the existing `requireSupabaseAuth` middleware context (`context.supabase` = RLS-scoped client, `context.userId`). A pure serialization module maps `Character` ⇄ DB row. Routes load from the DB; sessionStorage becomes a cache.

**Tech Stack:** Supabase (Postgres/RLS/RPC), TanStack Start server functions, bun test.

**Spec:** `docs/superpowers/specs/2026-07-15-character-persistence-design.md`

## Global Constraints

- Branch `feat/character-persistence`. Commits: short English subject, NO Co-Authored-By trailer.
- User-facing copy PT-BR (e.g. "Você já tem um personagem vivo.").
- Writes go only through server functions; the browser client never touches `characters` directly.
- Heartbeat: fixed +60s increment, server-side throttle `last_tick_at <= now() - interval '55 seconds'`, single UPDATE (atomic via RPC).
- Supabase project is `tekvkpxneckdxhtkcfeo` (production); `app/supabase/config.toml` currently points to a stale Lovable-era id and must be fixed.
- The DB migration cannot be applied by the executor (no credentials): tasks verify code/tests only; end-to-end verification happens after the owner applies the migration (Task 5 gate).

---

### Task 1: Migration SQL + config fix + Database types

**Files:**
- Create: `app/supabase/migrations/20260715000000_characters.sql`
- Modify: `app/supabase/config.toml` (project_id)
- Modify: `app/src/integrations/supabase/types.ts` (Tables + Functions blocks)
- Test: `app/src/lib/character-row.test.ts` (migration sanity block only; the rest arrives in Task 2)

**Interfaces:**
- Produces: table `public.characters` with columns `id, user_id, name, gender, choices, skills, tags, passives, appearance, mood, played_seconds, last_tick_at, created_at, died_at`; RPC `heartbeat_tick() returns table (played_seconds int)`; TypeScript types `Database["public"]["Tables"]["characters"]` (Row/Insert/Update) and `Database["public"]["Functions"]["heartbeat_tick"]`.

- [ ] **Step 1: Write the failing migration-sanity test**

```ts
// app/src/lib/character-row.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("characters migration", () => {
  const sql = readFileSync(
    new URL("../../supabase/migrations/20260715000000_characters.sql", import.meta.url),
    "utf8",
  );

  test("contains the required structural clauses", () => {
    expect(sql).toContain("create table public.characters");
    expect(sql).toContain("characters_one_alive_per_user");
    expect(sql).toContain("where died_at is null");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("auth.uid() = user_id");
    expect(sql).toContain("create or replace function public.heartbeat_tick()");
    expect(sql).toContain("interval '55 seconds'");
    expect(sql).toContain("played_seconds + 60");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && bun test character-row`
Expected: FAIL — migration file not found (ENOENT).

- [ ] **Step 3: Write the migration**

```sql
-- app/supabase/migrations/20260715000000_characters.sql
-- Characters: one alive row per user; dead rows are archived, never deleted.

create table public.characters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  gender text not null check (gender in ('f','m')),
  choices jsonb not null,
  skills jsonb not null,
  tags jsonb not null default '[]',
  passives jsonb not null default '[]',
  appearance jsonb not null,
  mood int not null default 50 check (mood between 0 and 100),
  played_seconds int not null default 0 check (played_seconds >= 0),
  last_tick_at timestamptz,
  created_at timestamptz not null default now(),
  died_at timestamptz
);

create unique index characters_one_alive_per_user
  on public.characters (user_id) where died_at is null;

alter table public.characters enable row level security;

create policy "own rows" on public.characters
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Server-throttled playtime tick: +60s at most every 55s, atomically.
-- security invoker: runs under the caller's RLS.
create or replace function public.heartbeat_tick()
returns table (played_seconds int)
language sql
security invoker
as $$
  update public.characters
     set played_seconds = characters.played_seconds + 60,
         last_tick_at = now()
   where user_id = auth.uid()
     and died_at is null
     and (last_tick_at is null or last_tick_at <= now() - interval '55 seconds')
  returning characters.played_seconds;
$$;
```

- [ ] **Step 4: Fix config.toml**

Replace the content of `app/supabase/config.toml` with:

```toml
project_id = "tekvkpxneckdxhtkcfeo"
```

- [ ] **Step 5: Add Database types**

In `app/src/integrations/supabase/types.ts`, replace the empty `Tables` block

```ts
    Tables: {
      [_ in never]: never
    }
```

with:

```ts
    Tables: {
      characters: {
        Row: {
          id: string
          user_id: string
          name: string
          gender: string
          choices: Json
          skills: Json
          tags: Json
          passives: Json
          appearance: Json
          mood: number
          played_seconds: number
          last_tick_at: string | null
          created_at: string
          died_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          gender: string
          choices: Json
          skills: Json
          tags?: Json
          passives?: Json
          appearance: Json
          mood?: number
          played_seconds?: number
          last_tick_at?: string | null
          created_at?: string
          died_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          gender?: string
          choices?: Json
          skills?: Json
          tags?: Json
          passives?: Json
          appearance?: Json
          mood?: number
          played_seconds?: number
          last_tick_at?: string | null
          created_at?: string
          died_at?: string | null
        }
        Relationships: []
      }
    }
```

and replace the empty `Functions` block (find `Functions: {` with `[_ in never]: never` inside — read the file first to match exactly) with:

```ts
    Functions: {
      heartbeat_tick: {
        Args: Record<PropertyKey, never>
        Returns: { played_seconds: number }[]
      }
    }
```

- [ ] **Step 6: Run test + typecheck**

Run: `cd app && bun test character-row && bunx tsc --noEmit`
Expected: test PASS; tsc clean.

- [ ] **Step 7: Commit**

```bash
git add app/supabase app/src/integrations/supabase/types.ts app/src/lib/character-row.test.ts
git commit -m "Add characters table migration, RPC and DB types"
```

---

### Task 2: Character ⇄ row serialization

**Files:**
- Create: `app/src/lib/character-row.ts`
- Test: `app/src/lib/character-row.test.ts` (extend Task 1's file)

**Interfaces:**
- Consumes: `Character`, `buildCharacter` from `@/lib/character-schema`; `Database` types from Task 1.
- Produces (Tasks 3-4 rely on these exact names):

```ts
export type CharacterRow = Database["public"]["Tables"]["characters"]["Row"];
export interface PersistedCharacter extends Character {
  id: string;
  playedSeconds: number;
  diedAt: string | null;
}
export function characterToInsertRow(c: Character, userId: string):
  Database["public"]["Tables"]["characters"]["Insert"];
export function rowToCharacter(row: CharacterRow): PersistedCharacter;
```

- [ ] **Step 1: Write the failing tests (append to character-row.test.ts)**

```ts
import { buildCharacter } from "./character-schema";
import { characterToInsertRow, rowToCharacter, type CharacterRow } from "./character-row";

describe("character row serialization", () => {
  const character = buildCharacter({
    category: "fisica", profession: "ferreiro", origin: "praia",
    name: "Teste", gender: "m",
  });

  test("insert row carries all character fields", () => {
    const row = characterToInsertRow(character, "user-123");
    expect(row.user_id).toBe("user-123");
    expect(row.name).toBe("Teste");
    expect(row.gender).toBe("m");
    expect(row.choices).toEqual(character.choices);
    expect(row.skills).toEqual(character.skills);
    expect(row.appearance).toEqual(character.appearance);
    expect(row.mood).toBe(50);
  });

  test("round-trip: rowToCharacter(insert + db defaults) === original + persistence fields", () => {
    const insert = characterToInsertRow(character, "user-123");
    const dbRow: CharacterRow = {
      ...insert,
      id: "row-1",
      tags: insert.tags ?? [],
      passives: insert.passives ?? [],
      mood: insert.mood ?? 50,
      played_seconds: 0,
      last_tick_at: null,
      created_at: "2026-07-15T00:00:00Z",
      died_at: null,
    } as CharacterRow;
    const back = rowToCharacter(dbRow);
    expect(back.id).toBe("row-1");
    expect(back.playedSeconds).toBe(0);
    expect(back.diedAt).toBeNull();
    expect(back.name).toBe(character.name);
    expect(back.appearance).toEqual(character.appearance);
    expect(back.skills).toEqual(character.skills);
    expect(back.tags).toEqual(character.tags);
    expect(back.passives).toEqual(character.passives);
    expect(back.choices).toEqual(character.choices);
    expect(back.mood).toBe(character.mood);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && bun test character-row`
Expected: FAIL — `Cannot find module './character-row'`.

- [ ] **Step 3: Implement**

```ts
// app/src/lib/character-row.ts
// Pure mapping between the Character domain object and the characters
// table row. Keep field lists in sync with the migration.
import type { Database } from "@/integrations/supabase/types";
import type { Appearance, Character } from "./character-schema";

export type CharacterRow = Database["public"]["Tables"]["characters"]["Row"];
type CharacterInsert = Database["public"]["Tables"]["characters"]["Insert"];

export interface PersistedCharacter extends Character {
  id: string;
  playedSeconds: number;
  diedAt: string | null;
}

export function characterToInsertRow(c: Character, userId: string): CharacterInsert {
  return {
    user_id: userId,
    name: c.name ?? "",
    gender: c.appearance.gender ?? "f",
    choices: c.choices,
    skills: c.skills,
    tags: c.tags,
    passives: c.passives,
    appearance: c.appearance as unknown as CharacterInsert["appearance"],
    mood: c.mood,
  };
}

export function rowToCharacter(row: CharacterRow): PersistedCharacter {
  return {
    id: row.id,
    playedSeconds: row.played_seconds,
    diedAt: row.died_at,
    name: row.name,
    skills: row.skills as Character["skills"],
    tags: row.tags as string[],
    passives: row.passives as Character["passives"],
    choices: row.choices as Character["choices"],
    appearance: row.appearance as unknown as Appearance,
    mood: row.mood,
  };
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd app && bun test character-row && bunx tsc --noEmit`
Expected: all PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/character-row.ts app/src/lib/character-row.test.ts
git commit -m "Add character row serialization"
```

---

### Task 3: Server functions (insert, load, heartbeat)

**Files:**
- Modify: `app/src/lib/character.functions.ts` (whole file below)

**Interfaces:**
- Consumes: `requireSupabaseAuth` middleware (provides `context.supabase` RLS client and `context.userId`), Task 2's serialization.
- Produces (Task 4 relies on): `createCharacter` (same input as today) → `PersistedCharacter`; `getActiveCharacter()` → `PersistedCharacter | null`; `heartbeat()` → `{ playedSeconds: number } | null` (null = throttled or no alive character); `setCharacterMoodDebug({ mood })` → `{ mood: number }` (now persists).

- [ ] **Step 1: Replace character.functions.ts**

```ts
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildCharacter,
  validateCharacterName,
  type Category,
  type Profession,
  type Origin,
} from "./character-schema";
import { characterToInsertRow, rowToCharacter } from "./character-row";

const CATEGORIES: Category[] = ["fisica", "intelectual", "agil", "social"];
const PROFESSIONS: Profession[] = [
  "ferreiro", "lenhador", "estivador",
  "bibliotecario", "contador", "alquimista",
  "pescador", "mensageiro", "equilibrista",
  "comerciante", "menestrel", "taberneiro",
];
const ORIGINS: Origin[] = ["praia", "montanha", "deserto", "floresta", "cavernas", "mar", "cidade"];

const UNIQUE_VIOLATION = "23505";

export const createCharacter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    category: Category; profession: Profession; origin: Origin;
    name: string; gender: "f" | "m";
  }) => {
    if (!CATEGORIES.includes(input.category)) throw new Error("Categoria inválida.");
    if (!PROFESSIONS.includes(input.profession)) throw new Error("Profissão inválida.");
    if (!ORIGINS.includes(input.origin)) throw new Error("Origem inválida.");
    if (input.gender !== "f" && input.gender !== "m") throw new Error("Gênero inválido.");
    return { ...input, name: validateCharacterName(input.name) };
  })
  .handler(async ({ data, context }) => {
    const character = buildCharacter(data);
    const { data: row, error } = await context.supabase
      .from("characters")
      .insert(characterToInsertRow(character, context.userId))
      .select()
      .single();
    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        throw new Error("Você já tem um personagem vivo.");
      }
      console.error("[characters] insert failed:", error);
      throw new Error("Falha ao salvar o personagem. Tente novamente.");
    }
    return rowToCharacter(row);
  });

export const getActiveCharacter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: row, error } = await context.supabase
      .from("characters")
      .select()
      .is("died_at", null)
      .maybeSingle();
    if (error) {
      console.error("[characters] load failed:", error);
      throw new Error("Falha ao carregar o personagem.");
    }
    return row ? rowToCharacter(row) : null;
  });

export const heartbeat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("heartbeat_tick");
    if (error) {
      console.error("[characters] heartbeat failed:", error);
      throw new Error("heartbeat failed");
    }
    const row = data?.[0];
    return row ? { playedSeconds: row.played_seconds } : null;
  });

export const setCharacterMoodDebug = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { mood: number }) => {
    const n = Number(input?.mood);
    if (!Number.isFinite(n)) throw new Error("Mood inválido.");
    return { mood: Math.max(0, Math.min(100, Math.round(n))) };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("characters")
      .update({ mood: data.mood })
      .is("died_at", null);
    if (error) console.error("[characters] mood update failed:", error);
    return { mood: data.mood };
  });
```

Note: if `context.supabase`/`context.userId` are not typed on the handler
context, check how `requireSupabaseAuth` declares them (`next({ context: ... })`)
— TanStack infers middleware context; if inference fails, report as a concern
rather than casting to `any`.

- [ ] **Step 2: Typecheck + full tests**

Run: `cd app && bunx tsc --noEmit && bun test`
Expected: clean; all existing tests still pass (none import the removed behavior).

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/character.functions.ts
git commit -m "Persist characters through server functions"
```

---

### Task 4: Client flows (load from DB, heartbeat loop)

**Files:**
- Modify: `app/src/lib/character-store.ts` (store `PersistedCharacter`)
- Create: `app/src/lib/use-heartbeat.ts`
- Modify: `app/src/routes/character-creation.tsx` (redirect if alive exists; store persisted result)
- Modify: `app/src/routes/game.tsx` (DB load + heartbeat)

**Interfaces:**
- Consumes: Task 3 server fns; Task 2 `PersistedCharacter`.
- Produces: `useHeartbeat(enabled: boolean): void` (60s interval, paused when tab hidden).

- [ ] **Step 1: Retype the store**

In `app/src/lib/character-store.ts`, change the import and all `Character` type
references to `PersistedCharacter`:

```ts
import type { PersistedCharacter } from "./character-row";
```

(4 occurrences: `saveActiveCharacter(c: PersistedCharacter)`,
`loadActiveCharacter(): PersistedCharacter | null`,
`updateActiveCharacter(patch: Partial<PersistedCharacter>): PersistedCharacter | null`,
and the JSON.parse cast.) Keep the sessionStorage mechanics — it is now a cache,
the DB is the source of truth.

- [ ] **Step 2: Write the heartbeat hook**

```ts
// app/src/lib/use-heartbeat.ts
// Sends a playtime tick every 60s while the tab is visible. Server-side
// throttling makes duplicate/racy ticks harmless; missed ticks are fine.
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { heartbeat } from "./character.functions";
import { updateActiveCharacter } from "./character-store";

const TICK_MS = 60_000;

export function useHeartbeat(enabled: boolean): void {
  const tick = useServerFn(heartbeat);
  useEffect(() => {
    if (!enabled) return;
    const send = () => {
      if (document.visibilityState !== "visible") return;
      tick()
        .then((result) => {
          if (result) updateActiveCharacter({ playedSeconds: result.playedSeconds });
        })
        .catch(() => { /* falha de rede: tenta no próximo tick */ });
    };
    const id = setInterval(send, TICK_MS);
    return () => clearInterval(id);
  }, [enabled, tick]);
}
```

- [ ] **Step 3: character-creation.tsx**

Add imports:

```ts
import { getActiveCharacter } from "@/lib/character.functions";
import type { PersistedCharacter } from "@/lib/character-row";
```

Add a mount effect right after the existing manifest-warm effect in
`CharacterCreationPage` (alive character ⇒ this page is off-limits):

```ts
const fetchActive = useServerFn(getActiveCharacter);
useEffect(() => {
  fetchActive()
    .then((existing) => {
      if (existing) navigate({ to: "/game" });
    })
    .catch(() => { /* sem bloqueio: a criação segue e o insert é a barreira real */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

Change the `character` state type from `Character | null` to
`PersistedCharacter | null` and the `submit` cast from `c as Character` to
`c as PersistedCharacter` (the server fn now returns the persisted shape;
`SummaryView`/`RevealView` keep accepting it since `PersistedCharacter extends
Character` — update their prop types to `PersistedCharacter` where the state
flows in, following tsc).

- [ ] **Step 4: game.tsx**

Replace the sessionStorage-only load effect (lines ~52-59):

```ts
const fetchActive = useServerFn(getActiveCharacter);
useEffect(() => {
  const cached = loadActiveCharacter();
  if (cached?.name) setCharacter(cached);
  fetchActive()
    .then((fresh) => {
      if (!fresh) {
        navigate({ to: "/character-creation" });
        return;
      }
      saveActiveCharacter(fresh);
      setCharacter(fresh);
    })
    .catch((error) => {
      console.error("[characters] load failed:", error);
      if (!cached?.name) navigate({ to: "/character-creation" });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [navigate]);

useHeartbeat(character !== null);
```

Imports to add: `getActiveCharacter` from `@/lib/character.functions`,
`saveActiveCharacter` from `@/lib/character-store`, `useHeartbeat` from
`@/lib/use-heartbeat`, `type PersistedCharacter` from `@/lib/character-row`;
change the `character` state to `PersistedCharacter | null`.

- [ ] **Step 5: Typecheck, tests, build**

Run: `cd app && bunx tsc --noEmit && bun test && bun run build`
Expected: all clean/green.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib app/src/routes
git commit -m "Load characters from Supabase and send playtime heartbeat"
```

---

### Task 5: Verification + migration gate + PR

**Files:** none new.

- [ ] **Step 1: Full battery**

Run: `cd app && bun test && bunx tsc --noEmit && bun run build`
Expected: all pass (lint is known-broken repo-wide by CRLF; skip).

- [ ] **Step 2: Push and report the migration gate**

```bash
git push -u origin feat/character-persistence
```

Report to the controller/user: the migration
`app/supabase/migrations/20260715000000_characters.sql` must be applied to the
production Supabase project (`tekvkpxneckdxhtkcfeo`) via the SQL editor or
`supabase db push` BEFORE merging; until then `createCharacter`/`getActiveCharacter`
fail at runtime. PR: `https://github.com/Enzo-Azevedo/Hopeland/pull/new/feat/character-persistence`.
Manual e2e after migration: create character → reload browser → character loads
from DB; leave tab open 2+ min → `played_seconds` grows in the table editor;
try creating a second character → PT-BR duplicate error.
