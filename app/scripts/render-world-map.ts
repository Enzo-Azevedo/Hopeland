// Renders a biome-colored PNG of the real generator output for visual
// inspection (AGENTS.md §7.5 applied to the world system).
// Usage: bun scripts/render-world-map.ts [sizeTiles=1024] [step=2]

import sharp from "sharp";
import { getWorldTile, type Terrain } from "../src/lib/world/world-gen";

const COLORS: Record<Terrain, [number, number, number]> = {
  deep_water: [42, 79, 158],
  water: [63, 118, 228],
  river: [79, 134, 232],
  beach: [219, 203, 158],
  grass: [145, 189, 89],
  forest: [95, 156, 74],
  jungle: [64, 165, 50],
  swamp: [106, 112, 57],
  desert: [229, 216, 172],
  savanna: [191, 183, 85],
  tundra: [128, 180, 151],
  snow: [240, 244, 248],
  taiga: [134, 183, 131],
  rock: [130, 130, 130],
  snow_rock: [210, 215, 222],
};

const size = Number(process.argv[2] ?? 1024);
const step = Number(process.argv[3] ?? 2);
const px = Math.floor(size / step);
const buf = Buffer.alloc(px * px * 3);

for (let y = 0; y < px; y++) {
  for (let x = 0; x < px; x++) {
    const t = getWorldTile((x - px / 2) * step, (y - px / 2) * step);
    const [r, g, b] = COLORS[t.terrain];
    // Shade land by elevation so mountains/valleys read at a glance.
    const shade = t.terrain.includes("water") ? 1 : 0.75 + 0.25 * Math.max(0, t.elevation);
    const i = (y * px + x) * 3;
    buf[i] = Math.round(r * shade);
    buf[i + 1] = Math.round(g * shade);
    buf[i + 2] = Math.round(b * shade);
  }
}

await sharp(buf, { raw: { width: px, height: px, channels: 3 } })
  .png()
  .toFile("world-map.png");
console.log(`world-map.png: ${px}x${px} px, ${size}x${size} tiles centered on (0,0)`);
