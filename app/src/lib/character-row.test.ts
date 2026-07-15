import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildCharacter } from "./character-schema";
import { characterToInsertRow, rowToCharacter, type CharacterRow } from "./character-row";

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
});

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
    expect(row.appearance).toEqual(character.appearance as unknown as typeof row.appearance);
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
