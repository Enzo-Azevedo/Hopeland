import type { PersistedCharacter } from "./character-row";

// sessionStorage CACHE of the active character. Supabase is the source of
// truth (see character.functions.ts); this only bridges instant paints
// between routes while the fresh row is fetched.

const KEY = "hopeland.activeCharacter";

export function saveActiveCharacter(c: PersistedCharacter) {
  try { sessionStorage.setItem(KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

export function loadActiveCharacter(): PersistedCharacter | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedCharacter;
  } catch { return null; }
}

export function updateActiveCharacter(patch: Partial<PersistedCharacter>): PersistedCharacter | null {
  const current = loadActiveCharacter();
  if (!current) return null;
  const next = { ...current, ...patch } as PersistedCharacter;
  saveActiveCharacter(next);
  return next;
}

export function clearActiveCharacter() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
