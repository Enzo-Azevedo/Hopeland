import { describe, expect, test } from "bun:test";
import { WIND_MAX, WIND_MIN, windAt } from "./wind";
import { WORLD_SEED } from "./world-config";

describe("windAt", () => {
  test("is deterministic and seed-sensitive", () => {
    expect(windAt(WORLD_SEED, 123_456)).toEqual(windAt(WORLD_SEED, 123_456));
    const a = windAt(WORLD_SEED, 500_000);
    const b = windAt("outra", 500_000);
    expect(a.vx === b.vx && a.vy === b.vy).toBe(false);
  });

  test("magnitude bounded: never above WIND_MAX, in range at bucket boundaries", () => {
    for (let t = 0; t < 3_600_000; t += 7_321) {
      const m = Math.hypot(windAt(WORLD_SEED, t).vx, windAt(WORLD_SEED, t).vy);
      expect(m).toBeGreaterThan(0);
      expect(m).toBeLessThanOrEqual(WIND_MAX + 1e-9);
    }
    for (let b = 0; b < 100; b++) {
      const m = Math.hypot(
        windAt(WORLD_SEED, b * 10_000).vx,
        windAt(WORLD_SEED, b * 10_000).vy,
      );
      expect(m).toBeGreaterThanOrEqual(WIND_MIN - 1e-9);
      expect(m).toBeLessThanOrEqual(WIND_MAX + 1e-9);
    }
  });

  test("changes over minutes but is continuous over 100ms", () => {
    const a = windAt(WORLD_SEED, 0);
    const b = windAt(WORLD_SEED, 300_000);
    expect(Math.hypot(a.vx - b.vx, a.vy - b.vy)).toBeGreaterThan(1e-4);
    for (let t = 0; t < 200_000; t += 11_111) {
      const u = windAt(WORLD_SEED, t);
      const v = windAt(WORLD_SEED, t + 100);
      expect(Math.hypot(u.vx - v.vx, u.vy - v.vy)).toBeLessThan(WIND_MAX * 0.1);
    }
  });
});
