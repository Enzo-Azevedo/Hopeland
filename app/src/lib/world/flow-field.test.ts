import { describe, expect, test } from "bun:test";
import {
  decodeFlow, encodeFlow, FIELD_TILES, fieldTexel, flowAt, kindOf,
} from "./flow-field";
import { MAX_CURRENT } from "./current";
import { getWorldTile } from "./world-gen";
import { WORLD_SEED } from "./world-config";

describe("flow-field", () => {
  test("kindOf maps terrains to kinds", () => {
    expect(kindOf("grass")).toBe(0);
    expect(kindOf("rock")).toBe(0);
    expect(kindOf("deep_water")).toBe(1);
    expect(kindOf("water")).toBe(2);
    expect(kindOf("river")).toBe(3);
  });

  test("encode/decode roundtrip within one quantization step", () => {
    const step = MAX_CURRENT / 127;
    for (const s of [
      { vx: 0, vy: 0, kind: 1 as const },
      { vx: MAX_CURRENT, vy: -MAX_CURRENT, kind: 3 as const },
      { vx: 0.013, vy: -0.027, kind: 2 as const },
    ]) {
      const [r, g, b, a] = encodeFlow(s);
      expect(a).toBe(255);
      const d = decodeFlow(r, g, b);
      expect(Math.abs(d.vx - s.vx)).toBeLessThanOrEqual(step);
      expect(Math.abs(d.vy - s.vy)).toBeLessThanOrEqual(step);
      expect(d.kind).toBe(s.kind);
    }
    expect(encodeFlow({ vx: 0, vy: 0, kind: 0 })[3]).toBe(0); // land alpha
  });

  test("fieldTexel wraps negatives euclidean", () => {
    expect(fieldTexel(0)).toBe(0);
    expect(fieldTexel(159)).toBe(159);
    expect(fieldTexel(160)).toBe(0);
    expect(fieldTexel(-1)).toBe(FIELD_TILES - 1);
    expect(fieldTexel(-160)).toBe(0);
    expect(fieldTexel(-161)).toBe(FIELD_TILES - 1);
  });

  test("flowAt matches terrain kind, is cached-deterministic, land is zero", () => {
    let water = 0;
    let land = 0;
    for (let y = -200; y <= 200 && (water < 40 || land < 40); y += 7) {
      for (let x = -200; x <= 200 && (water < 40 || land < 40); x += 7) {
        const t = getWorldTile(x, y).terrain;
        const s = flowAt(WORLD_SEED, x, y);
        expect(flowAt(WORLD_SEED, x, y)).toEqual(s);
        expect(s.kind).toBe(kindOf(t));
        if (s.kind === 0) {
          expect(s.vx).toBe(0);
          expect(s.vy).toBe(0);
          land++;
        } else {
          water++;
        }
      }
    }
    expect(water).toBeGreaterThanOrEqual(40);
    expect(land).toBeGreaterThanOrEqual(40);
  });
});
