import { describe, expect, test } from "bun:test";
import { hashString, Simplex2 } from "./noise";

describe("hashString", () => {
  test("is deterministic and seed-sensitive", () => {
    expect(hashString("Esperança")).toBe(hashString("Esperança"));
    expect(hashString("Esperança")).not.toBe(hashString("esperança"));
    expect(Number.isInteger(hashString("Esperança"))).toBe(true);
  });
});

describe("Simplex2", () => {
  const noise = new Simplex2(hashString("Esperança"));

  test("is deterministic", () => {
    expect(noise.sample(12.34, -56.78)).toEqual(noise.sample(12.34, -56.78));
  });

  test("different seeds give different fields", () => {
    const other = new Simplex2(hashString("outra"));
    let diff = 0;
    for (let i = 0; i < 50; i++) {
      if (noise.sample(i * 1.7, i * 0.9).value !== other.sample(i * 1.7, i * 0.9).value) diff++;
    }
    expect(diff).toBeGreaterThan(45);
  });

  test("values stay in [-1, 1] and actually vary", () => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 2000; i++) {
      const v = noise.sample(i * 0.37, i * 0.53).value;
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(max - min).toBeGreaterThan(0.5);
  });

  test("analytical derivatives match finite differences", () => {
    const h = 1e-4;
    for (const [x, y] of [
      [0.3, 0.7],
      [5.1, -2.2],
      [-13.4, 8.8],
    ] as const) {
      const s = noise.sample(x, y);
      const fdx = (noise.sample(x + h, y).value - noise.sample(x - h, y).value) / (2 * h);
      const fdy = (noise.sample(x, y + h).value - noise.sample(x, y - h).value) / (2 * h);
      expect(Math.abs(s.dx - fdx)).toBeLessThan(0.01);
      expect(Math.abs(s.dy - fdy)).toBeLessThan(0.01);
    }
  });
});
