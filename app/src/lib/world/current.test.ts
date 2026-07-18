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

import { generatedAt, upstreamOf } from "./current";
import { getElevation } from "./world-gen";

describe("upstream momentum (metade da força do tile anterior)", () => {
  test("upstreamOf returns a strictly higher water neighbor, or null", () => {
    let checked = 0;
    for (let y = -400; y <= 400 && checked < 200; y += 5) {
      for (let x = -400; x <= 400 && checked < 200; x += 5) {
        if (!WATER.has(getWorldTile(x, y).terrain)) continue;
        const up = upstreamOf(WORLD_SEED, x, y);
        if (up) {
          expect(WATER.has(getWorldTile(up.tx, up.ty).terrain)).toBe(true);
          expect(getElevation(WORLD_SEED, up.tx, up.ty)).toBeGreaterThan(
            getElevation(WORLD_SEED, x, y),
          );
          expect(Math.abs(up.tx - x)).toBeLessThanOrEqual(1);
          expect(Math.abs(up.ty - y)).toBeLessThanOrEqual(1);
        }
        checked++;
      }
    }
    expect(checked).toBe(200);
  });

  test("generatedAt scales with slope and is zero on land", () => {
    expect(generatedAt(WORLD_SEED, 0, 0).vx).toBeDefined();
    let landChecked = 0;
    for (let y = -200; y <= 200 && landChecked < 20; y += 11) {
      for (let x = -200; x <= 200 && landChecked < 20; x += 11) {
        if (!WATER.has(getWorldTile(x, y).terrain)) {
          expect(generatedAt(WORLD_SEED, x, y)).toEqual({ vx: 0, vy: 0 });
          landChecked++;
        }
      }
    }
    expect(landChecked).toBe(20);
  });

  test("flow continuity: a river tile's current broadly agrees with its upstream tile", () => {
    let pairs = 0;
    let aligned = 0;
    for (let y = -600; y <= 600 && pairs < 80; y += 3) {
      for (let x = -600; x <= 600 && pairs < 80; x += 3) {
        if (getWorldTile(x, y).terrain !== "river") continue;
        const up = upstreamOf(WORLD_SEED, x, y);
        if (!up) continue;
        const a = currentFor(WORLD_SEED, x, y);
        const b = currentFor(WORLD_SEED, up.tx, up.ty);
        if (a.vx * b.vx + a.vy * b.vy > 0) aligned++;
        pairs++;
      }
    }
    expect(pairs).toBeGreaterThan(30);
    expect(aligned / pairs).toBeGreaterThan(0.6);
  });
});
