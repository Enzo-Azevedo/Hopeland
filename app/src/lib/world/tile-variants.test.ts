import { describe, expect, test } from "bun:test";
import { pickVariant, tileHash } from "./tile-variants";

describe("tileHash", () => {
  test("is deterministic", () => {
    expect(tileHash(123, -456)).toBe(tileHash(123, -456));
  });

  test("low bit is not the (x+y) checkerboard parity", () => {
    // The old hash's low bit tracked tile parity, rendering variants as a
    // perfect checkerboard. Over a grid, agreement with parity must look
    // random (~50%), not systematic.
    let agree = 0;
    let total = 0;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        if ((tileHash(x, y) & 1) === ((x + y) & 1)) agree++;
        total++;
      }
    }
    const ratio = agree / total;
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.6);
  });

  test("adjacent rows are not complements of each other", () => {
    let equalBits = 0;
    for (let x = 0; x < 256; x++) {
      if ((tileHash(x, 10) & 1) === (tileHash(x, 11) & 1)) equalBits++;
    }
    // Complement rows would give 0; identical rows 256. Random ~128.
    expect(equalBits).toBeGreaterThan(80);
    expect(equalBits).toBeLessThan(176);
  });
});

describe("pickVariant", () => {
  const frames = [7, 8];

  test("is deterministic and always returns a listed frame", () => {
    for (let i = 0; i < 200; i++) {
      const f = pickVariant(frames, i * 3 - 100, i * 5 - 250);
      expect(pickVariant(frames, i * 3 - 100, i * 5 - 250)).toBe(f);
      expect(frames).toContain(f);
    }
  });

  test("primary frame dominates (~80%), variants are sprinkled accents", () => {
    let primary = 0;
    let total = 0;
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 100; x++) {
        if (pickVariant(frames, x, y) === frames[0]) primary++;
        total++;
      }
    }
    const ratio = primary / total;
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(0.9);
  });

  test("single-frame terrains always use that frame", () => {
    expect(pickVariant([42], 5, 9)).toBe(42);
  });
});
