// Pure chunk ring planning — knows nothing about Phaser, so the render
// backend (TilemapGPULayer today, anything tomorrow) stays swappable.

import { CHUNK_SIZE } from "./world-config";

export interface ChunkCoord {
  cx: number;
  cy: number;
}

export const chunkKey = (cx: number, cy: number): string => `${cx},${cy}`;

export const tileToChunk = (t: number): number => Math.floor(t / CHUNK_SIZE);

export function neededChunks(center: ChunkCoord, radius: number): ChunkCoord[] {
  const out: ChunkCoord[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      out.push({ cx: center.cx + dx, cy: center.cy + dy });
    }
  }
  return out;
}

export function planChunkUpdates(
  loaded: ReadonlySet<string>,
  center: ChunkCoord,
  radius: number,
  maxCreates: number,
): { create: ChunkCoord[]; destroy: string[] } {
  const needed = neededChunks(center, radius);
  const neededKeys = new Set(needed.map((c) => chunkKey(c.cx, c.cy)));

  const missing = needed.filter((c) => !loaded.has(chunkKey(c.cx, c.cy)));
  missing.sort((a, b) => {
    const da = (a.cx - center.cx) ** 2 + (a.cy - center.cy) ** 2;
    const db = (b.cx - center.cx) ** 2 + (b.cy - center.cy) ** 2;
    return da - db;
  });

  const destroy = [...loaded].filter((k) => !neededKeys.has(k));
  return { create: missing.slice(0, maxCreates), destroy };
}
