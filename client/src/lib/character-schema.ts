// Client-mirror of backend character logic. Keep in sync with
// backend/src/character/skills.ts (backend is gitignored, local-only).

export type Category = "fisica" | "intelectual" | "agil" | "social";
export type Profession =
  | "ferreiro" | "lenhador" | "estivador"
  | "bibliotecario" | "contador" | "alquimista"
  | "pescador" | "mensageiro" | "equilibrista"
  | "comerciante" | "menestrel" | "taberneiro";
export type Origin =
  | "praia" | "montanha" | "deserto" | "floresta"
  | "cavernas" | "mar" | "cidade";

export interface Passive { key: string; label: string; value: number }

// ---------- Appearance ----------
// Structural placeholders. Each layer maps to a future art asset via
// APPEARANCE_ASSET_MAP; for now the portrait renders geometric primitives
// using the tokens below.
export type SkinTone =
  | "warm_tan" | "pale_flushed" | "earth_deep"
  | "light_brown" | "very_pale" | "gray_tan" | "neutral";
export type FacialMark =
  | "freckles_sunspots" | "chapped_windburn" | "dry_eye_creases"
  | "old_scratches" | "under_eye_shadows" | "salt_wrinkles" | "brow_tension";
export type Build = "slim" | "average" | "sturdy" | "robust";
export type MoodExpression = "low" | "mid" | "high";

export interface Appearance {
  skinTone: SkinTone;
  facialMark: FacialMark;
  build: Build;
  // Placeholder layers reserved for future systems.
  hair: "placeholder_default";
  clothes: "placeholder_default";
  scars: "placeholder_none";
}

export interface Character {
  skills: Record<string, Record<string, number>>;
  tags: string[];
  passives: Passive[];
  choices: { category: Category; profession: Profession; origin: Origin };
  appearance: Appearance;
  mood: number; // 0-100, starts at 50
  name: string | null;
}

const MAX = 10;
type Path = [string, string];

const PROFESSION_SKILL: Record<Profession, Path> = {
  ferreiro: ["fisica", "forca"],
  lenhador: ["fisica", "vigor"],
  estivador: ["fisica", "resistencia"],
  bibliotecario: ["intelectual", "memorizacao"],
  contador: ["intelectual", "raciocinio"],
  alquimista: ["intelectual", "abstracao"],
  pescador: ["agil", "destreza"],
  mensageiro: ["agil", "velocidade"],
  equilibrista: ["agil", "equilibrio"],
  comerciante: ["social", "labia"],
  menestrel: ["social", "carisma"],
  taberneiro: ["social", "extroversao"],
};

const ORIGINS: Record<Origin, { skillPoints: Array<{ path: Path; amount: number }>; passives: Passive[]; tags: string[] }> = {
  praia: {
    skillPoints: [],
    passives: [
      { key: "sunburn_damage", label: "-20% dano de queimadura solar", value: -0.2 },
      { key: "max_speed", label: "+20% velocidade máxima", value: 0.2 },
    ],
    tags: [],
  },
  montanha: {
    skillPoints: [{ path: ["agil", "equilibrio"], amount: 3 }],
    passives: [{ key: "balance_test_difficulty", label: "-50% dificuldade em testes de equilíbrio", value: -0.5 }],
    tags: [],
  },
  deserto: {
    skillPoints: [{ path: ["fisica", "vigor"], amount: 2 }],
    passives: [{ key: "sunburn_damage", label: "-75% dano de queimadura solar", value: -0.75 }],
    tags: [],
  },
  floresta: {
    skillPoints: [{ path: ["agil", "velocidade"], amount: 3 }],
    passives: [],
    tags: ["Natureza"],
  },
  cavernas: {
    skillPoints: [{ path: ["fisica", "forca"], amount: 3 }],
    passives: [{ key: "dark_vision", label: "+50% visão no escuro", value: 0.5 }],
    tags: [],
  },
  mar: {
    skillPoints: [{ path: ["agil", "destreza"], amount: 3 }],
    passives: [{ key: "breath_hold", label: "+50% fôlego (tempo submerso)", value: 0.5 }],
    tags: [],
  },
  cidade: {
    skillPoints: [{ path: ["intelectual", "raciocinio"], amount: 5 }],
    passives: [{ key: "irritation", label: "+50% irritação (debuff social passivo)", value: 0.5 }],
    tags: [],
  },
};

