import { describe, expect, test } from "bun:test";
import { brightnessFor, isOccluded, levelFor, projectY, wallStripsFor } from "./projection";
import { getWorldTile } from "./world-gen";
import { CHUNK_SIZE, GEN, HALF_STEP_PX, MAX_LEVEL } from "./world-config";

describe("levelFor", () => {
  test("water terrains are always level 0", () => {
    expect(levelFor({ terrain: "deep_water", elevation: -0.5 })).toBe(0);
    expect(levelFor({ terrain: "water", elevation: -0.02 })).toBe(0);
    expect(levelFor({ terrain: "river", elevation: 0.3 })).toBe(0);
  });

  test("land is in [1, 13], beach at level 1, peak at 13", () => {
    expect(levelFor({ terrain: "beach", elevation: GEN.beach })).toBe(1);
    expect(levelFor({ terrain: "grass", elevation: GEN.beach + 0.001 })).toBe(1);
    expect(levelFor({ terrain: "snow_rock", elevation: 1 })).toBe(MAX_LEVEL);
    for (let e = GEN.beach; e <= 1; e += 0.01) {
      const l = levelFor({ terrain: "grass", elevation: e });
      expect(l).toBeGreaterThanOrEqual(1);
      expect(l).toBeLessThanOrEqual(MAX_LEVEL);
    }
  });

  test("is monotonic in elevation", () => {
    let prev = 0;
    for (let e = GEN.beach; e <= 1; e += 0.005) {
      const l = levelFor({ terrain: "grass", elevation: e });
      expect(l).toBeGreaterThanOrEqual(prev);
      prev = l;
    }
  });

  test("real world tiles all produce valid levels", () => {
    for (let y = -200; y <= 200; y += 13) {
      for (let x = -200; x <= 200; x += 13) {
        const t = getWorldTile(x, y);
        const l = levelFor(t);
        expect(l).toBeGreaterThanOrEqual(0);
        expect(l).toBeLessThanOrEqual(MAX_LEVEL);
        if (t.terrain === "deep_water" || t.terrain === "water" || t.terrain === "river") {
          expect(l).toBe(0);
        } else {
          expect(l).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });
});

describe("projectY / wallStripsFor", () => {
  test("projectY lifts by level in half steps", () => {
    expect(projectY(320, 0)).toBe(320);
    expect(projectY(320, 4)).toBe(320 - 4 * HALF_STEP_PX);
    expect(projectY(-64, 13)).toBe(-64 - 208);
  });

  test("walls only where the south neighbor is lower", () => {
    expect(wallStripsFor(5, 2)).toBe(3);
    expect(wallStripsFor(2, 5)).toBe(0);
    expect(wallStripsFor(3, 3)).toBe(0);
    expect(wallStripsFor(1, 0)).toBe(1); // shoreline ledge
  });

  test("wall computation is consistent across a chunk border", () => {
    // Row 31 of chunk (0,0) borders row 0 of chunk (0,1). The wall count
    // computed from getWorldTile must not care about the chunk boundary.
    for (let tx = 0; tx < CHUNK_SIZE; tx += 3) {
      const north = getWorldTile(tx, CHUNK_SIZE - 1);
      const south = getWorldTile(tx, CHUNK_SIZE);
      const strips = wallStripsFor(levelFor(north), levelFor(south));
      expect(strips).toBeGreaterThanOrEqual(0);
      expect(strips).toBe(Math.max(0, levelFor(north) - levelFor(south)));
    }
  });
});

describe("isOccluded", () => {
  test("deep spot behind a high wall is occluded", () => {
    // player level 2; one row south there is a level-6 ridge: 6-2 >= 2*1
    expect(isOccluded(2, [[6], [6, 5], [3]])).toBe(true);
  });

  test("flat ground never occludes", () => {
    expect(isOccluded(3, [[3, 3], [3], [3]])).toBe(false);
  });

  test("gentle slope south does not occlude", () => {
    // +1 per row is a normal hillside, not an occluder
    expect(isOccluded(4, [[5], [6], [7]])).toBe(false);
  });

  test("far ridge needs to be proportionally taller", () => {
    expect(isOccluded(1, [[2], [3], [7]])).toBe(true); // 7-1 >= 2*3
    expect(isOccluded(1, [[2], [3], [6]])).toBe(false);
  });
});

describe("brightnessFor", () => {
  test("stays in [0.8, 1.0] with peak exactly 1.0", () => {
    for (let l = 0; l <= MAX_LEVEL; l++) {
      const b = brightnessFor(l);
      expect(b).toBeGreaterThanOrEqual(0.8);
      expect(b).toBeLessThanOrEqual(1.0);
    }
    expect(brightnessFor(MAX_LEVEL)).toBe(1.0);
  });

  test("is monotonic in level and clamps out-of-range input", () => {
    for (let l = 1; l <= MAX_LEVEL; l++) {
      expect(brightnessFor(l)).toBeGreaterThan(brightnessFor(l - 1));
    }
    expect(brightnessFor(-5)).toBe(brightnessFor(0));
    expect(brightnessFor(99)).toBe(1.0);
  });
});
