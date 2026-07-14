import type { Character } from "./character-schema";

// Lightweight session store for the active character. The authoritative
// persistence layer will land with the real /backend world server; until
// then we keep the active character in sessionStorage so the naming step,
// the HUD portrait, and future in-game screens can share the same object.

const KEY = "hopeland.activeCharacter";

export function saveActiveCharacter(c: Character) {
  try { sessionStorage.setItem(KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

export function loadActiveCharacter(): Character | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Character;
  } catch { return null; }
}

export function updateActiveCharacter(patch: Partial<Character>): Character | null {
  const current = loadActiveCharacter();
  if (!current) return null;
  const next = { ...current, ...patch } as Character;
  saveActiveCharacter(next);
  return next;
}

export function clearActiveCharacter() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
