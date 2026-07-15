import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildCharacter,
  validateCharacterName,
  type Category,
  type Profession,
  type Origin,
} from "./character-schema";

const CATEGORIES: Category[] = ["fisica", "intelectual", "agil", "social"];
const PROFESSIONS: Profession[] = [
  "ferreiro", "lenhador", "estivador",
  "bibliotecario", "contador", "alquimista",
  "pescador", "mensageiro", "equilibrista",
  "comerciante", "menestrel", "taberneiro",
];
const ORIGINS: Origin[] = ["praia", "montanha", "deserto", "floresta", "cavernas", "mar", "cidade"];

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
  .handler(async ({ data }) => {
    return buildCharacter(data);
  });

export const setCharacterMoodDebug = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { mood: number }) => {
    const n = Number(input?.mood);
    if (!Number.isFinite(n)) throw new Error("Mood inválido.");
    return { mood: Math.max(0, Math.min(100, Math.round(n))) };
  })
  .handler(async ({ data }) => ({ mood: data.mood }));
