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
    passives: c.passives as unknown as CharacterInsert["passives"],
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
    passives: row.passives as unknown as Character["passives"],
    choices: row.choices as Character["choices"],
    appearance: row.appearance as unknown as Appearance,
    mood: row.mood,
  };
}
