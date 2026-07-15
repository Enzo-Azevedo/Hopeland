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
