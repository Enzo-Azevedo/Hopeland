import { describe, expect, test } from "bun:test";
import { FatigueTracker, TERRAIN_SPEED } from "./movement";
import { getWorldTile } from "./world-gen";

describe("anti-trap invariant", () => {
  test("every terrain has a positive speed multiplier", () => {
    for (const [terrain, mult] of Object.entries(TERRAIN_SPEED)) {
      expect(mult, terrain).toBeGreaterThan(0);
      expect(mult, terrain).toBeLessThanOrEqual(1);
    }
  });

  test("thousands of real world tiles are all walkable", () => {
    for (let y = -400; y <= 400; y += 11) {
      for (let x = -400; x <= 400; x += 11) {
        const t = getWorldTile(x, y);
        expect(TERRAIN_SPEED[t.terrain]).toBeGreaterThan(0);
      }
    }
  });
});

describe("FatigueTracker", () => {
  test("builds up while climbing and caps at 0.4x", () => {
    const f = new FatigueTracker();
    expect(f.multiplier).toBe(1);
    for (let i = 0; i < 100; i++) f.update(100, true); // 10 s climbing
    expect(f.multiplier).toBeCloseTo(0.4, 1);
  });

  test("recovers on flat ground", () => {
    const f = new FatigueTracker();
    for (let i = 0; i < 50; i++) f.update(100, true); // 5 s climbing -> tired
    for (let i = 0; i < 30; i++) f.update(100, false); // 3 s flat
    expect(f.multiplier).toBeCloseTo(1, 1);
  });

  test("partial climb gives partial slowdown", () => {
    const f = new FatigueTracker();
    for (let i = 0; i < 20; i++) f.update(100, true); // 2 s of 4 s ramp
    expect(f.multiplier).toBeLessThan(0.9);
    expect(f.multiplier).toBeGreaterThan(0.5);
  });
});
