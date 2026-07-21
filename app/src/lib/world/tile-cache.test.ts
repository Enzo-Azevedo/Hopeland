import { describe, expect, test } from "bun:test";
import { CACHE_GENERATION_LIMIT, createTileCache } from "./tile-cache";

describe("createTileCache", () => {
  test("stores and returns values", () => {
    const c = createTileCache<number>(10);
    expect(c.get("a")).toBeUndefined();
    c.set("a", 1);
    expect(c.get("a")).toBe(1);
  });

  test("stays bounded at ~2x the generation limit", () => {
    const limit = 50;
    const c = createTileCache<number>(limit);
    for (let i = 0; i < 10_000; i++) c.set(`k${i}`, i);
    expect(c.size).toBeLessThanOrEqual(2 * limit);
  });

  test("keeps the recent working set retrievable after rotations", () => {
    const limit = 100;
    const c = createTileCache<number>(limit);
    for (let i = 0; i < 1_000; i++) c.set(`k${i}`, i);
    // As últimas escritas (menos de uma geração) continuam disponíveis.
    for (let i = 950; i < 1_000; i++) expect(c.get(`k${i}`)).toBe(i);
  });

  test("promotes cold hits so a live working set survives rotations", () => {
    const limit = 100;
    const c = createTileCache<number>(limit);
    c.set("keep", 42);
    // Enche uma geração: "keep" desce para a fria, mas ainda é achável.
    for (let i = 0; i < limit; i++) c.set(`f${i}`, i);
    expect(c.get("keep")).toBe(42); // promove de volta à quente
    // Enche outra: como foi promovida, sobrevive a mais uma rotação.
    for (let i = 0; i < limit - 1; i++) c.set(`g${i}`, i);
    expect(c.get("keep")).toBe(42);
  });

  test("clear empties both generations", () => {
    const c = createTileCache<number>(10);
    c.set("a", 1);
    c.clear();
    expect(c.get("a")).toBeUndefined();
    expect(c.size).toBe(0);
  });

  test("default limit leaves room for the 5x5 chunk ring (25.6k tiles)", () => {
    expect(CACHE_GENERATION_LIMIT).toBeGreaterThan(25_600 * 4);
  });
});
