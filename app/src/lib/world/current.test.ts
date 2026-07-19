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

describe("bank deflection (fluxo diagonal seguindo o canal)", () => {
  const OCTANTS: ReadonlyArray<readonly [number, number]> = [
    [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
  ];

  function flowTarget(tx: number, ty: number): [number, number] {
    const v = currentFor(WORLD_SEED, tx, ty);
    const ang = Math.atan2(v.vy, v.vx);
    const oct = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
    const [ox, oy] = OCTANTS[oct]!;
    return [tx + ox, ty + oy];
  }

  test("river flow points into water, not into the bank", () => {
    let rivers = 0;
    let intoWater = 0;
    for (let y = -600; y <= 600 && rivers < 120; y += 3) {
      for (let x = -600; x <= 600 && rivers < 120; x += 3) {
        if (getWorldTile(x, y).terrain !== "river") continue;
        const [nx, ny] = flowTarget(x, y);
        if (WATER.has(getWorldTile(nx, ny).terrain)) intoWater++;
        rivers++;
      }
    }
    expect(rivers).toBeGreaterThan(50);
    expect(intoWater / rivers).toBeGreaterThan(0.85);
  });

  test("deflection preserves the anti-trap cap and determinism", () => {
    let checked = 0;
    for (let y = -400; y <= 400 && checked < 150; y += 5) {
      for (let x = -400; x <= 400 && checked < 150; x += 5) {
        if (!WATER.has(getWorldTile(x, y).terrain)) continue;
        const a = currentFor(WORLD_SEED, x, y);
        expect(currentFor(WORLD_SEED, x, y)).toEqual(a);
        expect(Math.hypot(a.vx, a.vy)).toBeLessThanOrEqual(MAX_CURRENT + 1e-9);
        checked++;
      }
    }
    expect(checked).toBe(150);
  });
});

import { channelFlowAt, rawChannelFlow } from "./current";
import { windAt } from "./wind";

describe("channel/wind split", () => {
  test("channel flow has no time dependence and matches flowAt's source", () => {
    const a = channelFlowAt(WORLD_SEED, 37, -122);
    expect(channelFlowAt(WORLD_SEED, 37, -122)).toEqual(a);
  });

  test("currentFor = channel + influenced wind, clamped", () => {
    const t = 250_000;
    const wind = windAt(WORLD_SEED, t);
    let deepChecked = 0;
    // deep_water is rare and clustered for WORLD_SEED (nothing within +-2000
    // of spawn — confirmed by direct scan); (-1440, 2220) is a verified
    // pocket, so we scan tightly around it instead of near the origin.
    for (let y = 2070; y <= 2370 && deepChecked < 30; y += 1) {
      for (let x = -1590; x <= -1290 && deepChecked < 30; x += 1) {
        if (getWorldTile(x, y).terrain !== "deep_water") continue;
        const ch = channelFlowAt(WORLD_SEED, x, y);
        const cur = currentFor(WORLD_SEED, x, y, t);
        const expectedX = ch.vx + wind.vx;
        const expectedY = ch.vy + wind.vy;
        const mag = Math.hypot(expectedX, expectedY);
        const cap = 0.02;
        const scale = mag > cap ? cap / mag : 1;
        expect(Math.abs(cur.vx - expectedX * scale)).toBeLessThan(1e-9);
        expect(Math.abs(cur.vy - expectedY * scale)).toBeLessThan(1e-9);
        deepChecked++;
      }
    }
    expect(deepChecked).toBe(30);
  });

  test("river push is channel-dominated (wind influence 0.1)", () => {
    let checked = 0;
    for (let y = -600; y <= 600 && checked < 40; y += 3) {
      for (let x = -600; x <= 600 && checked < 40; x += 3) {
        if (getWorldTile(x, y).terrain !== "river") continue;
        const ch = channelFlowAt(WORLD_SEED, x, y);
        const cur = currentFor(WORLD_SEED, x, y, 250_000);
        // vento no rio é no máximo 0.1 * WIND_MAX = 0.002
        expect(Math.hypot(cur.vx - ch.vx, cur.vy - ch.vy)).toBeLessThanOrEqual(0.002 + 1e-9);
        checked++;
      }
    }
    expect(checked).toBe(40);
  });
});
