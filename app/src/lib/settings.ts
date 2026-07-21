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
