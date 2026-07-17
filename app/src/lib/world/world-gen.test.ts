// app/src/lib/world/world-gen.test.ts
import { describe, expect, test } from "bun:test";
import { classifyBiome, findSpawn, getTile, getWorldTile, type Terrain } from "./world-gen";
import { WORLD_SEED } from "./world-config";

describe("classifyBiome (Whittaker matrix)", () => {
  test("covers the 9 land biomes", () => {
    expect(classifyBiome(-0.6, -0.6)).toBe("tundra");
    expect(classifyBiome(-0.6, 0)).toBe("snow");
    expect(classifyBiome(-0.6, 0.6)).toBe("taiga");
    expect(classifyBiome(0, -0.6)).toBe("plains");
    expect(classifyBiome(0, 0)).toBe("forest");
    expect(classifyBiome(0, 0.6)).toBe("swamp");
    expect(classifyBiome(0.6, -0.6)).toBe("desert");
    expect(classifyBiome(0.6, 0)).toBe("savanna");
    expect(classifyBiome(0.6, 0.6)).toBe("jungle");
  });
});

describe("getTile", () => {
  test("is pure and order-independent", () => {
    const a = getTile(WORLD_SEED, 123, -456);
    getTile(WORLD_SEED, 9999, 9999); // unrelated call in between
    expect(getTile(WORLD_SEED, 123, -456)).toEqual(a);
  });

  test("different seeds produce different worlds", () => {
    let diff = 0;
    for (let i = 0; i < 100; i++) {
      if (getTile("Esperança", i * 31, i * 17).terrain !== getTile("outra", i * 31, i * 17).terrain) diff++;
    }
    expect(diff).toBeGreaterThan(20);
  });

  test("produces varied terrain over a large area, including water and land", () => {
    const seen = new Set<Terrain>();
    for (let y = -300; y <= 300; y += 7) {
      for (let x = -300; x <= 300; x += 7) {
        seen.add(getWorldTile(x, y).terrain);
      }
    }
    const hasWater = seen.has("water") || seen.has("deep_water") || seen.has("river");
    const landKinds = [...seen].filter(
      (t) => !["water", "deep_water", "river", "beach"].includes(t),
    );
    expect(hasWater).toBe(true);
    expect(landKinds.length).toBeGreaterThanOrEqual(2);
  });

  test("elevation and slope are finite and bounded", () => {
    for (let i = 0; i < 500; i++) {
      const t = getWorldTile(i * 13 - 3000, i * 7 - 1500);
      expect(t.elevation).toBeGreaterThanOrEqual(-1);
      expect(t.elevation).toBeLessThanOrEqual(1);
      expect(Number.isFinite(t.slope)).toBe(true);
      expect(t.slope).toBeGreaterThanOrEqual(0);
    }
  });

  test("water tiles sit below beach elevation, mountains above land", () => {
    for (let i = 0; i < 2000; i++) {
      const t = getWorldTile(i * 11 - 11000, i * 5 - 5000);
      if (t.terrain === "deep_water") expect(t.elevation).toBeLessThan(-0.2);
      if (t.terrain === "rock" || t.terrain === "snow_rock") expect(t.elevation).toBeGreaterThan(0.5);
    }
  });
});

describe("findSpawn", () => {
  test("is deterministic and lands on dry, gentle ground", () => {
    const a = findSpawn(WORLD_SEED);
    expect(findSpawn(WORLD_SEED)).toEqual(a);
    const t = getTile(WORLD_SEED, a.tx, a.ty);
    expect(["grass", "forest"]).toContain(t.terrain);
  });
});
