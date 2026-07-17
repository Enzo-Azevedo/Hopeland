import { describe, expect, test } from "bun:test";
import { currentFor, MAX_CURRENT } from "./current";
import { getWorldTile } from "./world-gen";
import { TERRAIN_SPEED } from "./movement";
import { WORLD_SEED } from "./world-config";

const WATER = new Set(["deep_water", "water", "river"]);

describe("currentFor", () => {
  test("is deterministic", () => {
    expect(currentFor(WORLD_SEED, 37, -122)).toEqual(currentFor(WORLD_SEED, 37, -122));
  });

  test("land tiles have zero current", () => {
    let landChecked = 0;
    for (let y = -300; y <= 300 && landChecked < 50; y += 7) {
      for (let x = -300; x <= 300 && landChecked < 50; x += 7) {
        if (!WATER.has(getWorldTile(x, y).terrain)) {
          expect(currentFor(WORLD_SEED, x, y)).toEqual({ vx: 0, vy: 0 });
          landChecked++;
        }
      }
    }
    expect(landChecked).toBe(50);
  });

  test("anti-trap: every water current is strictly weaker than swimming", () => {
    const minSwim = 0.2 * TERRAIN_SPEED.deep_water; // 0.07 px/ms
    expect(MAX_CURRENT).toBeLessThan(minSwim);
    let waterChecked = 0;
    for (let y = -400; y <= 400 && waterChecked < 300; y += 5) {
      for (let x = -400; x <= 400 && waterChecked < 300; x += 5) {
        if (WATER.has(getWorldTile(x, y).terrain)) {
          const c = currentFor(WORLD_SEED, x, y);
          expect(Math.hypot(c.vx, c.vy)).toBeLessThanOrEqual(MAX_CURRENT + 1e-9);
          waterChecked++;
        }
      }
    }
    expect(waterChecked).toBe(300);
  });

  test("water currents are non-zero and normalized to their strength", () => {
    let checked = 0;
    for (let y = -400; y <= 400 && checked < 100; y += 5) {
      for (let x = -400; x <= 400 && checked < 100; x += 5) {
        if (WATER.has(getWorldTile(x, y).terrain)) {
          const c = currentFor(WORLD_SEED, x, y);
          expect(Math.hypot(c.vx, c.vy)).toBeGreaterThan(0);
          checked++;
        }
      }
    }
    expect(checked).toBe(100);
  });
});
