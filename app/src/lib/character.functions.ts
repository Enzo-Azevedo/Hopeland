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