// Appearance table — mirrors the design doc.
const ORIGIN_APPEARANCE: Record<Origin, { skinTone: SkinTone; facialMark: FacialMark }> = {
  praia:    { skinTone: "warm_tan",     facialMark: "freckles_sunspots" },
  montanha: { skinTone: "pale_flushed", facialMark: "chapped_windburn" },
  deserto:  { skinTone: "earth_deep",   facialMark: "dry_eye_creases" },
  floresta: { skinTone: "light_brown",  facialMark: "old_scratches" },
  cavernas: { skinTone: "very_pale",    facialMark: "under_eye_shadows" },
  mar:      { skinTone: "gray_tan",     facialMark: "salt_wrinkles" },
  cidade:   { skinTone: "neutral",      facialMark: "brow_tension" },
};

function empty() {
  return {
    fisica: { vigor: 0, forca: 0, resistencia: 0 },
    intelectual: { raciocinio: 0, abstracao: 0, memorizacao: 0 },
    agil: { destreza: 0, velocidade: 0, equilibrio: 0 },
    social: { carisma: 0, extroversao: 0, labia: 0 },
  } as Record<string, Record<string, number>>;
}

function add(s: Record<string, Record<string, number>>, [c, k]: Path, n: number) {
  s[c][k] = Math.min(MAX, Math.max(0, (s[c][k] ?? 0) + n));
}

function buildFromPhysical(fisica: Record<string, number>): Build {
  const total = (fisica.vigor ?? 0) + (fisica.forca ?? 0) + (fisica.resistencia ?? 0);
  if (total <= 2) return "slim";
  if (total <= 5) return "average";
  if (total <= 8) return "sturdy";
  return "robust";
}

export function moodExpression(mood: number): MoodExpression {
  if (mood <= 33) return "low";
  if (mood <= 66) return "mid";
  return "high";
}

export function buildCharacter(input: {
  category: Category; profession: Profession; origin: Origin;
}): Character {
  const skills = empty();
  for (const k of Object.keys(skills[input.category])) add(skills, [input.category, k], 1);
  add(skills, PROFESSION_SKILL[input.profession], 1);
  const o = ORIGINS[input.origin];
  for (const sp of o.skillPoints) add(skills, sp.path, sp.amount);

  const appearanceBase = ORIGIN_APPEARANCE[input.origin];
  const appearance: Appearance = {
    skinTone: appearanceBase.skinTone,
    facialMark: appearanceBase.facialMark,
    build: buildFromPhysical(skills.fisica),
    hair: "placeholder_default",
    clothes: "placeholder_default",
    scars: "placeholder_none",
  };

  return {
    skills,
    tags: [...o.tags],
    passives: [...o.passives],
    choices: input,
    appearance,
    mood: 50,
    name: null,
  };
}

export function validateCharacterName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new Error("O nome precisa ter pelo menos 2 caracteres.");
  if (name.length > 20) throw new Error("O nome pode ter no máximo 20 caracteres.");
  if (!/^[\p{L}][\p{L}\p{M}' -]*$/u.test(name)) {
    throw new Error("Use apenas letras, espaços, apóstrofos ou hífen.");
  }
  return name;
}

// Future asset wiring — swap keys for real files when art is ready.
export const APPEARANCE_ASSET_MAP = {
  skinTone: {} as Record<SkinTone, string>,
  facialMark: {} as Record<FacialMark, string>,
  build: {} as Record<Build, string>,
  expression: {} as Record<MoodExpression, string>,
  hair: {} as Record<string, string>,
  clothes: {} as Record<string, string>,
  scars: {} as Record<string, string>,
};
