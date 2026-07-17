// app/src/lib/world/atlas.test.ts
import { describe, expect, test } from "bun:test";
import manifest from "../../../public/tiles/atlas.json";

const ALL_TERRAINS = [
  "deep_water", "water", "river", "beach", "grass", "forest", "jungle",
  "swamp", "desert", "savanna", "tundra", "snow", "taiga", "rock", "snow_rock",
] as const;

describe("tile atlas manifest", () => {
  test("covers every terrain with valid frame indices", () => {
    expect(manifest.tileSize).toBe(32);
    for (const t of ALL_TERRAINS) {
      const frames = (manifest.terrain as Record<string, number[]>)[t];
      expect(frames).toBeDefined();
      expect(frames!.length).toBeGreaterThan(0);
      for (const f of frames!) {
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThan(manifest.frames.length);
      }
    }
  });

  test("water terrains have 4 animation frames", () => {
    for (const t of ["water", "deep_water", "river"] as const) {
      expect((manifest.waterFrames as Record<string, number[]>)[t]!.length).toBe(4);
    }
  });
});
