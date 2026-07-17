import { describe, expect, test } from "bun:test";
import { chunkKey, neededChunks, planChunkUpdates, tileToChunk } from "./chunk-manager";

describe("chunk planner", () => {
  test("tileToChunk floors negatives correctly", () => {
    expect(tileToChunk(0)).toBe(0);
    expect(tileToChunk(31)).toBe(0);
    expect(tileToChunk(32)).toBe(1);
    expect(tileToChunk(-1)).toBe(-1);
    expect(tileToChunk(-32)).toBe(-1);
    expect(tileToChunk(-33)).toBe(-2);
  });

  test("neededChunks returns the full ring", () => {
    const ring = neededChunks({ cx: 10, cy: -5 }, 2);
    expect(ring.length).toBe(25);
    expect(ring).toContainEqual({ cx: 8, cy: -7 });
    expect(ring).toContainEqual({ cx: 12, cy: -3 });
  });

  test("plan creates nearest chunks first, capped, and destroys far ones", () => {
    const loaded = new Set([chunkKey(0, 0), chunkKey(99, 99)]);
    const plan = planChunkUpdates(loaded, { cx: 0, cy: 0 }, 2, 3);
    expect(plan.destroy).toEqual([chunkKey(99, 99)]);
    expect(plan.create.length).toBe(3);
    // nearest missing chunks are the 4-neighbors of center
    for (const c of plan.create) {
      expect(Math.abs(c.cx) + Math.abs(c.cy)).toBeLessThanOrEqual(2);
    }
  });

  test("plan is empty when everything is loaded", () => {
    const loaded = new Set(neededChunks({ cx: 0, cy: 0 }, 2).map((c) => chunkKey(c.cx, c.cy)));
    const plan = planChunkUpdates(loaded, { cx: 0, cy: 0 }, 2, 5);
    expect(plan.create).toEqual([]);
    expect(plan.destroy).toEqual([]);
  });
});
